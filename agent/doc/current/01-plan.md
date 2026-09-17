# Artisanal Intelligence · 能工智人

## 目标与现状

Artisanal Intelligence 是 Human-as-a-Model 服务，也是面向 Agent / LLM 的人工推理断点与接管层。客户端发送 conversation / tools，Human Operator 输入 Thinking、Final 或工具调用，服务将人工操作包装成兼容模型响应。

当前 inference core 与 control plane 已经跑通：Buffered Final、Chat Completions SSE、Live Final、Thinking SSE、Operator WebSocket、生命周期和鉴权均已实现，并有后端自动测试覆盖。

**Web-first migration、Operator WebSocket / lifecycle / auth 与本地 Dockerfile 已完成。** Tauri / Rust 桌面宿主已经移除，Vue 通过 HTTP 与 WebSocket 连接 Fastify。Fastify 是产品核心，Browser Operator Console 是人类推理终端。

## 当前部署模型

默认采用前后端代码分离、生产同源部署：

```text
http(s)://host/
├── /                  Vue Operator Console
├── /api/*             Service API
├── /v1/*              OpenAI-compatible API
└── /operator/*        Operator control plane
```

默认只需要一个 Node.js 进程。Fastify 同时提供 API 和构建后的 Vue 静态资源。

开发态使用两个进程：

```text
Vite :5173
  ├── /api/*       -> Fastify :3000
  ├── /v1/*        -> Fastify :3000
  └── /operator/*  -> Fastify :3000
```

前端默认使用 same-origin 路径；`public/config.js` 提供运行时 `apiBase` 覆盖能力，为独立前端部署 / 反向代理部署留出边界。

## mise 与构建

项目继续使用 mise 管理本地工具与公共入口，但只保留 Node.js 工具链：

```text
mise run install  -> npm ci
mise run dev      -> Fastify watcher + Vite
mise run build    -> dist/server.cjs + dist/web/
mise run start    -> node dist/server.cjs
mise run check    -> format + typecheck + test + build
```

生产 server 使用 esbuild 打成单个 `dist/server.cjs`，Web 资源位于 `dist/web/`。Dockerfile 使用多阶段构建，运行镜像只携带 Node runtime 与 `dist/`。

## 当前执行切片

1. **Buffered Final（已实现并验证）**
   - `RequestSession` / `RequestManager`。
   - `GET /v1/models`。
   - 非流式 `POST /v1/chat/completions`。
   - 单 active request。

2. **Final Streaming / Live（已实现并验证）**
   - Chat Completions SSE。
   - `text_delta` + `finish`。
   - Live Final 与 IME composition commit。

3. **Thinking SSE（已实现并验证）**
   - `reasoning_delta` 与 `text_delta` 平级。
   - Thinking / Final 均支持 Buffered / Live。
   - Chat Completions adapter 当前使用生态扩展 `delta.reasoning` / `message.reasoning`。

4. **Web-first migration（已完成并验证）**
   - Tauri IPC 已替换为 Browser `fetch`。
   - Operator HTTP 路径改为 `/operator/*`。
   - Tauri / Rust / WebView2 / desktop child process 全部移除。
   - `mise run dev` 使用纯 Node 开发启动器同时拉起 Fastify 与 Vite。
   - `mise run build` 产出 `dist/server.cjs + dist/web/`。
   - `mise run start` 以同源 Node Server 运行。
   - 旧 Tauri 设计文档移入 archive。

5. **Operator WebSocket / lifecycle / auth（已完成并验证）**
   - `/operator/ws` 已替换轮询 / HTTP delta transport。
   - 已实现 eventId、sequence、ack、命令去重、重连快照 / 回放、取消与超时。
   - 前端完成最低限度 WebSocket、重发、确认状态和 Operator 登录接线；当前以能编译、能启动为验收标准。
   - `/v1/*` 使用 Bearer API key，`/operator/*` 使用独立的 HttpOnly Cookie 登录态。
   - 已增加 Origin 校验、受控 CORS、请求 / WS 大小限制，以及非 loopback 缺少凭据时拒绝启动。

6. **Packaging / Docker（已完成并验证）**
   - 增加本地多阶段 Dockerfile；不引入 compose、GHCR 或 portable package。
   - 镜像以无特权 `node` 用户运行，并带 HTTP healthcheck。
   - 默认单进程同源部署，同时保留独立前端部署能力。

7. **Correction**
   - 输出保持 append-only。
   - 删除已发 Final / Thinking 不回滚远端，而是追加 `correction(deleted, source)`。
   - 删除已发 Final 时，在支持 reasoning 的协议中表现为 Thinking 的 `~~deleted text~~`。
   - 连续 Backspace 尽量合并。

8. **Tool Calling**
   - 标准 function/tool call 协议闭环。
   - JSON Schema 参数 UI 与双端校验。
   - 工具由 Agent / Client 执行。

9. **Responses API**
   - 保持 core 与协议解耦。
   - 增加 Responses Adapter，正式承载 Thinking / reasoning。

10. **Bypass / Breakpoint**
    - 接入 OpenAI-compatible upstream model。
    - Human / upstream 共享 output sink。
    - Passthrough、Breakpoint、Inspect、Modify、Takeover。
    - 同一 response 始终只有一个明确 output owner。

## 核心边界

```text
                         +-> Browser Human Operator
                         |
Agent -> Protocol Adapter -> Request Core -> Output Sink -> Agent
                         |
                         +-> Upstream LLM
```

内部事件保持协议无关：

```text
reasoning_delta(text, source)
text_delta(text, source)
correction(deleted, source)
tool_call(name, arguments, source)
finish(source)
pause / resume / takeover
```

当前已实现 `request_started`、`reasoning_delta`、`text_delta`、`finish`、`cancel`、`timeout` 与 `failure`。

## 当前协议与安全约束

- `GET /v1/models`。
- `POST /v1/chat/completions` 支持 streaming / non-streaming。
- Final 使用 `content`，Thinking 当前 Chat Completions compatibility adapter 使用 `reasoning` 扩展。
- Operator 使用 `/operator/ws`；服务端事件带 eventId / sequence，客户端命令带 commandId 并由 ack 确认。
- 服务本身不执行客户端工具。
- Loopback 开发可不配置凭据；非 loopback 监听必须同时提供 Agent API key 与 Operator 密码。
- Operator 登录态使用 HttpOnly Cookie，并校验同源或显式允许的 Origin；公网部署仍应由可信反向代理提供 HTTPS。

## 后续验收顺序

1. ✅ 非流式 Chat Completion -> Human Final -> completion。
2. ✅ Final SSE / Live -> `delta.content` -> `[DONE]`。
3. ✅ Thinking SSE / Live -> `delta.reasoning` -> Final `delta.content` -> `[DONE]`。
4. ✅ Web-first dev：Fastify `:3000`、Vite `:5173` 及 Vite API proxy 已通过 CLI 验证。
5. ✅ 同源 production build：server / web build 与静态服务有自动测试及 Docker smoke test。
6. ✅ Operator WebSocket + auth + ack / reconnect / cancel / timeout。
7. ✅ 本地 Dockerfile build、health、静态页面与 API 鉴权。
8. Correction。
9. Tool Calling。
10. Responses API。
11. Bypass / Breakpoint。
