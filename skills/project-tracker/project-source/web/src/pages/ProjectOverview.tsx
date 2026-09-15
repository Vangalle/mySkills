import { useEffect, useState } from "react";
import { api, type StateResponse } from "../api";
import { GoalOverview } from "../components/GoalOverview";
import { StatusMatrix } from "../components/StatusMatrix";
import { VerificationPanel } from "../components/VerificationPanel";
import { ConflictBanner } from "../components/ConflictBanner";
import { statusLabel } from "../zh-CN";

/** Current conclusions, milestone, risks and repo status for one project. */
export function ProjectOverview({ projectId }: { projectId: string }) {
  const [state, setState] = useState<StateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setError(null);
    setLoading(true);
    api
      .getState(projectId)
      .then((result) => {
        if (!cancelled) {
          setState(result);
          setLoading(false);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (loading) return <p>正在加载项目状态…</p>;
  if (error) return <p className="warn">项目状态加载失败：{error}</p>;
  if (!state) return null;

  return (
    <div className="overview">
      <header className="release-state">
        <h2>
          发布状态：{" "}
          <span
            data-testid="release-state"
            className={`badge ${state.releaseState?.toLowerCase() ?? "unknown"}`}
          >
            {statusLabel(state.releaseState)}
          </span>
          {state.freshness.stale && (
            <span data-testid="stale-state-badge" className="badge stale">
              已过期
            </span>
          )}
        </h2>
        <p className="meta">
          {state.project.name} — {state.project.root}
        </p>
      </header>

      {state.goalOverview && <GoalOverview overview={state.goalOverview} project={{ name: state.project.name }} />}

      {state.proposal?.currentMilestone ? (
        <section className="card narrative-summary">
          <div className="section-kicker">项目判断</div>
          <h2>现在怎样</h2>
          <p className="summary-lede">{state.proposal.executiveSummary}</p>
          <div className="milestone-grid">
            <div className="milestone-objective">
              <span className="plain-label">当前目标</span>
              <strong>{state.proposal.currentMilestone.objective}</strong>
            </div>
            <div>
              <span className="plain-label">完成标志</span>
              <ul className="completion-list">
                {state.proposal.currentMilestone.exitCriteria.map((criterion) => (
                  <li key={criterion}>{criterion}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : state.proposal ? null : (
        <section className="card warn">
          <h2>没有可解析的 PROJECT_STATE.md</h2>
          <p>请通过 CLI 或 Pi skill 扫描并刷新项目状态。</p>
        </section>
      )}

      <ConflictBanner state={state} />
      <StatusMatrix state={state} />
      <VerificationPanel state={state} />

      {(state.proposal?.risks ?? []).length > 0 && (
        <section className="card">
          <h2>风险</h2>
          <ul>
            {state.proposal!.risks!.map((risk) => (
              <li key={risk.problem} data-testid={`risk-${risk.severity}`}>
                <strong>[{risk.severity}] {risk.problem}</strong> — {risk.impact}。下一步：{risk.nextAction}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(state.proposal?.nextActions ?? []).length > 0 && (
        <section className="card">
          <h2>下一步行动</h2>
          <ul>
            {state.proposal!.nextActions!.map((action) => (
              <li key={action.action}>
                <strong>{action.priority}</strong> — {action.action}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}