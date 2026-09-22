# 安装与卸载

Workplane 与 Project Tracker 独立安装、独立失败、独立卸载。

## 安装

在本仓库运行：

```bash
node scripts/install-skill.mjs
```

默认目标：

- skill：`~/.pi/agent/skills/workplane`
- Pi 输入扩展：`~/.pi/agent/extensions/workplane/index.ts`
- launcher：`~/.local/bin/workplane`

可用 `--skills-dir <dir>`、`--extensions-dir <dir>`、`--bin-dir <dir>` 指定其它位置；
extensions 默认是 skills 目录的同级 `extensions`。安装器先暂存三项并检查来源与摘要，再
一起提交或回滚；重复安装是幂等的。

安装后可运行：

```bash
workplane --help
```

在 Pi 中 `/reload` 或启动新会话来加载 `/skill:workplane`。

## 卸载

独立默认安装使用：

```bash
node scripts/install-skill.mjs --uninstall
```

若通过打包的 runtime restore 安装到托管目录，则必须传入同一目标（自定义过
`WORKPLANE_RESTORE_ROOT` 或 `WORKPLANE_BIN_DIR` 时相应替换）：

```bash
node ~/.local/share/workplane/source/scripts/install-skill.mjs --uninstall \
  --skills-dir ~/.local/share/workplane/installed-skills \
  --extensions-dir ~/.pi/agent/extensions \
  --bin-dir ~/.local/bin
```

只删除 Workplane 自己拥有、且自安装后未被修改过的 skill、launcher 和 Pi extension。
若任一目标来自其它来源、被符号链接替换、包含额外文件或自安装后被编辑，安装器会在移动
任何目标前拒绝覆盖或删除，不做部分修改。

## 与 Project Tracker 的关系

- Workplane 安装器不安装、不修改、不删除任何 Tracker 扩展或文件；
- 卸载 Workplane 不影响 Tracker；
- 卸载 Tracker 不会删除独立安装的 Workplane；
- Tracker 未安装 Workplane 时仍可完整工作。

## Pi 硬入口

Pi extension 在技能展开前拦截 `/skill:workplane`，运行只读 `workplane inspect`，然后
显示三个固定入口。预检不会创建、修复或渲染项目；数字选择绑定本次项目和会话。可用
`/workplane-cancel` 取消正在进行或排队的预检。安装、升级或卸载后需 `/reload` 或新会话。

扩展由 Workplane 自己安装和卸载；它不会安装、覆盖或删除 Project Tracker extension。

## 与 Tracker 的快照对接

单独使用时，先由 Tracker 导出一个快照文件，再执行：

```bash
workplane validate WORKPLANE.json --snapshot snapshot.json
workplane render WORKPLANE.json --snapshot snapshot.json --out out/
```

作为插件时，Tracker 用参数数组启动 `workplane plugin`，通过 stdin/stdout 传递单一
JSON 请求与响应；协议版本不匹配或结构非法时返回结构化错误，不会复用上一次结果。
