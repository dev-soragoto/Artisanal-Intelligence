# Artisanal Intelligence

[English](README.md) | **简体中文**

**能工智人————可能是世界上最强视觉输入模型**

一个由真人驱动的模型服务。由操作者负责思考、输入回复、选择工具。对外实现 OpenAI 接口

你们天天在这里指挥 LLM 干活，你们考虑过 LLM 的感受吗，能工智人可以让你沉浸式体验被 Agent 工具支配的恐怖。

## 我们的突破性架构

- **无需 GPU。** 推理引擎就坐在显示器前面。
- **每 100 万 token 仅需 1 个馒头。** 我们基于碳水的定价愿景。实际吞吐量取决于打字速度和午饭质量。
- **100% 手工推理。** 每个 token 都从某人的大脑就地取材。
- **真正会休眠的模型。** 操作员睡了，你的 SLA 也就睡了。

## 现在能做什么

桌面骨架采用 Tauri 2 + Vue 3 + TypeScript + Vite + 普通 CSS。GUI 自动管理 Fastify 后端，展示独立的 **Thinking** 和 **Final** 输入框预览。

推理接口、流式输出和工具调用**尚未实现**。我们计划提供 OpenAI-compatible 接口，让现有 Agent 把真人当作模型使用。目前服务已就位，馒头经济学仍在研发中。

## 开始使用

安装 [mise](https://mise.jdx.dev/) 和 [Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)（Windows 需要 C++ Build Tools 和 WebView2），然后在仓库根目录执行。mise 会安装项目固定的 Node.js 和 Rust 工具链。

```sh
mise trust
mise install
mise run install
mise run dev
```

`mise run dev` 打开带热更新的桌面 GUI。`mise run start` 构建前端后直接打开 GUI，不启动 Vite 服务。应用自动在 3000 端口启动本地 API，退出时关闭；请先停止旧的独立服务，或设置 `PORT` 使用其他端口。

`mise run build-desktop` 在 `src-tauri/target/release/` 生成原生程序，使用时需保留旁边的 `resources/` 目录。`npm run bundle` 生成包含 Node.js 运行时的 Windows 安装包。首次 Rust 编译耗时较长。

## 保持整洁

```sh
npm run format        # 格式化 TypeScript、Vue、Rust、配置和文档
npm run format:check  # 只检查格式，不修改文件
```


## 许可证

[MIT](LICENSE)。大脑自备，馒头另购。
