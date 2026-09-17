# Artisanal Intelligence · 能工智人

## 目标与现状

Artisanal Intelligence 是 Human-as-a-Model 服务，也是面向 Agent / LLM 的人工推理断点与接管层。客户端发送 conversation / tools，Human Operator 输入 Thinking、Final 或工具调用，服务将人工操作包装成兼容模型响应。

当前 inference core 已经跑通：Buffered Final、Chat Completions SSE、Live Final、Thinking SSE 均已实现；迁移前版本已经通过 Windows `curl.exe -N` 手工验证。

**Web-first migration 已完成代码改造，等待人工复测。** Tauri / Rust 桌面宿主已经移除，Vue 直接通过 HTTP 连接 Fastify。Fastify 是产品核心，Browser Operator Console 是人类推理终端。

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

生产 server 使用 esbuild 打成单个 `dist/server.cjs`，Web 资源位于 `dist/web/`。后续 portable package 只需要携带 Node runtime、`server.cjs` 与 `web/`。

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

4. **Web-first migration（代码已完成，待复测）**
   - Tauri IPC 已替换为 Browser `fetch`。
   - Operator HTTP 路径改为 `/operator/*`。
   - Tauri / Rust / WebView2 / desktop child process 全部移除。
   - `mise run dev` 使用纯 Node 开发启动器同时拉起 Fastify 与 Vite。
   - `mise run build` 产出 `dist/server.cjs + dist/web/`。
   - `mise run start` 以同源 Node Server 运行。
   - 旧 Tauri 设计文档移入 archive。

5. **Operator WebSocket / lifecycle / auth（下一阶段）**
   - 实现 `/operator/ws` 正式 control plane，替换当前轮询 / HTTP delta transport。
   - 增加 eventId、sequence、ack、去重、断线重连、取消与超时。
   - UI 区分本地草稿、待确认和已确认输出。
   - `/v1/*` 与 `/operator/*` 建立独立鉴权边界。
   - 公网部署前增加 Operator 登录态、Origin 校验与基础安全约束。

6. **Packaging / Docker**
   - 增加 Dockerfile / compose 一键运行。
   - 发布 GHCR 镜像。
   - 增加 portable Node runtime 打包方案。
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

当前已实现 `reasoning_delta`、`text_delta` 与 `finish`。

## 当前协议与安全约束

- `GET /v1/models`。
- `POST /v1/chat/completions` 支持 streaming / non-streaming。
- Final 使用 `content`，Thinking 当前 Chat Completions compatibility adapter 使用 `reasoning` 扩展。
- Operator 当前仍使用 HTTP polling + POST delta / finish，下一阶段替换为 WebSocket。
- 服务本身不执行客户端工具。
- 当前 Operator endpoint 尚未实现公网鉴权；即使 Server 已支持 `HOST=0.0.0.0`，在 auth 阶段完成前也不要直接裸露到公网。

## 后续验收顺序

1. ✅ 非流式 Chat Completion -> Human Final -> completion。
2. ✅ Final SSE / Live -> `delta.content` -> `[DONE]`。
3. ✅ Thinking SSE / Live -> `delta.reasoning` -> Final `delta.content` -> `[DONE]`。
4. **待测 Web-first dev**：`mise run dev` -> 浏览器 `:5173` -> Agent / curl `:3000` -> Thinking / Final 正常返回。
5. **待测同源 production build**：`mise run build && mise run start` -> 浏览器与 `/v1/*` 同源工作。
6. Operator WebSocket + auth + ack / reconnect / cancel。
7. Docker / portable package。
8. Correction。
9. Tool Calling。
10. Responses API。
11. Bypass / Breakpoint。
