import { useEffect, useState } from "react";
import { api, type BoardConfig } from "../api";
import { normalizeKanbanUrl } from "../../../src/integrations/kanban";

export function Kanban({ projectId }: { projectId: string }) {
  const [board, setBoard] = useState<BoardConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setBoard(null);
    setError(null);
    api.getBoard(projectId).then((result) => {
      if (current) setBoard(result);
    }).catch((cause: Error) => {
      if (current) setError(cause.message);
    });
    return () => { current = false; };
  }, [projectId]);

  const url = board?.status === "configured" ? normalizeKanbanUrl(board.url) : null;
  return (
    <section className="kanban-page" aria-label="项目任务看板">
      <div className="page-heading">
        <div>
          <span className="section-kicker">Page 1 · 本地 Pi 任务看板</span>
          <h2>任务看板</h2>
        </div>
        {url && <a href={url} target="_blank" rel="noopener noreferrer">在新窗口打开看板</a>}
      </div>
      <p className="meta">接入支持真实 Pi 执行的本地看板后，可在看板中安排任务并启动 Pi。任务完成后，仍需按验收证据确认 Design Mark。</p>
      <p className="meta">本地地址指向浏览器所在的电脑；请在运行看板的同一台电脑打开。若嵌入页无法显示，可在新窗口打开看板并确认服务已启动。</p>
      {error ? <p role="alert" className="warn">看板配置加载失败：{error}</p> : !board ? (
        <p role="status">正在读取看板配置…</p>
      ) : url ? (
        <iframe className="kanban-frame" title="本地 Pi 任务看板" src={url} referrerPolicy="no-referrer" />
      ) : (
        <div className="empty-state">
          <h3>{board.status === "unconfigured" ? "当前项目尚未关联看板" : "看板地址配置无效"}</h3>
          <p>先启动支持真实 Pi 执行的本地开源看板，将对应项目的看板地址写入项目根目录 .project-tracker.json 的 <code>kanbanUrl</code>，然后重新进入此页。</p>
          <p>仅支持 http://127.0.0.1、http://localhost 或 http://[::1] 的本地地址。</p>
        </div>
      )}
    </section>
  );
}
