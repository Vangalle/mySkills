import type { StateResponse } from "../api";
import { conflictKindLabel } from "../zh-CN";

/** P0/P1/P2 conflict banner: current evidence vs recorded claims. */
export function ConflictBanner({ state }: { state: StateResponse }) {
  const conflicts = state.conflicts ?? [];
  if (conflicts.length === 0) {
    return (
      <section aria-label="证据冲突" className="card ok">
        <h2>证据冲突</h2>
        <p>当前证据与已记录历史之间没有冲突。</p>
      </section>
    );
  }
  return (
    <section aria-label="证据冲突" className="card conflict">
      <h2>
        证据冲突{" "}
        {conflicts.some((c) => c.severity === "P0") && (
          <span data-testid="p0-badge" className="badge p0">P0</span>
        )}
      </h2>
      <ul>
        {conflicts.map((conflict) => (
          <li key={conflict.id} data-testid={`conflict-${conflict.severity}`}>
            <strong>[{conflict.severity}] {conflictKindLabel(conflict.kind)}</strong>：{conflict.description}
          </li>
        ))}
      </ul>
    </section>
  );
}