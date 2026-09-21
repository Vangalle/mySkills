import { useEffect, useState } from "react";
import { api, type ProjectSummary } from "./api";
import { ProjectOverview } from "./pages/ProjectOverview";
import { EvidenceTimeline } from "./pages/EvidenceTimeline";
import { SessionIndex } from "./pages/SessionIndex";
import { Workplane } from "./pages/Workplane";

type Page = "overview" | "timeline" | "sessions" | "workplane";

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState<Page>("overview");
  const [refreshKey, setRefreshKey] = useState(0);
  const [workplaneAvailable, setWorkplaneAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listProjects()
      .then((result) => {
        setProjects(result.projects);
        setSelected((current) => current ?? result.projects[0]?.id ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    let active = true;
    setWorkplaneAvailable(false);
    if (!selected) return () => { active = false; };

    api.getWorkplane(selected)
      .then((result) => {
        if (!active) return;
        const available = result.status !== "not_configured" && result.status !== "unavailable";
        setWorkplaneAvailable(available);
        if (!available) setPage((current) => current === "workplane" ? "overview" : current);
      })
      .catch(() => {
        if (active) setWorkplaneAvailable(false);
      });

    return () => { active = false; };
  }, [selected, refreshKey]);

  async function rescan() {
    if (!selected) return;
    await api.rescan(selected);
    setRefreshKey((key) => key + 1);
  }

  if (error) return <p className="warn">控制台加载失败：{error}</p>;

  return (
    <div className="app">
      <header className="topbar">
        <h1>项目进度追踪</h1>
        {projects.length > 0 && (
          <select
            aria-label="项目选择"
            value={selected ?? ""}
            onChange={(e) => {
              setSelected(e.target.value);
              setPage("overview");
            }}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        )}
        <nav>
          <button onClick={() => setPage("overview")} disabled={page === "overview"}>
            概览
          </button>
          <button onClick={() => setPage("timeline")} disabled={page === "timeline"}>
            时间线
          </button>
          <button onClick={() => setPage("sessions")} disabled={page === "sessions"}>
            会话
          </button>
          {workplaneAvailable && (
            <button onClick={() => setPage("workplane")} disabled={page === "workplane"}>
              工作视图
            </button>
          )}
          <button onClick={rescan} title="重新扫描项目证据">
            重新扫描
          </button>
        </nav>
      </header>
      <main>
        {selected === null && projects.length === 0 && (
          <p>尚未注册项目。请在启动控制台时指定一个 Git 项目。</p>
        )}
        {selected !== null && page === "overview" && (
          <ProjectOverview projectId={selected} key={`${selected}-${refreshKey}`} />
        )}
        {selected !== null && page === "timeline" && <EvidenceTimeline projectId={selected} />}
        {selected !== null && page === "sessions" && <SessionIndex projectId={selected} />}
        {selected !== null && page === "workplane" && (
          <Workplane projectId={selected} key={`${selected}-${refreshKey}`} />
        )}
      </main>
    </div>
  );
}
