# 编写 WORKPLANE.json

## 总框架

`WORKPLANE.json` 只描述**当前功能结构**。Work Unit 根据当前功能、边界、接口、
依赖和锚点定义，不以 Tracker 是否已有 Design 为前提。它有两类基础关系，必须分开：

- 包含关系：用 `parent`，形成 项目根 → 功能分组 → Work Unit 的层级；
- 依赖关系：用 `edges.dependsOn`，表示运行或使用上的先后。

`designImpacts` 是可选的第三类关系。它不在 Work Unit 里声明，只在 Tracker 已有
Design 且影响关系明确时形成多对多桥接。这样一张图回答“现在由哪些功能组成”，
另一张图回答“已有历史设计改动了哪些功能”。没有 Design 时保持空数组，不影响
Work Unit 图成立。

## 顶层字段

```json
{
  "schemaVersion": 1,
  "groups": [{ "id": "goals", "title": "目标与设计" }],
  "units": [],
  "designImpacts": [],
  "glossary": []
}
```

不要在这里写 Project Goal 文本、Design 的 parents、Design 进展或验收、验证历史。
这些由 Project Tracker 通过快照提供。

## Work Unit

- `id`：小写 kebab，稳定身份；不要因为标题变化而改 id。
- `title`、`kind`（`capability` / `interface` / `support`）。
- `function`：`does` 一句话；`inScope` / `outOfScope` 各列边界。
- `contract`：`provides` / `consumes`，对外提供和依赖的接口。
- `acceptance`：每条一个完成标准，`check` 三种：
  - `verification`：指向一条验证命令；
  - `test`：指向测试文件，`command` 默认 `npm test`；
  - `manual`：只能人工确认，永远不会自动升级为已验证。
- `anchors`：`code` / `docs` 是仓库内相对路径，`map` 是逻辑名；builder 不会去磁盘检查。
- `operations`：`inspect` / `change` / `verify` / `record` 的子集。
- `parent`：包含关系的父节点（分组 id、另一个 unit id，或省略表示挂在项目根）。
- `blocked`：可选，`{ "reason": "..." }`，显式受阻会覆盖其它状态。

## 状态如何派生

状态不是写出来的，而是根据 Tracker 快照里的验证记录派生的：

- 只有 `result: PASS` 且 `freshness: current` 才算 `verified`；
- `stale`、`missing`、`FAIL`、`manual` 都不能升级为已验证；
- 出现任一失败或缺失时，单元是 `partial`；
- `blocked` 优先于其它结论。

## 写作规则

- 面向用户的文字优先用普通话，不堆内部术语；必须出现的说法写进 `glossary` 并解释。
- 完成标准一条一个要点，不要一句话塞多个交付点。
- 关系只能显式声明：不要指望从路径、锚点或名字自动推断依赖或设计影响。

## 零 Design 与可选映射

- Tracker 快照没有 Goal/Design 时，`designImpacts` 必须保持 `[]`；
- 不要为了建立 Work Unit 而创建或补造 Design；
- 不从设计文档、Progress、路径、名称、Git 顺序或代码锚点猜测影响关系；
- 将来已有 Design 需要桥接时，再把明确且经用户审阅的映射加入数组；
- 未填写映射不报错；已填写但引用未知 Goal、Design 或 Work Unit 才报错。

## 修改流程

1. 根据当前功能结构先提出 Work Unit、包含关系和依赖；
2. 若存在明确的历史 Design 影响，再提出可选映射；
3. 向用户展示会影响哪些模块并等待确认；
4. 确认后再写入并由 Tracker 安全落地；
5. 重新运行 `workplane validate` 和 `workplane render`。
