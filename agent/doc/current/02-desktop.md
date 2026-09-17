# Tauri 桌面接入

## 约定

- 当前目标是 Windows 桌面 GUI，使用 Tauri 2 / WebView2；保留 Fastify 后端，窗口启动时自动拉起，退出时回收。
- mise 固定 Node.js / Rust；Windows 还需 C++ Build Tools。构建脚本将后端打成 CJS 并复制当前 Node 运行时到资源目录，桌面产物不依赖用户的 Node PATH。
- 窗口使用 Tauri 本地前端资源；健康检查通过限定的 `backend_health` IPC 转发，不开放任意 URL 请求或 shell 权限。
- 后端通过 stdout 报告实际端口 / 启动错误。stdin 由桌面进程持有，父进程退出导致 EOF 时后端自行关闭；窗口退出也主动回收子进程。端口冲突显示错误，不连接无关服务。

## 常用入口

- `mise run dev`：GUI + Vite 热更新；后端改动需重启命令，Rust 改动由 Tauri 监视。
- `mise run start`：构建前端后打开 GUI，无 Vite 服务。
- `mise run build-desktop`：构建 release 程序与相邻资源目录；`npm run bundle`：Windows NSIS 安装包。
- `mise run check`：本地格式 / 类型 / 测试 / 前端后端构建；`mise run check-desktop`：Rust 检查。
- CI 暂停，旧配置为 `../archive/ci.yml.disabled`，不要自动恢复。

## 验证

接入验证中：后端打包、端口占用、关闭清理、本地检查、Rust 构建和原生 GUI 启动。完成后更新此节。
