/**
 * Optional Workplane dashboard page.
 *
 * The plugin returns a standalone HTML document; Tracker renders it in a
 * script-only sandbox (no same-origin, no navigation or device permissions).
 * Every non-ready status is explained in stable Chinese copy; raw subprocess
 * output is never shown.
 */
import { useEffect, useState } from "react";
import { api, type WorkplaneApiResponse } from "../api";

type VisibleFailure = "incompatible" | "invalid" | "failed";

const STATUS_MESSAGE: Record<VisibleFailure, string> = {
  incompatible: "Workplane 版本不兼容",
  invalid: "工作视图定义未通过检查",
  failed: "本次工作视图生成失败",
};

const STATUS_HINT: Record<VisibleFailure, string> = {
  incompatible: "已安装的 Workplane 与本项目使用的协议版本不一致；升级或降级后重试，其它页面照常使用。",
  invalid: "定义里有阻塞性问题；请先修正 WORKPLANE.json 与 Design 影响关系，再重新生成。",
  failed: "本次调用失败，没有沿用上一次的结果；请检查 Workplane 是否可运行后重试。",
};

export function Workplane({ projectId }: { projectId: string }) {
  const [result, setResult] = useState<WorkplaneApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setResult(null);
    setError(null);
    api
      .getWorkplane(projectId)
      .then((value) => {
        if (active) setResult(value);
      })
      .catch(() => {
        if (active) setError("工作视图加载失败");
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  if (error) return <p role="alert">{error}</p>;
  if (!result) return <p>正在加载工作视图…</p>;

  if (result.status === "ready") {
    return (
      <div className="workplane-page">
        <iframe
          title="项目工作视图"
          sandbox="allow-scripts"
          srcDoc={result.html}
          className="workplane-frame"
        />
      </div>
    );
  }

  if (result.status === "not_configured" || result.status === "unavailable") return null;

  return (
    <section className="workplane-status">
      <h2>工作视图</h2>
      <p>{STATUS_MESSAGE[result.status]}</p>
      <p className="muted">{STATUS_HINT[result.status]}</p>
    </section>
  );
}
