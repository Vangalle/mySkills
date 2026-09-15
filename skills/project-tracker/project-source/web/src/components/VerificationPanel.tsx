import type { StateResponse } from "../api";
import { formatDateTime, freshnessReasonLabel, verificationLabel } from "../zh-CN";

/** Project snapshot freshness and verification content bindings are independent. */
export function VerificationPanel({ state }: { state: StateResponse }) {
  const records = state.verification;
  const latest = records[0];
  const stale = state.freshness.stale;
  return (
    <section aria-label="验证" className="card">
      <h2>验证</h2>
      <p className="meta">
        项目快照：{" "}
        {stale ? <span data-testid="stale-badge" className="badge stale">已过期</span> : "当前"}
      </p>
      <p className="meta">
        分支：<code>{state.git.branch ?? "游离状态"}</code> · HEAD：{" "}
        <code>{state.git.head.slice(0, 10)}</code> · 领先 {state.git.ahead} / 落后{" "}
        {state.git.behind} ·{" "}
        <span data-testid="dirty-count">{state.git.dirtyCount} 个未提交路径</span>
      </p>
      {stale && (
        <ul className="reasons" data-testid="stale-reasons">
          {state.freshness.reasons.map((reason) => (
            <li key={reason}>{freshnessReasonLabel(reason)}</li>
          ))}
        </ul>
      )}
      {records.length === 0 ? (
        <p className="meta">尚无验证记录。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>命令</th>
              <th>结果</th>
              <th>内容状态</th>
              <th>验证时间</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={`${record.command}-${record.verifiedAt}`}>
                <td>
                  <code>{record.command}</code>
                </td>
                <td data-testid={`verify-${record.result}`}>{verificationLabel(record.result)}</td>
                <td>
                  {record.freshness === "current" ? "对应当前内容" : record.freshness === "stale"
                    ? <span className="badge stale">已过期</span> : "未绑定项目内容"}
                </td>
                <td>{formatDateTime(record.verifiedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {latest && latest.result !== "PASS" && (
        <p className="warn">最近一次验证未通过。</p>
      )}
    </section>
  );
}
