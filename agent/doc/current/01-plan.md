# Artisanal Intelligence · 能工智人

## 目标与现状

真人扮演模型：客户端发送 conversation / tools，操作员输入 Thinking、Final 或工具调用，服务包装为兼容响应。服务本身不执行工具，也不代理上游模型。

已完成工程骨架、健康检查、双输入框预览和格式化；当前接入 Tauri 桌面 GUI，暂停 CI。推理接口、流式输出、工具调用尚未实现。桌面入口与验证进展见 [桌面接入](02-desktop.md)，历史结论见 [初始化归档](../archive/01-bootstrap.md)。

## 技术与运行

- mise 固定 Node.js / Rust，npm 和 Cargo 分别管理依赖及锁文件；具体版本以项目配置为准。
- Tauri 2 桌面窗口加载 Vue 3 + TypeScript + Vite + 普通 CSS，状态使用 composable；Fastify 后端，内存 Map 保存请求。
- 操作台通过 WebSocket 提交事件，客户端通过 SSE 接收流式输出；非流式请求累计到结束后一次性返回。
- Vue 递归组件生成工具表单，AJV 校验。MVP 不引入 Router、Pinia、Nuxt、大型 UI 库、monorepo、数据库或 Redis。
- 开发：`mise run dev` 打开 Tauri 窗口，Vite 仅用于热更新。`mise run start` 使用构建后的前端直接打开 GUI。Tauri 管理独立 Fastify 子进程，默认本机端口 3000，`PORT` 可覆盖；退出应用清理后端。当前健康检查通过 Tauri IPC 转发，后续操作员事件连接在实现时补齐。
- 本地检查：`mise run check` 安装锁定依赖、检查格式与类型、测试并构建前后端；`mise run check-desktop` 检查 Rust。格式化用 `npm run format`（含 Rust）。CI 已暂停，旧工作流归档且不自动执行。

## MVP 协议与交互

- 优先实现 `GET /v1/models`、`POST /v1/chat/completions`；Responses API 后续再做。
- 可接收但忽略 temperature、top_p、seed、max_tokens、frequency_penalty、presence_penalty、reasoning_effort；推理由操作员决定。
- 展示完整 conversation 和工具结果。Thinking / Final 双输入框同时显示，输入位置决定通道，无通道切换按钮。
- 一个全局 Live / Buffered 开关；Buffered 时两框独立发送，只提交各自未发送内容，发送不等于结束响应。
- Live 在实际文本或 IME composition 提交后发送，不能按 keydown 发送组合输入。
- Buffered → Live 不自动发草稿；有草稿的框先显式发送或清空，再进入 Live。Live → Buffered 后仅新输入进入草稿，已提交事件继续确认。
- 独立 `Finish Response`；结束前处理未发送草稿并等待事件确认。

## 纠正与工具

- 输出 append-only。尚未提交 WebSocket 的草稿可自由修改；已提交但未确认的事件不能当作可撤回草稿。
- 本地仍可编辑已发内容；删除部分通过 `correction` 追加为 Thinking 中的 `~~deleted text~~`，替换文字追加到原通道。连续删除尽量合并，不撤回远端字符。
- Schema 基础映射：string → 文本框，number/integer → 数字框，boolean → 复选框，enum → 下拉框，array → 可增删列表，object → 嵌套表单。
- 明确支持的 Schema 子集；不支持的结构显示原因并阻止提交，不静默忽略约束。前后端均校验参数。
- MVP `Call` 提交一个工具调用并结束当前响应；提交前处理草稿、等待已有事件确认并校验工具名和参数。工具由客户端执行，结果随下一轮请求展示。

## 事件与生命周期

- UI 与协议 Adapter 解耦。内部事件：`reasoning_delta(text)`、`text_delta(text)`、`correction(deleted)`、`tool_call(name, arguments)`、`finish`。
- 请求保存 id、messages、tools、createdAt、abortSignal；事件信封包含 requestId、eventId、递增 sequence。
- MVP 同时只接受一个未完成请求，忙碌时明确拒绝。状态为 `pending → active → finished`，也可进入 `cancelled` / `failed`；终态不能重新写入或重复结束。
- 客户端断开或请求超时：取消、清理连接及定时器，通知 UI。操作台断线：在可配置期限内保留请求供重连，超时终止。服务重启不恢复内存请求。
- 服务端按序处理并按 eventId 去重；确认表示服务端已接受，不保证客户端已读取。UI 区分草稿、待确认和已确认内容。
- 重连先同步状态、已确认序号和输出快照，再沿用原 ID 重试未确认事件。终态及去重信息有限期保留；过期请求明确拒绝。
- reasoning 字段及不支持独立通道的客户端降级策略在实现 Adapter 时核对、记录，不预先宣称全面兼容。

## 后续顺序与验收

1. **最小文本闭环**：模型列表 → 请求 → conversation → 双输入框 Buffered 发送 → 独立结束；验证流式与非流式输出。
2. **实时与生命周期**：Live / IME、草稿切换、确认去重、取消超时和重连；验证不提前发送、不重复输出、终态不可写入。
3. **工具调用**：Schema 表单、校验、调用结束、下一轮工具结果；验证无需手写 JSON、错误参数被拒绝。
4. **纠正与接入**：已发内容删除纠正及合并、真实目标客户端接入；记录兼容限制。

每阶段补充必要本地测试：普通路由用 Fastify 注入测试；SSE / WebSocket 与断线用真实连接测试；UI 覆盖双输入框、IME、草稿切换和纠正。测试模拟操作员，不依赖真人或上游密钥。暂不运行 CI。

后续候选：Responses API、多模态、更多客户端、多会话队列、请求历史与远程操作员。MVP 不做多用户调度、自动推理、tokenizer、sampling 或 KV cache。
