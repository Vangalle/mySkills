import type { GoalOverview } from "../api";
type Node = GoalOverview["goals"][number]["designs"][number];
export const designAnchor = (goal: string, design: string) => `design-${encodeURIComponent(goal)}-${encodeURIComponent(design)}`;

/** Explicit edges only. The parent links in each card remain an accessible text view. */
export function DesignHistory({ goalId, designs }: { goalId: string; designs: Node[] }) {
  const points = new Map<string, { x: number; y: number }>();
  const remaining = new Map(designs.map(d => [d.id, d]));
  const lanes = new Map<number, number>();
  while (remaining.size) {
    let advanced = false;
    for (const [id, node] of remaining) {
      if ((node.parents ?? []).some(parent => !points.has(parent))) continue;
      const level = Math.max(-1, ...(node.parents ?? []).map(p => Math.round(points.get(p)!.x / 240))) + 1;
      const lane = lanes.get(level) ?? 0; lanes.set(level, lane + 1);
      points.set(id, { x: level * 240, y: lane * 95 }); remaining.delete(id); advanced = true;
    }
    if (!advanced) break; // malformed remote data must not hang the browser
  }
  if (!designs.length) return null;
  const width = Math.max(240, ...[...points.values()].map(p => p.x + 240));
  const height = Math.max(100, ...[...points.values()].map(p => p.y + 100));
  return <svg className="design-history-chart" role="img" aria-label="设计逻辑演进图" viewBox={`-10 -10 ${width + 20} ${height + 20}`}>
    {designs.flatMap(node => (node.parents ?? []).map(parent => {
      const a = points.get(parent), b = points.get(node.id); if (!a || !b) return null;
      return <path key={`${parent}-${node.id}`} data-parent={parent} data-child={node.id}
        d={`M${a.x + 205},${a.y + 30} C${a.x + 225},${a.y + 30} ${b.x - 20},${b.y + 30} ${b.x},${b.y + 30}`} />;
    }))}
    {designs.map(node => {
      const p = points.get(node.id); if (!p) return null;
      return <a key={node.id} href={`#${designAnchor(goalId, node.id)}`}>
        <title>{node.title}</title>
        <rect x={p.x} y={p.y} width="205" height="65" rx="8" />
        <text x={p.x + 10} y={p.y + 23}>{node.title.slice(0, 15)}</text>
        <text x={p.x + 10} y={p.y + 48} className="design-chart-id">{node.id}</text>
      </a>;
    })}
  </svg>;
}
export function DesignProgress({ design }: { design: Node }) {
  return <section aria-label={`${design.title}的开发进展`} className="design-progress">
    <h4>开发进展</h4>
    {!design.progress?.length && <p className="meta">尚未记录开发进展。</p>}
    <ol>{design.progress?.map(record => <li key={record.id}>
      <time dateTime={record.recordedAt}>{record.recordedAt}</time>
      <p className="progress-text">{record.text}</p>
      {!!record.gitRefs.length && <p className="meta">Git：{record.gitRefs.join(", ")}</p>}
      {!!record.evidenceIds.length && <details><summary>查看记录依据</summary><p className="meta">{record.evidenceIds.join(", ")}</p></details>}
      {record.verification?.map(v => <p className="meta" key={v.id}>
        {v.current ? "当前检查" : "历史检查（不代表现在通过）"}：{v.command} → {v.result} · {v.verifiedAt}
        {v.binding && <> · {v.binding.head.slice(0, 12)}</>}
      </p>)}
    </li>)}</ol>
  </section>;
}
