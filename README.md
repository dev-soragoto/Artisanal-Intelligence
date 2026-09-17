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

## Wait... seriously

Jokes aside, Artisanal Intelligence is not just a tool for pretending to be an LLM.

It naturally lets you place breakpoints inside an LLM's “brain”, inspect or modify what is happening, and take over execution whenever you want.

It may be useful for **Agent debugging, adversarial simulation**, and probably a few strange use cases we have not thought of yet.

## What works today

Artisanal Intelligence is now Web-first. The Tauri desktop host has been removed: Fastify is the server and the Vue Operator Console runs in a normal browser.

The inference path already supports streaming and non-streaming `POST /v1/chat/completions`, Buffered / Live Final output, and Buffered / Live Thinking output. Final uses `content`; the current Chat Completions compatibility layer exposes Thinking through the ecosystem extension `reasoning`.


## Get started

Install [mise](https://mise.jdx.dev/), then run from the repository root. mise installs the pinned Node.js toolchain.

```sh
mise trust
mise install
mise run install
mise run dev
```

Development starts Fastify on `127.0.0.1:3000` and the Vite Operator Console on `127.0.0.1:5173`. Vite proxies `/api`, `/v1`, and `/operator` to Fastify.

For a production-style local run:

```sh
mise run build
mise run start
```

Then open `http://127.0.0.1:3000`. The built Fastify process serves both the OpenAI-compatible API and `dist/web/` from the same origin.

## Deployment shape

The default deployment is one Node process with same-origin Web UI and API. `HOST` and `PORT` control the listen address; `ARTISANAL_WEB_ROOT` can override the static asset directory, and `ARTISANAL_SERVE_WEB=0` disables built-in static serving.

The Web UI reads `/config.js` at runtime. Set `window.__ARTISANAL_CONFIG__.apiBase` there to point the same build at another API origin or reverse-proxy path when using a split deployment.

**Do not expose the current Operator endpoints directly to the public Internet yet.** Operator authentication and the WebSocket control plane are the next infrastructure milestone.

## Keep it tidy

```sh
npm run format        # Format TypeScript, Vue, configuration, and docs
npm run format:check  # Check formatting without changing files
```

## License

[MIT](LICENSE). Bring your own brain. Buns sold separately.
