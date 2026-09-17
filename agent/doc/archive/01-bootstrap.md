# 初始化与文档整理（已归档）

本记录合并原环境初始化、格式化 / LTS 核对及双语 README 记录，仅保留历史结论。当前任务见 [当前计划](../current/01-plan.md)，运行状态需重新检查。

- 建立 Vue / Fastify 工程、`/api/health`、禁用的 Thinking / Final 预览、静态托管和 Linux / Windows CI 配置。
- mise 固定 Node.js 24.21.0，实际运行时标记为 Krypton LTS；依赖精确版本及锁文件已生成。
- 初装 TypeScript 与 vue-tsc 不兼容，固定 5.9.3 后检查通过。升级时需复查兼容性。
- Prettier 接入 format / format:check 与 CI；忽略产物、依赖、锁文件和 Agent 临时目录，未引入 TOML 插件。
- 本地格式、类型、测试、构建及首页 / 健康检查曾验证通过；远端 CI 当时未执行。npm 曾提示 esbuild 安装脚本未列入 allowScripts，但检查通过，未全局放开脚本权限。
- 服务日志和 PID 位于被忽略的 `agent/run/`；历史 PID 不保留为操作依据，停止进程前核对实际命令行。
- README 默认英文，链接中文，内容逐项对应；按用户中文修订同步英文。正式名称及目录规则统一维护在根目录 `agent.md`。
- 文档已改为 current / archive，原长设计压缩为当前计划，重复图示、示例和过程流水账已合并。
