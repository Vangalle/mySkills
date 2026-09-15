import type { GoalOverview as GoalOverviewData, GoalSource } from "../api";
import { DesignHistory, DesignProgress, designAnchor } from "./DesignHistory";

function SourcePreview({ source }: { source: GoalSource }) {
  const kind = source.kind === "openspec" ? "OpenSpec" : source.kind === "spec-kit" ? "Spec Kit" : "项目文件";
  return (
    <details className="goal-source">
      <summary><code>{source.path}</code> <span className="meta">{kind} · {source.status === "available" ? "查看原文" : source.status === "missing" ? "文件不存在" : "无法安全读取"}</span></summary>
      {source.status === "available" && <pre>{source.preview}</pre>}
      {source.truncated && <p className="warn">原文预览已截断；任务统计仅覆盖已读取部分。</p>}
    </details>
  );
}

/** Evidence-flow layout reused from Cheap-Relay/docs/design-demo.html, Page 0.
 * All counts remain server-projected evidence; disclosures never mutate sources. */
export function GoalOverview({ overview, project }: { overview: GoalOverviewData; project?: { name: string; objective?: string } }) {
  return (
    <section className="goal-overview" aria-label="项目目标与设计">
      <div className="section-kicker">EVIDENCE FLOW</div>
      <h2>项目目标与设计</h2>
      <p className="meta">项目目标 → 功能目标 → 设计演进与开发进展。逻辑祖先独立于 Git 历史。</p>
      <div className="flow-legend" aria-label="进度口径">
        <span className="evidence-chip design-chip">设计原文</span>
        <span className="evidence-chip verification-chip">Mark · 当前通过证据</span>
        <span className="evidence-chip task-chip">任务勾选 · 原文记录</span>
      </div>
      <div className="flow-root">
        <div className="flow-root-tag">Project Goal</div>
        {overview.projectGoal ? <>
          <h3>{overview.projectGoal.statement}</h3>
          <details><summary>目标如何得出</summary>
            <p>{overview.projectGoal.reasoning}</p>
            <p>Philosophy / Insight：<code>{overview.projectGoal.philosophy.path}</code></p>
            <p>PMF / Market：<code>{overview.projectGoal.market.path}</code></p>
          </details>
          {overview.goalOriginCurrent === false && <p className="warn">目标来源已变化或无法读取；当前推导需要复核。</p>}
        </> : <p>尚未建立可追溯的项目目标；需要 Philosophy / Insight 与 PMF / Market 来源。</p>}
      </div>
      {project && overview.goals.length > 0 && <div className="flow-connector" aria-hidden="true" />}
      <p className="goal-progress-note meta">设计完成程度按有当前通过证据的验收项计算。原始任务勾选单独展示。</p>
      {overview.goals.length === 0 && <p>尚未建立目标与设计关联。可在 PROJECT_STATE.md 的 goals 中引用原始设计与任务文件；现有项目概览继续保留。</p>}
      <div className="goal-area-grid">
      {overview.goals.map((goal, index) => (
        <article key={goal.id} className="project-goal">
          <header className="goal-area-heading"><span className="goal-area-number">{String(index + 1).padStart(2, "0")}</span><h3>{goal.title}</h3></header>
          <div className="goal-area-body">
          <DesignHistory goalId={goal.id} designs={goal.designs} />
          {goal.designs.length === 0 && <p className="meta">尚未关联设计。</p>}
          {goal.designs.map((design) => (
            <details key={design.id} id={designAnchor(goal.id, design.id)} className="goal-design" open>
              <summary>
                <strong className="goal-design-title">{design.title}<span className="goal-design-caret" aria-hidden="true">▸</span></strong>
                <code className="goal-design-id">{design.id}</code>
                <span className="goal-mark">设计验收：{design.mark.completed} / {design.mark.total}</span>
                <span className="goal-task-count">任务勾选：{design.taskProgress.completed} / {design.taskProgress.total}</span>
              </summary>
              <div className="goal-design-evidence">
              <p className="meta">{design.parents == null ? "祖先未记录" : !design.parents.length ? "逻辑起点" : <>源自：{design.parents.map(parent => <a key={parent} href={`#${designAnchor(goal.id, parent)}`}>{parent} </a>)}</>}</p>
              <DesignProgress design={design} />
              <SourcePreview source={design.source} />
              {design.mark.total === 0 && <p className="meta">尚未定义验收项，设计完成程度未验证。</p>}
              {design.acceptance.length > 0 && <ol className="goal-acceptance">
                {design.acceptance.map((item) => <li key={item.id}>
                  <span className={`badge ${item.supported ? "stable" : "unknown"}`}>{item.supported ? "有证据通过" : item.complete ? "完成声明待验证" : "未验证"}</span>{" "}
                  <span>{item.criterion}</span>
                  {item.evidence.map((ref) => <p className="meta" key={ref.id}><code>{ref.id}</code> · {ref.locator || "来源未找到"} · {ref.summary}{ref.observedAt ? ` · ${ref.observedAt}` : ""}</p>)}
                </li>)}
              </ol>}
              {design.taskSources.map((source) => <div className="goal-tasks" key={source.path}>
                <SourcePreview source={source} />
                {source.tasks.length > 0 && <ul>{source.tasks.map((task, index) => <li key={index}><label><input type="checkbox" checked={task.checked} disabled /> {task.text}</label></li>)}</ul>}
                {source.status === "available" && source.tasks.length === 0 && <p className="meta">未找到 Markdown 任务复选框。</p>}
              </div>)}
              {design.taskSources.length === 0 && <p className="meta">尚未关联任务文件。</p>}
              </div>
            </details>
          ))}
          </div>
        </article>
      ))}
      </div>
      {overview.principles.length > 0 && <details className="goal-principles"><summary>项目原则与来源 · {overview.principles.length}</summary>{overview.principles.map((source) => <SourcePreview key={source.path} source={source} />)}</details>}
      {overview.unassociated.length > 0 && <details className="goal-unassociated"><summary><strong>未关联产物</strong> · {overview.unassociated.length}</summary><p className="meta">已发现原始规格、设计或任务文件；未推测其业务目标归属。</p>{overview.unassociated.map((source) => <SourcePreview key={source.path} source={source} />)}</details>}
      {overview.warnings.map((warning) => <p className="warn" key={warning}>{warning}</p>)}
    </section>
  );
}
