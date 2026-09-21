---
name: workplane
description: >-
  Use when defining, validating or rendering a project's Work Unit graph and its
  explicit Design→Work Unit impacts with the standalone Workplane CLI. Reads a
  Project Tracker snapshot; never edits PROJECT_STATE.md.
---

# Workplane

Use the installed `workplane` CLI. Never reimplement schema or rendering logic
in prompts. If the command is missing, read
[installation](references/installation.md); do not fetch a package or install
Project Tracker implicitly.

## 入口：先分清谁拥有什么

Workplane 只拥有一件事：**当前功能结构**。每个项目在自己的仓库根保存并提交
`WORKPLANE.json`，里面是 Work Unit、功能分组、依赖、接口、锚点、当前完成标准和
`Design affects Work Unit[]`。

Project Tracker 继续拥有 Project Goal、Feature Goal、Design 的逻辑演进、逐 Design
进展、Design 验收、证据和 `PROJECT_STATE.md`。Workplane 不读 State、不读 Pi 会话、
不运行 Git、不维护验证库。

先给地图，再进细节：

1. 读 [authoring](references/authoring.md) 了解 `WORKPLANE.json` 的形状和写作规则；
2. 定义改动必须经过用户审图，确认后再写入；
3. 用 `workplane validate` 检查结构，用 `workplane render` 生成只读视图。

## 命令

- `workplane plugin`：从 stdin 读一个带版本的 JSON 请求，向 stdout 写一个 JSON
  响应。这是 Project Tracker 集成用的机器边界，不要在交互里直接读它。
- `workplane validate <WORKPLANE.json> --snapshot <snapshot.json>`：只检查，不写任何文件。
- `workplane render <WORKPLANE.json> --snapshot <snapshot.json> --out <dir>`：把
  `workplane.json`、`workplane.mmd`、`workplane.html` 写入指定目录；这两个输入文件
  不会被修改。

Tracker 快照里的 Design 通过 `designImpacts` 显式关联到 Work Unit。未知 Goal、
Design 或 Work Unit 是阻塞错误，不能从路径或名字猜测映射。

## 边界提醒

- 修改 Goal、Feature Goal 或 Design：属于 Project Tracker，不是 Workplane。
- 修改 Work Unit 或 `designImpacts`：先出提案并让用户确认，再写入 `WORKPLANE.json`。
- 日常开发进展记录在具体 Design 上，仍用 Tracker 的 `state record`；Workplane 只读展示，
  不新增 Work Unit 进展日志。
- 查看页面、通过检查、Git 提交或某个 Work Unit 完成，都不等于某个 Design 或 Goal 完成。
- 不要用一次通用测试通过去自动勾选任何 Design 验收。
