import { useEffect, useState } from "react";
import { api, type SessionsResponse } from "../api";
import { formatDateTime } from "../zh-CN";

/** Session summaries arranged as a readable, chronological activity trail. */
export function SessionIndex({ projectId }: { projectId: string }) {
  const [data, setData] = useState<SessionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getSessions(projectId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (error) return <p className="warn">会话加载失败：{error}</p>;
  if (!data) return <p>正在加载会话…</p>;

  const deepLinkBySession = new Map(data.agentsview.deepLinks.map((item) => [item.sessionId, item.url]));

  return (
    <div className="session-page">
      <header className="page-heading">
        <div>
          <div className="section-kicker">Pi 工作记录</div>
          <h2>会话</h2>
        </div>
        <p className="meta">
          {data.agentsview.available
            ? "已检测到 AgentsView，可打开完整记录。"
            : "未检测到 AgentsView，这里显示每次工作的目标与结论。"}
        </p>
      </header>

      <div aria-label="会话时间线" className="session-timeline">
        <span className="session-signal" aria-hidden="true" />
        {data.sessions.map((session, index) => {
          const title = session.name ?? `会话 ${session.sessionId.slice(0, 8)}`;
          const deepLink = deepLinkBySession.get(session.sessionId);
          return (
            <article
              key={session.sessionId}
              data-testid={`session-card-${session.sessionId}`}
              className="session-card"
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <span className="session-node" aria-hidden="true" />
              <div className="session-card-head">
                <div>
                  <time dateTime={session.updatedAt}>{formatDateTime(session.updatedAt)}</time>
                  <h3>
                    {deepLink ? (
                      <a href={deepLink} target="_blank" rel="noreferrer" title="在 AgentsView 中打开">
                        {title}
                      </a>
                    ) : (
                      title
                    )}
                  </h3>
                </div>
                {session.abnormalTermination ? (
                  <span data-testid="error-badge" className="badge error">异常</span>
                ) : (
                  <span className="badge stable">正常结束</span>
                )}
              </div>
              <div className="session-stats">
                <span>{session.messageCount} 条消息</span>
                <span>{session.branchCount} 个分支</span>
                {session.parentSession && <span>派生自 {session.parentSession.slice(0, 8)}</span>}
              </div>
              <div className="session-story">
                <div>
                  <span className="plain-label">这次要做什么</span>
                  <p>{session.firstUserGoal ?? "没有提取到明确目标。"}</p>
                </div>
                <div>
                  <span className="plain-label">最后做到哪里</span>
                  <p>{session.lastConclusion ?? "没有提取到明确结论。"}</p>
                </div>
              </div>
            </article>
          );
        })}
        {data.sessions.length === 0 && (
          <div className="empty-state">
            <strong>还没有找到 Pi 会话</strong>
            <p>重新扫描后，这里会按时间显示与当前项目相关的工作记录。</p>
          </div>
        )}
      </div>
    </div>
  );
}
