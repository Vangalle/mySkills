# 安装与卸载

Workplane 与 Project Tracker 独立安装、独立失败、独立卸载。

## 安装

在本仓库运行：

```bash
node scripts/install-skill.mjs
```

默认目标：

- skill：`~/.pi/agent/skills/workplane`
- launcher：`~/.local/bin/workplane`

可用 `--skills-dir <dir>`、`--bin-dir <dir>` 指定其它位置。安装后会写入来源与文件
摘要标记（`.workplane-source.json`）；重复安装是幂等的。

安装后可运行：

```bash
workplane --help
```

在 Pi 中 `/reload` 或启动新会话来加载 `/skill:workplane`。

## 卸载

```bash
node scripts/install-skill.mjs --uninstall
```

只删除 Workplane 自己拥有、且自安装后未被修改过的 skill 和 launcher。若目标来自其它
来源、被符号链接替换、或文件被编辑过，安装器会拒绝覆盖或删除并报错，不做部分修改。

## 与 Project Tracker 的关系

- Workplane 安装器不安装、不修改、不删除任何 Tracker 扩展或文件；
- 卸载 Workplane 不影响 Tracker；
- 卸载 Tracker 不会删除独立安装的 Workplane；
- Tracker 未安装 Workplane 时仍可完整工作。

## 与 Tracker 的快照对接

单独使用时，先由 Tracker 导出一个快照文件，再执行：

```bash
workplane validate WORKPLANE.json --snapshot snapshot.json
workplane render WORKPLANE.json --snapshot snapshot.json --out out/
```

作为插件时，Tracker 用参数数组启动 `workplane plugin`，通过 stdin/stdout 传递单一
JSON 请求与响应；协议版本不匹配或结构非法时返回结构化错误，不会复用上一次结果。
