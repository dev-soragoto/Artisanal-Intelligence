# Artisanal Intelligence

[English](README.md) | **简体中文**

**能工智人————可能是世界上最强视觉输入模型**

一个由真人驱动的模型服务。由操作者负责思考、输入回复、选择工具。对外实现 OpenAI-compatible API。

你们天天在这里指挥 LLM 干活，你们考虑过 LLM 的感受吗，能工智人可以让你沉浸式体验被 Agent 工具支配的恐怖。

## 我们的突破性架构

- **无需 GPU。** 推理引擎就坐在显示器前面。
- **每 100 万 token 仅需 1 个馒头。** 我们基于碳水的定价愿景。实际吞吐量取决于打字速度和午饭质量。
- **100% 手工推理。** 每个 token 都从某人的大脑就地取材。
- **真正会休眠的模型。** 操作员睡了，你的 SLA 也就睡了。

## 等等……严肃点

玩笑归玩笑，Artisanal Intelligence 并不只是一个让你假装成 LLM 的工具。

它天然允许你在 LLM 的“大脑”里打断点，观察、修改，甚至随时接管执行。

或许可用于 **Agent 调试、攻防模拟**，以及其他一些我们还没想到的奇怪用途。

## 现在能做什么


当前 inference path 已支持流式 / 非流式 `POST /v1/chat/completions`、Buffered / Live Final，以及 Buffered / Live Thinking。Final 使用 `content`；当前 Chat Completions 兼容层通过生态扩展字段 `reasoning` 暴露 Thinking。

Operator control plane 使用 `/operator/ws`，支持带序号的事件、命令确认、重复抑制、重连快照与事件回放。请求可以取消，并具有可配置的超时。OpenAI-compatible API 与 Operator Console 使用互相独立的鉴权边界。

## 开始使用

安装 [mise](https://mise.jdx.dev/)，然后在仓库根目录执行。mise 会安装项目固定的 Node.js 工具链。

```sh
mise trust
mise install
mise run install
mise run dev
```

开发模式下 Fastify 监听 `127.0.0.1:3000`，Vite Operator Console 监听 `127.0.0.1:5173`。Vite 会把 `/api`、`/v1` 和 `/operator` 代理到 Fastify。

Loopback 开发环境不强制配置凭据。配置凭据后，客户端访问 `/v1/*` 时发送 `Authorization: Bearer <ARTISANAL_API_KEY>`，人类 Operator 则在浏览器中使用 `ARTISANAL_OPERATOR_PASSWORD` 登录。

本地按生产方式运行：

```sh
mise run build
mise run start
```

然后打开 `http://127.0.0.1:3000`。构建后的 Fastify 进程会在同一 Origin 下同时提供 OpenAI-compatible API 和 `dist/web/`。

## 鉴权与生命周期

监听非 loopback 地址时，必须同时配置两类鉴权，否则服务会拒绝启动：

```sh
ARTISANAL_API_KEY=replace-me \
ARTISANAL_OPERATOR_PASSWORD=replace-me-too \
HOST=0.0.0.0 \
npm start
```

`ARTISANAL_REQUEST_TIMEOUT_MS` 默认是五分钟。独立部署 Operator Console 时，需要把其精确 Origin 加入逗号分隔的 `ARTISANAL_OPERATOR_ORIGINS`。跨站 Cookie 还需要设置 `ARTISANAL_OPERATOR_COOKIE_SAMESITE=none`、`ARTISANAL_OPERATOR_COOKIE_SECURE=1` 并使用 HTTPS。全部配置参见 [.env.example](.env.example)。

## Docker

在本地构建并运行同源生产服务：

```sh
docker build -t artisanal-intelligence:local .
docker run --rm -p 3000:3000 \
  -e ARTISANAL_API_KEY=replace-me \
  -e ARTISANAL_OPERATOR_PASSWORD=replace-me-too \
  artisanal-intelligence:local
```

运行时镜像只包含 Node.js 和构建后的 `dist/`，使用无特权 `node` 用户运行，并内置 HTTP 健康检查。

## 部署形态

默认部署方式是一个 Node 进程，同源提供 Web UI 与 API。`HOST`、`PORT` 控制监听地址；`ARTISANAL_WEB_ROOT` 可以覆盖静态资源目录，`ARTISANAL_SERVE_WEB=0` 可以关闭内置 Web 静态资源服务。

Web UI 会在运行时读取 `/config.js`。分离部署时可设置 `window.__ARTISANAL_CONFIG__.apiBase`，让同一份前端 build 指向另一个 API Origin 或反向代理路径。公网部署应由可信反向代理终止 HTTPS，并配置精确的 Operator Origin。

## 保持整洁

```sh
npm run format        # 格式化 TypeScript、Vue、配置和文档
npm run format:check  # 只检查格式，不修改文件
npm test              # 运行后端单元与端点测试
npm run test:coverage # 输出后端覆盖率报告
```

## 许可证

[MIT](LICENSE)。大脑自备，馒头另购。
