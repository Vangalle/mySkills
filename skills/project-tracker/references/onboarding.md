# 项目接入：旧 State 与默认检查

**已有文档不兼容、检查尚未配置，都不等于项目不适用。** 分别处理格式接入和命令授权；保存未验证的开发事实不以检查配置为前提。以下命令始终使用本次回执的目标根目录。

## 已有 State

`project-tracker state inspect [path]` 只读返回 missing / compatible / legacy / incompatible，以及当前 hash。`prepare --json --onboarding [path]` 可返回 `needs_state_setup`，仅授权进入接入对话，不是正常扫描就绪；不可读来源、读取权限或其他收集失败仍停止。处理完成后重新 prepare，再继续暂存的原要求。

1. compatible 继续使用；missing 根据真实来源建立提案。legacy / incompatible 读取原文，判断可否小范围调整或无损迁移。保持能保留的历史，不从旧里程碑编造 Project Goal；缺失来源/祖先保持未知。
2. 大量结构调整先用图说明，并询问：**是否把原文件归档到 `bak/PROJECT_STATE.md`？** 保留旧文件的选择与目标/设计变更的审图确认是不同事项；都明确后才写。
3. 有效 v1 可用 `state migrate [path]` 输出提案；不能解析的旧文件需要根据原文整理新提案，而不是反复调用无法成功的 migrate。提案仍需 schema/来源校验及内部 `state preview`。新文档只含当前状态，不复制旧结论或任何额外章节；被取代的内容由归档保留。工具更新不会修正已经生成的旧 preview，需重新生成后核对。
4. 保存内部 preview JSON 后，按用户选择执行其一：

   ```sh
   project-tracker state apply --preview "/target/.project-tracker/preview.json" --backup-original "/target"
   # 仅用户明确拒绝保留原文件时：
   project-tracker state apply --preview "/target/.project-tracker/preview.json" --discard-original "/target"
   ```

   自动记录不走此全量替换接口。归档按原字节写入 `bak/`，在原文件替换之前完成并同步；已有归档不覆盖。失败、hash 冲突或锁冲突时保持原文件，不删除备份重试、不绕过 writer。若备份已存在，告知冲突，让用户处理已有备份后再继续；不能擅自选择“不保留”。小范围修正仍须保留人类内容，定义变化仍审图。

## 检查配置引导

仅当用户要运行检查、而配置缺失/为空时执行本节。菜单 2 更新已有事实不必先调用 verify；应写明“未验证”，不要因缺配置而放弃保存。

1. `project-tracker checks propose [path]` 获取只读候选，并保存操作性 proposal JSON。当前检测已有 package.json 的 test / lint / typecheck / build scripts，使用 packageManager 或 npm 默认 runner，跳过占位测试。不会安装依赖、调用脚本或创建配置。
2. 展示 **proposal 中的确切 command、purpose 和 script**，包括可能的构建写入；询问“是否创建这些默认检查配置并运行？” 例如观察到 npm scripts 为 test=`vitest run`、build=`tsc` 时，展示 `npm run test` 与 `npm run build`，不是凭经验生成任意命令。
3. 用户同意后：

   ```sh
   project-tracker checks apply --proposal "/target/.project-tracker/checks-proposal.json" --confirm "/target"
   project-tracker verify --json "/target"
   ```

   apply 只保存配置，不运行命令；verify 才执行获准命令。已有其他配置字段保留，配置或脚本变化、提案被修改、目标不符时拒绝，并重新提议/确认。
4. 用户拒绝：不写配置、不执行、不反复追问；告诉用户在项目根目录 `.project-tracker.json`（已有备用 `project-tracker.json` 时使用该文件）填写 `verificationAllowlist` 字符串数组，示例命令仍按实际项目给出。等待用户自行配置后再检查，其他跟踪功能继续。
5. no_candidates：说明目前未识别到适用入口，询问项目实际测试方式或提供手动配置说明，不捏造默认命令。非法 JSON / 无效配置类型：说明需要修复该文件，不能当作“配置不存在”覆盖它。

检查执行、记录保存、验收通过彼此独立。空配置不是 PASS；一次通用检查也不能证明所有验收条件。
