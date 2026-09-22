---
name: workplane
description: >-
  Use when rendering, checking, repairing, or initializing a project's current
  Work Unit graph, plus optional explicit impacts from existing Tracker Designs,
  with the standalone Workplane CLI. Work Units remain usable when no Design
  history exists. Reads a Project Tracker snapshot; never edits PROJECT_STATE.md.
---

# Workplane

Use the installed `workplane` CLI. Never reimplement schema or rendering logic
in prompts. If the command is missing, read
[installation](references/installation.md); do not fetch a package or install
Project Tracker implicitly.

## 入口：先分清谁拥有什么

Workplane 只拥有一件事：**当前功能结构**。每个项目在自己的仓库根保存并提交
`WORKPLANE.json`，里面是 Work Unit、功能分组、依赖、接口、锚点和当前完成标准；
可选的 `Design affects Work Unit[]` 只把已有历史叠加到当前结构上。

Project Tracker 继续拥有 Project Goal、Feature Goal、Design 的逻辑演进、逐 Design
进展、Design 验收、证据和 `PROJECT_STATE.md`。Work Unit 的存在不依赖 Tracker 中
存在 Design。Workplane 不读 State、不读 Pi 会话、不运行 Git、不维护验证库。

## 三个硬功能入口

配对的 Pi extension 会在 Skill 展开前绑定项目根、运行只读预检并显示固定菜单。数字只对
本次菜单和项目有效；普通输入、取消或会话切换都会使旧菜单失效。

1. **渲染 Workplane 视图**：只使用已有快照和证据，不运行项目检查，不修改
   `WORKPLANE.json`；生成最新派生视图后结束，绝不自动进入入口 2。定义缺失或无效时
   停止并说明应选哪个入口。
2. **检查项目并刷新或修复 Workplane**：运行项目已有且获准的检查，保留失败证据并
   据实重算完成度。刷新只更新证据、派生状态和视图；修复定义必须先展示影响和提案，
   等用户确认后才能写入。本入口最后自行校验和渲染，然后结束。
3. **初始化 Workplane**：只在 `WORKPLANE.json` 不存在时，根据当前功能、边界、接口、
   依赖和锚点提出初始图。确认前不写文件；已有定义不得覆盖。写入后在本入口内部校验并
   生成首次视图，然后结束。

三个入口彼此独立。不得把内部复用的校验或渲染步骤说成跳到了另一个入口。

## 从视图发起具体修改

不提供笼统的“修改工作面”主入口。用户应先查看工作面，再从具体 Work Unit、范围、接口
或完成标准旁的“问”“改”复制带位置、当前内容、期望内容和理由的请求。收到“改”请求后，
先说明会影响哪些模块或完成标准并等待确认；确认后才更新 `WORKPLANE.json`、校验并渲染。

## 定义规则与零 Design 分支

读 [authoring](references/authoring.md) 了解文件形状。根据当前功能、边界、接口、依赖和
锚点建立 Work Unit；只有 Tracker 已有 Design 且影响关系明确时才提出 `designImpacts`。
定义改动必须经过用户审图确认。


Tracker 没有 Goal 或 Design 是合法状态，不是需要由 Workplane 修补的缺口。此时照常
建立和审阅当前 Work Unit 图，把 `designImpacts` 保持为空。不要为了建立 Work Unit
而创建 Design，也不要从原始设计文档、Progress、路径、名称或 Git 历史补造 Tracker
历史。以后出现真实的 Tracker Design 时，再单独审阅可选映射。

## 内部命令

这些是三个功能入口复用的实现能力，不要把它们额外列成用户菜单：

- `workplane inspect [project-root] --request-id <uuid>`：只读检查定义是否缺失、可用或需修复，
  返回绑定本次请求的有界回执，不写文件。
- `workplane plugin`：从 stdin 读一个带版本的 JSON 请求，向 stdout 写一个 JSON
  响应。这是 Project Tracker 集成用的机器边界，不要在交互里直接读它。
- `workplane validate <WORKPLANE.json> --snapshot <snapshot.json>`：只检查，不写任何文件。
- `workplane render <WORKPLANE.json> --snapshot <snapshot.json> --out <dir>`：把
  `workplane.json`、`workplane.mmd`、`workplane.html` 写入指定目录；这两个输入文件
  不会被修改。

Tracker 快照里的已有 Design 可以通过 `designImpacts` 显式关联到 Work Unit。
`designImpacts` 为空时不需要 Goal 或 Design；只有实际填写的映射引用了未知 Goal、
Design 或 Work Unit 时才是阻塞错误，不能从路径或名字猜测映射。

## 边界提醒

- 修改 Goal、Feature Goal 或 Design：属于 Project Tracker，不是 Workplane。
- 修改 Work Unit 或 `designImpacts`：先出提案并让用户确认，再写入 `WORKPLANE.json`。
- 日常开发进展记录在具体 Design 上，仍用 Tracker 的 `state record`；Workplane 只读展示，
  不新增 Work Unit 进展日志。
- 查看页面、通过检查、Git 提交或某个 Work Unit 完成，都不等于某个 Design 或 Goal 完成。
- 不要用一次通用测试通过去自动勾选任何 Design 验收。
