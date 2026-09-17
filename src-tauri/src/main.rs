#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::Manager;

struct Backend {
    child: Mutex<Option<Child>>,
    port: Option<u16>,
    error: Option<String>,
}

impl Backend {
    fn start(app: &tauri::App) -> Result<Self, String> {
        let resources = app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("resources");
        let runtime = if cfg!(windows) { "node.exe" } else { "node" };
        let mut command = Command::new(resources.join(runtime));
        command
            .arg(resources.join("server.cjs"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW for the backend only.
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Cannot start backend: {e}"))?;
        let stdout = child.stdout.take().ok_or("Backend stdout unavailable")?;
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
            let _ = sender.send(result);
        });
        let ready = (|| -> Result<u16, String> {
            let line = receiver
                .recv_timeout(Duration::from_secs(15))
                .map_err(|e| format!("Backend startup timed out or failed: {e}"))?
                .map_err(|e| e.to_string())?;
            let value: serde_json::Value = serde_json::from_str(&line)
                .map_err(|e| format!("Invalid backend startup response: {e}"))?;
            if let Some(error) = value.get("error").and_then(|v| v.as_str()) {
                return Err(error.to_owned());
            }
            value
                .get("port")
                .and_then(|v| v.as_u64())
                .and_then(|v| u16::try_from(v).ok())
                .filter(|v| *v > 0)
                .ok_or_else(|| "Backend did not report a valid port".to_owned())
        })();
        match ready {
            Ok(port) => Ok(Self {
                child: Mutex::new(Some(child)),
                port: Some(port),
                error: None,
            }),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                Err(error)
            }
        }
    }

    fn stop(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl Drop for Backend {
    fn drop(&mut self) {
        self.stop();
    }
}

#[tauri::command]
async fn backend_health(backend: tauri::State<'_, Backend>) -> Result<serde_json::Value, String> {
    if let Some(error) = &backend.error {
        return Err(error.clone());
    }
    {
        let mut guard = backend.child.lock().map_err(|e| e.to_string())?;
        let child = guard.as_mut().ok_or("Backend is not running")?;
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            return Err("Backend has stopped. Restart the app.".to_owned());
        }
    }
    let port = backend.port.ok_or("Backend port unavailable")?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;
    let mut health: serde_json::Value = client
        .get(format!("http://127.0.0.1:{port}/api/health"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    health["port"] = port.into();
    Ok(health)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let backend = Backend::start(app).unwrap_or_else(|error| Backend {
                child: Mutex::new(None),
                port: None,
                error: Some(error),
            });
            app.manage(backend);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend_health])
        .build(tauri::generate_context!())
        .expect("Unable to build desktop application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<Backend>().stop();
            }
        });
}
