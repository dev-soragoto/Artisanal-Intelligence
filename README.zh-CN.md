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

Artisanal Intelligence 现已改为 Web-first 架构。Tauri 桌面宿主已经移除：Fastify 是真正的服务端，Vue Operator Console 直接运行在普通浏览器中。

当前 inference path 已支持流式 / 非流式 `POST /v1/chat/completions`、Buffered / Live Final，以及 Buffered / Live Thinking。Final 使用 `content`；当前 Chat Completions 兼容层通过生态扩展字段 `reasoning` 暴露 Thinking。


## 开始使用

安装 [mise](https://mise.jdx.dev/)，然后在仓库根目录执行。mise 会安装项目固定的 Node.js 工具链。

```sh
mise trust
mise install
mise run install
mise run dev
```

开发模式下 Fastify 监听 `127.0.0.1:3000`，Vite Operator Console 监听 `127.0.0.1:5173`。Vite 会把 `/api`、`/v1` 和 `/operator` 代理到 Fastify。

本地按生产方式运行：

```sh
mise run build
mise run start
```

然后打开 `http://127.0.0.1:3000`。构建后的 Fastify 进程会在同一 Origin 下同时提供 OpenAI-compatible API 和 `dist/web/`。

## 部署形态

默认部署方式是一个 Node 进程，同源提供 Web UI 与 API。`HOST`、`PORT` 控制监听地址；`ARTISANAL_WEB_ROOT` 可以覆盖静态资源目录，`ARTISANAL_SERVE_WEB=0` 可以关闭内置 Web 静态资源服务。

Web UI 会在运行时读取 `/config.js`。分离部署时可设置 `window.__ARTISANAL_CONFIG__.apiBase`，让同一份前端 build 指向另一个 API Origin 或反向代理路径。

**当前不要直接把 Operator 接口裸露到公网。** Operator 鉴权与 WebSocket control plane 是下一阶段的基础设施目标。

## 保持整洁

```sh
npm run format        # 格式化 TypeScript、Vue、配置和文档
npm run format:check  # 只检查格式，不修改文件
```

## 许可证

[MIT](LICENSE)。大脑自备，馒头另购。
