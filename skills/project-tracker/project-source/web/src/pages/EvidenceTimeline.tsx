import { useEffect, useState } from "react";
import { api, type TimelineEntry } from "../api";
import { confidenceLabel, formatDateTime, sourceLabel } from "../zh-CN";

/** Merged evidence timeline with provenance filtering. */
export function EvidenceTimeline({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [filter, setFilter] = useState<"all" | "observed" | "reported" | "inferred">("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getTimeline(projectId)
      .then((result) => {
        if (!cancelled) setEntries(result.timeline);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (error) return <p className="warn">证据时间线加载失败：{error}</p>;

  const visible = entries.filter((entry) => filter === "all" || entry.confidence === filter);

  return (
    <div>
      <header className="page-heading">
        <div>
          <div className="section-kicker">项目发生过什么</div>
          <h2>证据时间线</h2>
        </div>
        <label>
          证据来源：{" "}
          <select
            aria-label="证据来源筛选"
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
          >
            <option value="all">全部</option>
            <option value="observed">已观察</option>
            <option value="reported">已报告</option>
            <option value="inferred">推断</option>
          </select>
        </label>
      </header>
      <div aria-label="动态证据时间线" className="animated-timeline">
        <span className="timeline-signal" aria-hidden="true" />
        <ol className="timeline">
          {visible.map((entry, index) => (
            <li
              key={`${entry.evidenceId}-${index}`}
              data-kind={entry.kind}
              data-testid="timeline-entry"
              aria-current={index === 0 ? "true" : undefined}
              style={{ animationDelay: `${index * 90}ms` }}
            >
              <span className="timeline-node" aria-hidden="true" />
              <div className="timeline-entry-head">
                <span className="badge">{sourceLabel(entry.source)}</span>
                <span className="confidence" data-testid={`confidence-${entry.confidence}`}>
                  {confidenceLabel(entry.confidence)}
                </span>
                <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
              </div>
              <strong className="timeline-title">{entry.title}</strong>
              <div className="meta">
                证据 ID <code>{entry.evidenceId}</code> · 定位 <code>{entry.locator}</code>
              </div>
            </li>
          ))}
          {visible.length === 0 && <li className="timeline-empty">没有符合当前筛选条件的时间线记录。</li>}
        </ol>
      </div>
    </div>
  );
}