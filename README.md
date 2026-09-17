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

The inference path supports streaming and non-streaming `POST /v1/chat/completions`, Buffered / Live Final output, and Buffered / Live Thinking output. Final uses `content`; the current Chat Completions compatibility layer exposes Thinking through the ecosystem extension `reasoning`.

The Operator control plane uses `/operator/ws` with sequenced events, command acknowledgements, duplicate suppression, reconnect snapshots and replay. Requests can be cancelled and have a configurable timeout. The OpenAI-compatible API and Operator Console use separate authentication boundaries.

## Get started

Install [mise](https://mise.jdx.dev/), then run from the repository root. mise installs the pinned Node.js toolchain.

```sh
mise trust
mise install
mise run install
mise run dev
```

Development starts Fastify on `127.0.0.1:3000` and the Vite Operator Console on `127.0.0.1:5173`. Vite proxies `/api`, `/v1`, and `/operator` to Fastify.

Loopback development does not require credentials. When credentials are configured, clients send `Authorization: Bearer <ARTISANAL_API_KEY>` to `/v1/*`, while human operators sign in through the browser with `ARTISANAL_OPERATOR_PASSWORD`.

For a production-style local run:

```sh
mise run build
mise run start
```

Then open `http://127.0.0.1:3000`. The built Fastify process serves both the OpenAI-compatible API and `dist/web/` from the same origin.

## Authentication and lifecycle

Binding to a non-loopback address fails closed unless both authentication boundaries are configured:

```sh
ARTISANAL_API_KEY=replace-me \
ARTISANAL_OPERATOR_PASSWORD=replace-me-too \
HOST=0.0.0.0 \
npm start
```

`ARTISANAL_REQUEST_TIMEOUT_MS` defaults to five minutes. For a separately hosted Operator Console, add its exact origin to the comma-separated `ARTISANAL_OPERATOR_ORIGINS` list. Cross-site cookies additionally require `ARTISANAL_OPERATOR_COOKIE_SAMESITE=none`, `ARTISANAL_OPERATOR_COOKIE_SECURE=1`, and HTTPS. See [.env.example](.env.example) for all supported settings.

## Docker

Build and run the same-origin production service locally:

```sh
docker build -t artisanal-intelligence:local .
docker run --rm -p 3000:3000 \
  -e ARTISANAL_API_KEY=replace-me \
  -e ARTISANAL_OPERATOR_PASSWORD=replace-me-too \
  artisanal-intelligence:local
```

The runtime image contains only Node.js and the built `dist/` output, runs as the unprivileged `node` user, and includes an HTTP health check.

## Deployment shape

The default deployment is one Node process with same-origin Web UI and API. `HOST` and `PORT` control the listen address; `ARTISANAL_WEB_ROOT` can override the static asset directory, and `ARTISANAL_SERVE_WEB=0` disables built-in static serving.

The Web UI reads `/config.js` at runtime. Set `window.__ARTISANAL_CONFIG__.apiBase` there to point the same build at another API origin or reverse-proxy path when using a split deployment. Public deployments should terminate HTTPS at a trusted reverse proxy and configure the exact Operator origins.

## Keep it tidy

```sh
npm run format        # Format TypeScript, Vue, configuration, and docs
npm run format:check  # Check formatting without changing files
npm test              # Run backend unit and endpoint tests
npm run test:coverage # Run the backend coverage report
```

## License

[MIT](LICENSE). Bring your own brain. Buns sold separately.
