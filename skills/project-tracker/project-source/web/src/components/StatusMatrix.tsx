import type { StateResponse } from "../api";
import { maturityLabel, statusLabel } from "../zh-CN";

/** A visual flow of stable work and the work currently moving forward. */
export function StatusMatrix({ state }: { state: StateResponse }) {
  const workstreams = state.proposal?.workstreams ?? [];
  const activeWork = state.proposal?.activeWork ?? [];
  const nodes = [
    ...workstreams.map((item) => ({
      name: item.name,
      status: item.status,
      maturity: item.claimMaturity,
      achieved: item.stableBaseline,
      next: item.currentGap,
    })),
    ...activeWork.map((item) => ({
      name: item.name,
      status: item.status,
      maturity: undefined,
      achieved: item.completed.at(-1) ?? "尚无已完成记录。",
      next: item.remaining.at(0) ?? "暂无下一项。",
    })),
  ];

  return (
    <section aria-label="项目进展图" className="card workstream-flow">
      <div className="section-kicker">从稳定成果到当前工作</div>
      <h2>项目进展</h2>
      {nodes.length === 0 ? (
        <p className="meta">尚未记录项目进展。</p>
      ) : (
        <div className="workstream-track">
          <span className="workstream-signal" aria-hidden="true" />
          {nodes.map((node, index) => (
            <article
              className={`workstream-node ${node.status.toLowerCase()}`}
              key={`${node.name}-${index}`}
              style={{ animationDelay: `${index * 90}ms` }}
            >
              <div className="node-heading">
                <span className="node-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="badge" data-testid={`status-${node.name}`}>
                  {statusLabel(node.status)}
                </span>
              </div>
              <h3>{node.name}</h3>
              {node.maturity ? <p className="maturity-label">{maturityLabel(node.maturity)}</p> : null}
              <div className="node-copy">
                <span>已经做到</span>
                <p>{node.achieved}</p>
              </div>
              <div className="node-copy next">
                <span>还差什么</span>
                <p>{node.next}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
