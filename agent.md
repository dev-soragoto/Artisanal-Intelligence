# 本地开发环境

## 项目名称

- 英文名称：**Artisanal Intelligence**。
- 中文名称：**能工智人**。
- 文档与对外介绍统一使用上述名称。中英文 README 的章节与内容保持一一对应。

## Agent 工作目录约定

- `agent/` 是 Agent 的工作目录。
- `agent/doc/` 纳入 Git 版本管理，分为 `current/` 和 `archive/`。
- `current/` 只保留当前及近期工作需要的计划、设计、待办和关键约束；开始工作时优先阅读，入口为 [当前计划](agent/doc/current/01-plan.md)。
- `archive/` 保存已完成或暂时不再需要的记录。每次使用文档后检查其用途，发现近期可能用不到就主动归档，并更新相关链接；需要时再查阅或移回 `current/`。
- 文档保持精简，优先更新已有文档，合并重复结论，不为每次小改动单独新增流水账。归档时保留有价值的决策、验证结论和限制。
- 文件名不要求日期，可用数字索引加主题，如 `01-plan.md`、`01-bootstrap.md`；归档文件不作为当前状态的依据。
- `agent/` 中除 `doc/` 外的所有内容均被 Git 忽略；Agent 可以在这些目录内自行创建、修改、清理临时脚本、日志、缓存和实验产物，无需逐项确认。
- 正式源码、项目配置与测试仍放在仓库对应目录，不放入被忽略的临时工作目录。
- 不覆盖已有用户文件；目录操作权限不代表可以终止无关进程或修改仓库外文件。

## mise 初始化

本项目使用 mise 管理本地开发工具与运行时版本。

Windows 上的 mise 路径：

```text
C:\Users\soragoto\AppData\Local\Microsoft\WinGet\Links\mise.exe
```

在 PowerShell（pwsh）中运行开发命令前，先初始化当前会话：

```powershell
mise activate pwsh | Out-String | Invoke-Expression
```

如果当前会话无法通过 PATH 找到 mise，可使用完整路径初始化：

```powershell
& 'C:\Users\soragoto\AppData\Local\Microsoft\WinGet\Links\mise.exe' activate pwsh | Out-String | Invoke-Expression
```

初始化仅作用于当前 PowerShell 会话。启动新的独立 shell 进程后，需要重新初始化；自动化执行时，应在同一会话中完成初始化和后续开发命令。

项目工具版本与公共任务集中配置在 `mise.toml` 中。当前使用 Tauri 桌面 GUI，默认启动入口为 `mise run dev` / `mise run start`，不再以浏览器作为操作台。Node.js 与 Rust 均由 mise 管理。

CI 暂停，不创建或启用自动工作流；按需在本地执行 `mise run check` 和 `mise run check-desktop`。旧工作流仅归档于 `agent/doc/archive/ci.yml.disabled`，恢复前需要用户明确要求。以上绝对路径仅适用于当前 Windows 开发机器。
