# Artisanal Intelligence

**English** | [简体中文](README.zh-CN.md)

**Artisanal Intelligence — possibly the world's most powerful vision model.**

A model service powered by actual humans. The operator is responsible for thinking, writing responses, and choosing tools. Externally, it exposes an OpenAI-compatible API.

You spend all day ordering LLMs around, but have you ever stopped to consider how the LLM feels?

Artisanal Intelligence lets you experience, firsthand, the horror of being controlled by Agent tools.

## Our breakthrough architecture

- **No GPU required.** The inference engine is sitting in front of the monitor.
- **1 million tokens for just 1 steamed bun.** Our carbohydrate-based pricing vision. Actual throughput depends on typing speed and lunch.
- **100% handcrafted inference.** Every token is locally sourced from someone's brain.
- **A truly sleeping model.** If the operator falls asleep, so does your SLA.

## What works today

The desktop application is built with Tauri 2 + Vue 3 + TypeScript + Vite + plain CSS.

The GUI automatically manages the Fastify backend and provides separate Thinking and Final input previews.

The inference API, streaming output, and tool calling are not implemented yet.

We plan to provide an OpenAI-compatible API so existing Agents can use a real human as their model backend.

For now, the service infrastructure is in place. Steamed-bun economics are still under active research.

## Get started

Install [mise](https://mise.jdx.dev/) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (on Windows: C++ Build Tools and WebView2), then run from the repository root. mise installs the pinned Node.js and Rust toolchains.

```sh
mise trust
mise install
mise run install
mise run dev
```

`mise run dev` opens the desktop GUI with hot reload. `mise run start` builds the frontend and opens the GUI without a Vite server. The app starts its local API on port 3000 and stops it on exit; stop any old standalone server first, or set `PORT` to use another port.

`mise run build-desktop` creates the native executable in `src-tauri/target/release/`; keep its adjacent `resources/` folder with it. `npm run bundle` creates a Windows installer with the Node.js runtime included. The first Rust build takes longer.

## Keep it tidy

```sh
npm run format        # Format TypeScript, Vue, Rust, configuration, and docs
npm run format:check  # Check formatting without changing files
```

## License

[MIT](LICENSE). Bring your own brain. Buns sold separately.
