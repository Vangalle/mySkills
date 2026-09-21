/**
 * Workplane renderer — one validated Plane Document → standalone HTML + Mermaid.
 *
 * The HTML embeds the whole document as JSON and inlines the viewer; it makes
 * no external script or stylesheet request and can be opened from disk. Visual
 * language is ported from Archify (MIT) classic preset: the same theme tokens,
 * semantic SVG classes, 40px grid, lane regions and component nodes.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const viewerJs = readFileSync(join(here, "viewer.js"), "utf8");

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

const STYLES = `
  :root, [data-theme="dark"] {
    --bg:#020617; --grid:#1e293b; --text:#ffffff; --text-muted:#94a3b8; --text-dim:#475569; --text-faint:#7d8da1;
    --panel:rgba(15,23,42,0.5); --panel-border:#1e293b; --lane-fill:rgba(15,23,42,0.22); --lane-stroke:#334155;
    --arrow:#64748b; --arrow-emphasis:#34d399; --mask:#0f172a;
    --frontend-fill:rgba(8,51,68,0.4);   --frontend-stroke:#22d3ee;
    --backend-fill:rgba(6,78,59,0.4);    --backend-stroke:#34d399;
    --database-fill:rgba(76,29,149,0.4); --database-stroke:#a78bfa;
    --cloud-fill:rgba(120,53,15,0.3);    --cloud-stroke:#fbbf24;
    --security-fill:rgba(136,19,55,0.4); --security-stroke:#fb7185;
    --messagebus-fill:rgba(251,146,60,0.3); --messagebus-stroke:#fb923c;
    --external-fill:rgba(30,41,59,0.5);  --external-stroke:#94a3b8;
    --toolbar-bg:rgba(15,23,42,0.8); --toolbar-border:#334155; --toolbar-text:#e2e8f0; --toolbar-hover:rgba(15,23,42,0.95);
  }
  [data-theme="light"] {
    --bg:#f8fafc; --grid:#e2e8f0; --text:#0f172a; --text-muted:#64748b; --text-dim:#94a3b8; --text-faint:#64748b;
    --panel:#ffffff; --panel-border:#e2e8f0; --lane-fill:rgba(248,250,252,0.65); --lane-stroke:#cbd5e1;
    --arrow:#94a3b8; --arrow-emphasis:#059669; --mask:#ffffff;
    --frontend-fill:rgba(34,211,238,0.15);  --frontend-stroke:#0891b2;
    --backend-fill:rgba(52,211,153,0.18);   --backend-stroke:#059669;
    --database-fill:rgba(167,139,250,0.2);  --database-stroke:#7c3aed;
    --cloud-fill:rgba(251,191,36,0.18);     --cloud-stroke:#d97706;
    --security-fill:rgba(251,113,133,0.15); --security-stroke:#e11d48;
    --messagebus-fill:rgba(251,146,60,0.15);--messagebus-stroke:#ea580c;
    --external-fill:rgba(148,163,184,0.18); --external-stroke:#64748b;
    --toolbar-bg:rgba(255,255,255,0.92); --toolbar-border:#cbd5e1; --toolbar-text:#334155; --toolbar-hover:#ffffff;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
    font-family:"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", "Microsoft YaHei", monospace;
    font-size:14px; line-height:1.55; }
  .container { max-width:1180px; margin:0 auto; padding:64px 20px 72px; }
  .toolbar { position:fixed; top:16px; right:18px; z-index:30; display:flex; gap:8px; align-items:center;
    background:var(--toolbar-bg); border:1px solid var(--toolbar-border); border-radius:0.7rem; padding:6px; backdrop-filter:blur(10px); }
  .toolbar button { display:inline-flex; align-items:center; gap:6px; background:transparent; color:var(--toolbar-text);
    border:1px solid transparent; border-radius:0.5rem; padding:0.4rem 0.7rem; cursor:pointer; font:inherit; font-size:12px; }
  .toolbar button:hover { background:var(--toolbar-hover); border-color:var(--toolbar-border); }
  .header { margin-bottom:1.5rem; }
  .header-row { display:flex; align-items:center; gap:0.75rem; }
  .pulse-dot { width:10px; height:10px; border-radius:50%; background:var(--arrow-emphasis); box-shadow:0 0 12px color-mix(in srgb, var(--arrow-emphasis) 60%, transparent); flex:none; }
  h1 { font-size:1.5rem; font-weight:700; letter-spacing:-0.025em; margin:0; }
  .subtitle { color:var(--text-muted); font-size:0.875rem; margin:0.5rem 0 0 1.75rem; max-width:70ch; }
  .boundaries { margin:0.6rem 0 0 1.75rem; padding:0; list-style:none; color:var(--text-dim); font-size:0.75rem; display:grid; gap:0.25rem; }
  .boundaries code { color:var(--text-faint); }
  .diagram-container { background:var(--panel); border:1px solid var(--panel-border); border-radius:1rem; padding:0.9rem; overflow:hidden; position:relative; }
  .diagram-toolbar { display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; padding:0.35rem 0.4rem 0.85rem; }
  .diagram-toolbar input { background:var(--panel); color:var(--text); border:1px solid var(--panel-border); border-radius:0.5rem; padding:0.4rem 0.6rem; font:inherit; font-size:12px; min-width:190px; }
  .diagram-toolbar input::placeholder { color:var(--text-dim); }
  .nav-btn { display:inline-flex; align-items:center; justify-content:center; min-width:2rem; height:2rem; background:var(--panel);
    color:var(--text-muted); border:1px solid var(--panel-border); border-radius:0.5rem; cursor:pointer; font:inherit; font-size:13px; padding:0 0.55rem; }
  .nav-btn:hover { color:var(--text); border-color:var(--arrow); }
  .spacer { flex:1; }
  .hint { color:var(--text-dim); font-size:11px; }
  .map-wrap { position:relative; height:min(70vh, 680px); min-height:460px; overflow:hidden; cursor:grab; transition:height 0.22s ease; }
  .map-wrap.panning { cursor:grabbing; }
  svg#map { width:100%; height:100%; display:block; }

  .c-grid { stroke:var(--grid); fill:none; }
  .c-mask { fill:var(--mask); stroke:none; }
  .c-frontend { fill:var(--frontend-fill); stroke:var(--frontend-stroke); }
  .c-backend { fill:var(--backend-fill); stroke:var(--backend-stroke); }
  .c-database { fill:var(--database-fill); stroke:var(--database-stroke); }
  .c-cloud { fill:var(--cloud-fill); stroke:var(--cloud-stroke); }
  .c-security { fill:var(--security-fill); stroke:var(--security-stroke); }
  .c-messagebus { fill:var(--messagebus-fill); stroke:var(--messagebus-stroke); }
  .c-external { fill:var(--external-fill); stroke:var(--external-stroke); }
  .c-lane { fill:var(--lane-fill); stroke:var(--lane-stroke); }
  .t-primary { fill:var(--text); } .t-muted { fill:var(--text-muted); } .t-dim { fill:var(--text-dim); }
  .t-frontend { fill:var(--frontend-stroke); } .t-backend { fill:var(--backend-stroke); } .t-database { fill:var(--database-stroke); }
  .t-cloud { fill:var(--cloud-stroke); } .t-security { fill:var(--security-stroke); } .t-messagebus { fill:var(--messagebus-stroke); }
  .t-external { fill:var(--external-stroke); }
  .semantic-sigil { fill:none; stroke:var(--text-muted); stroke-width:1.35; stroke-linecap:round; stroke-linejoin:round; opacity:0.8; pointer-events:none; }
  .semantic-sigil .sigil-fill { fill:var(--text-muted); stroke:none; }
  .a-default { stroke:var(--arrow); fill:none; }
  .a-derives { stroke:var(--database-stroke); fill:none; stroke-dasharray:4,4; }
  .a-hier { stroke:var(--lane-stroke); fill:none; stroke-dasharray:2,4; }
  .m-default { fill:var(--arrow); } .m-derives { fill:var(--database-stroke); } .m-hot { fill:var(--arrow-emphasis); }
  .node { cursor:pointer; transition:opacity 0.18s ease; }
  .node:focus-visible .c-mask { stroke:var(--arrow-emphasis); stroke-width:2; }
  .node.sel .c-mask { stroke:var(--arrow-emphasis); stroke-width:2; }
  .node.dim { opacity:0.14; }
  .layer-dep path, .layer-hier path { transition:opacity 0.18s ease, filter 0.18s ease; }
  .layer-dep path.hl { filter:drop-shadow(0 0 3px color-mix(in srgb, var(--arrow-emphasis) 55%, transparent)); }
  .layer-dep path.dim, .layer-hier path.dim { opacity:0.05; }
  .region { transition:opacity 0.18s ease; }
  .region.dim { opacity:0.2; }
  .region.hl .c-lane { stroke:var(--arrow-emphasis); stroke-dasharray:6,4; }
  .lane-label { font-weight:700; letter-spacing:0.02em; }

  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:1rem; margin-top:1.25rem; }
  .card { background:var(--panel); border:1px solid var(--panel-border); border-radius:0.75rem; padding:1rem 1.1rem; }
  .card-header { display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem; }
  .card-dot { width:8px; height:8px; border-radius:50%; flex:none; }
  .card-dot.emerald { background:var(--backend-stroke); } .card-dot.amber { background:var(--cloud-stroke); }
  .card-dot.orange { background:var(--messagebus-stroke); } .card-dot.slate { background:var(--external-stroke); }
  .card-dot.violet { background:var(--database-stroke); } .card-dot.rose { background:var(--security-stroke); }
  .card h3 { margin:0; font-size:0.72rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; }
  .card .value { font-size:1.6rem; font-weight:700; letter-spacing:-0.02em; }
  .card .note { color:var(--text-dim); font-size:0.7rem; }
  .receipt-card { margin-top:1rem; }
  .glossary { margin-top:1rem; }
  .glossary summary { cursor:pointer; color:var(--text-muted); font-size:0.78rem; }
  .glossary dl { margin:0.9rem 0 0; display:grid; grid-template-columns:max-content 1fr; gap:0.4rem 1.2rem; }
  .glossary dt { color:var(--text); font-size:0.78rem; white-space:nowrap; }
  .glossary dd { margin:0; color:var(--text-muted); font-size:0.78rem; }
  @media (max-width:720px) { .glossary dl { grid-template-columns:1fr; gap:0.15rem; } .glossary dd { margin-bottom:0.5rem; } }

  .ask-panel { position:fixed; right:1rem; bottom:1rem; z-index:60; width:min(460px,92vw); display:none;
    background:var(--bg); border:1px solid var(--panel-border); border-radius:0.8rem; box-shadow:0 18px 44px rgba(0,0,0,0.34); padding:0.9rem 1rem; }
  .ask-panel.open { display:block; }
  .ask-panel .where { color:var(--text-muted); font-size:0.72rem; margin-bottom:0.45rem; }
  .ask-panel textarea { width:100%; min-height:62px; resize:vertical; background:var(--panel); color:var(--text);
    border:1px solid var(--panel-border); border-radius:0.5rem; padding:0.5rem; font:inherit; font-size:0.8rem; }
  .ask-panel textarea[readonly] { color:var(--text-muted); }
  .field-label { display:block; color:var(--text-muted); font-size:0.7rem; margin:0.5rem 0 0.25rem; }
  .ask-actions { display:flex; gap:0.5rem; align-items:center; margin-top:0.5rem; flex-wrap:wrap; }
  #ask-preview { min-height:110px; margin-top:0.55rem; color:var(--text-muted); border-style:dashed; font-size:0.72rem; }
  .fb { position:fixed; left:1rem; bottom:1rem; z-index:60; }
  .fb-panel { position:fixed; left:1rem; bottom:3.5rem; z-index:60; width:min(520px,92vw); max-height:62vh; overflow-y:auto; display:none;
    background:var(--bg); border:1px solid var(--panel-border); border-radius:0.8rem; box-shadow:0 18px 44px rgba(0,0,0,0.34); padding:0.9rem 1rem; }
  .fb-panel.open { display:block; }
  .fb-panel ul { list-style:none; margin:0; padding:0; }
  .fb-item { display:flex; gap:0.6rem; align-items:flex-start; padding:0.6rem 0; border-bottom:1px dashed var(--panel-border); }
  .fb-item:last-child { border-bottom:none; }
  .fb-index { flex:none; width:1.45rem; height:1.45rem; border-radius:50%; border:1px solid var(--panel-border); color:var(--text-muted);
    font-size:0.7rem; display:flex; align-items:center; justify-content:center; }
  .fb-body { display:flex; flex-direction:column; flex:1; min-width:0; }
  .fb-where { color:var(--text); font-size:0.75rem; }
  .fb-q { color:var(--text-muted); font-size:0.75rem; }
  .fb-kind { display:inline-block; font-size:0.62rem; line-height:1.4; border:1px solid var(--panel-border); border-radius:0.3rem; padding:0 0.3rem; margin-right:0.4rem; color:var(--text-muted); }
  .fb-kind.kind-change { color:var(--cloud-stroke); border-color:var(--cloud-stroke); }
  .scope-list { list-style:none; margin:0.25rem 0 0.6rem; padding:0; display:grid; gap:0.25rem; }
  .scope-list li { display:flex; gap:0.4rem; align-items:flex-start; }
  .scope-list li > span { flex:1; min-width:0; }
  .does-row { display:flex; gap:0.5rem; align-items:flex-start; }
  .does-row > p { flex:1; margin:0; }
  .fb-item-actions { display:flex; gap:0.3rem; flex:none; }
  #toast { position:fixed; left:50%; bottom:5.6rem; z-index:70; transform:translateX(-50%) translateY(0.5rem); opacity:0; pointer-events:none;
    background:var(--toolbar-bg); color:var(--toolbar-text); border:1px solid var(--toolbar-border); border-radius:0.6rem; padding:0.5rem 0.85rem; font-size:0.78rem; transition:opacity .18s, transform .18s; }
  #toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
  .receipt-grid { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
  @media (max-width:720px) { .receipt-grid { grid-template-columns:1fr; } }
  .issues { margin:0.35rem 0 0; padding-left:1.1rem; color:var(--text-muted); font-size:0.78rem; }
  .issues.errors li { color:var(--security-stroke); }
  .ok { color:var(--backend-stroke); font-size:0.78rem; }
  .ctx { color:var(--text-dim); font-size:0.72rem; margin:0.9rem 0 0; }
  .legend { display:flex; gap:1rem; flex-wrap:wrap; align-items:center; padding:0.7rem 0.4rem 0.2rem; color:var(--text-muted); font-size:11px; }
  .legend span { display:inline-flex; align-items:center; gap:0.4rem; }
  .swatch { width:9px; height:9px; border-radius:2px; display:inline-block; }
  .line-swatch { width:16px; height:0; border-top:2px solid var(--arrow); display:inline-block; }
  .line-swatch.dashed { border-top-style:dashed; }

  .detail { position:fixed; top:0; right:0; z-index:40; width:432px; max-width:94vw; height:100vh; overflow-y:auto;
    background:var(--bg); border-left:1px solid var(--panel-border); box-shadow:-18px 0 40px rgba(0,0,0,0.28);
    transform:translateX(103%); transition:transform 0.22s ease; padding:1.1rem 1.4rem 3rem; }
  .detail.open { transform:translateX(0); }
  body[data-detail="bottom"] .detail { position:static; width:auto; max-width:none; height:auto; overflow:visible;
    transform:none; box-shadow:none; border-left:none; border-top:1px solid var(--panel-border);
    margin:0.7rem 0 0; padding:1rem 0.5rem 0.3rem; }
  body[data-detail="bottom"] .detail:not(.open) { display:none; }
  body[data-detail="bottom"] .diagram-container.has-detail .map-wrap { height:min(44vh, 420px); min-height:340px; }
  .detail-bar { display:flex; align-items:center; gap:0.5rem; margin-bottom:0.6rem; }
  .detail-bar .spacer { flex:1; }
  .detail-bar .detail-kind { color:var(--text-muted); font-size:0.72rem; text-transform:uppercase; letter-spacing:0.1em; }
  .d-head { display:flex; justify-content:space-between; gap:1rem; align-items:flex-start; margin-bottom:0.5rem; }
  .d-head h3 { margin:0; font-size:1rem; }
  .d-head p { margin:0.15rem 0 0; }
  .d-head-right { display:flex; align-items:center; gap:0.5rem; flex:none; }
  .d-grid { display:grid; grid-template-columns:1.7fr 1fr 1fr; gap:1.6rem; margin-top:0.6rem; align-items:start; }
  body[data-detail="right"] .d-grid { grid-template-columns:1fr; gap:0.1rem; }
  @media (max-width:820px) { .d-grid { grid-template-columns:1fr; gap:0.6rem; } }
  .does { font-size:0.85rem; margin:0.3rem 0; }
  .detail h4 { font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.1em; margin:1rem 0 0.4rem; }
  .detail h4:first-child { margin-top:0; }
  .chip { font-size:11px; border-radius:999px; padding:0.15rem 0.6rem; border:1px solid var(--panel-border); white-space:nowrap; align-self:flex-start; }
  .chip.status-verified { color:var(--backend-stroke); border-color:var(--backend-stroke); }
  .chip.status-partial { color:var(--cloud-stroke); border-color:var(--cloud-stroke); }
  .chip.status-stale { color:var(--messagebus-stroke); border-color:var(--messagebus-stroke); }
  .chip.status-pending { color:var(--external-stroke); border-color:var(--external-stroke); }
  .chip.status-blocked { color:var(--security-stroke); border-color:var(--security-stroke); }
  .facets { display:flex; gap:0.35rem; flex-wrap:wrap; margin:0.7rem 0; }
  .facet { font-size:11px; border-radius:0.35rem; padding:0.1rem 0.45rem; border:1px solid var(--panel-border); color:var(--text-muted); }
  .facet.ok { color:var(--backend-stroke); border-color:color-mix(in srgb, var(--backend-stroke) 45%, var(--panel-border)); }
  .facet.missing { color:var(--security-stroke); border-color:color-mix(in srgb, var(--security-stroke) 45%, var(--panel-border)); }
  .acceptance { list-style:none; margin:0; padding:0; }
  .acc { display:flex; gap:0.5rem; padding:0.5rem 0; border-bottom:1px dashed var(--panel-border); font-size:0.84rem; align-items:flex-start; }
  .acc-body { display:flex; flex-direction:column; flex:1; min-width:0; }
  .acc .ask { margin-left:auto; flex:none; }
  .col-acceptance .acc-crit { font-weight:600; }
  .ask { font:inherit; font-size:0.68rem; line-height:1; padding:0.2rem 0.45rem; border:1px solid var(--panel-border); border-radius:0.35rem; background:transparent; color:var(--text-muted); cursor:pointer; }
  .ask:hover { color:var(--text); border-color:var(--arrow); }
  .glossary dt .ask { margin-left:0.5rem; }
  .acc-mark { width:1rem; text-align:center; flex:none; }
  .acc-present .acc-mark, .acc-pass .acc-mark { color:var(--backend-stroke); }
  .acc-stale .acc-mark { color:var(--messagebus-stroke); }
  .acc-fail .acc-mark, .acc-missing .acc-mark { color:var(--security-stroke); }
  .acc-unknown .acc-mark { color:var(--external-stroke); }
  .acc-detail { color:var(--text-dim); font-size:0.72rem; }
  code { background:var(--panel); border:1px solid var(--panel-border); border-radius:0.3rem; padding:0 0.3rem; font-size:0.72rem; }
  .anchor-row { margin:0 0 0.4rem; font-size:0.78rem; }
  .anchor-label { color:var(--text-muted); margin-right:0.4rem; }
  .edges { display:flex; flex-direction:column; gap:0.25rem; }
  .edge-pill { font-size:0.78rem; color:var(--text-muted); }
  .edge-pill a, .unit-list a { color:var(--frontend-stroke); text-decoration:none; }
  .ops code { margin-right:0.3rem; }
  .scope { color:var(--text-muted); font-size:0.78rem; display:grid; gap:0.25rem; }
  .scope strong { color:var(--text); }
  .unit-list { margin:0; padding-left:1rem; font-size:0.8rem; }
  .unit-list li { margin:0.25rem 0; }
  .muted { color:var(--text-muted); }
  .blocked-note { color:var(--security-stroke); }
  @media (max-width:760px) { .container { padding-top:72px; } }
`;

export function renderHtml(plane) {
  const { project, coverage, receipt } = plane;
  const groups = plane.hierarchy.nodes.filter((node) => node.kind === "group");
  const designCount = (plane.goals ?? []).reduce((total, goal) => total + (goal.designs ?? []).length, 0);
  const errorList = receipt.errors.length
    ? `<ul class="issues errors">${receipt.errors.map((error) => `<li>${esc(error)}</li>`).join("")}</ul>`
    : `<p class="ok">无阻塞性错误</p>`;
  const warnList = receipt.warnings.length
    ? `<ul class="issues">${receipt.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul>`
    : `<p class="ok">无提示</p>`;
  const goalLine = project.goalStatement
    ? `<p class="subtitle">${esc(project.goalStatement)}</p>`
    : `<p class="subtitle muted">项目目标尚未建立，这不影响工作视图。</p>`;

  return `<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Work Plane · ${esc(project.name)}</title>
<style>${STYLES}</style>
</head>
<body data-detail="right">
<div class="toolbar" role="toolbar" aria-label="视图操作">
  <button id="theme" type="button" aria-label="切换主题">◐ <span>主题</span></button>
</div>

<div class="container">
  <div class="header">
    <div class="header-row"><div class="pulse-dot"></div><h1>${esc(project.name)} · 项目工作视图</h1></div>
    <p class="subtitle">这是把项目拆成功能模块的只读视图：每个方块是一个工作单元，实线箭头表示模块之间的依赖，底部虚线框里的设计来自 Project Tracker，虚线表示它影响了哪些模块。点方块可以看它的功能、完成标准和代码位置。</p>
    ${goalLine}
    <ul class="boundaries"><li>项目根目录 <code>${esc(project.root)}</code></li></ul>
  </div>

  <div class="diagram-container">
    <div class="diagram-toolbar">
      <input id="search" type="search" placeholder="搜索模块名称或编号…" aria-label="搜索" />
      <button class="nav-btn" id="zoom-out" type="button" aria-label="缩小">−</button>
      <button class="nav-btn" id="zoom-in" type="button" aria-label="放大">+</button>
      <button class="nav-btn" id="zoom-fit" type="button" aria-label="适应">适应</button>
      <button class="nav-btn" id="glossary-btn" type="button">术语表</button>
      <span class="spacer"></span>
      <span class="hint">点击节点：高亮相关模块并展开详情</span>
    </div>
    <div class="map-wrap" id="map-wrap">
      <svg id="map" role="img" aria-label="功能层级与设计影响图"><g id="viewport"></g></svg>
    </div>
    <div class="legend">
      <span><i class="swatch" style="background:var(--backend-stroke)"></i>已验证</span>
      <span><i class="swatch" style="background:var(--cloud-stroke)"></i>部分验证</span>
      <span><i class="swatch" style="background:var(--messagebus-stroke)"></i>需重新验证</span>
      <span><i class="swatch" style="background:var(--external-stroke)"></i>待验证</span>
      <span><i class="swatch" style="background:var(--database-stroke)"></i>设计 / 项目目标</span>
      <span><i class="line-swatch"></i>依赖另一个模块</span>
      <span><i class="line-swatch dashed"></i>设计影响某个模块</span>
      <span>虚线框 = 功能分组 / 设计演进</span>
    </div>
  </div>

  <section class="detail" id="detail" aria-live="polite">
    <div class="detail-bar">
      <span class="detail-kind" id="detail-kind">详情</span>
      <span class="spacer"></span>
      <button class="nav-btn" id="detail-place" type="button">移到下面</button>
      <button class="nav-btn" id="detail-close" type="button">关闭</button>
    </div>
    <div id="detail-body"></div>
  </section>

  <div class="cards">
    <div class="card"><div class="card-header"><span class="card-dot violet"></span><h3>工作单元</h3></div><div class="value">${coverage.units}</div><div class="note">分在 ${groups.length} 个功能分组</div></div>
    <div class="card"><div class="card-header"><span class="card-dot emerald"></span><h3>信息完整</h3></div><div class="value">${coverage.defined}/${coverage.units}</div><div class="note">功能 · 完成标准 · 代码位置 · 操作</div></div>
    <div class="card"><div class="card-header"><span class="card-dot amber"></span><h3>完成标准已验证</h3></div><div class="value">${coverage.delivered}</div><div class="note">对应现在的代码</div></div>
    <div class="card"><div class="card-header"><span class="card-dot rose"></span><h3>相关设计</h3></div><div class="value">${designCount}</div><div class="note">来自 Project Tracker</div></div>
  </div>

  <div class="card receipt-card">
    <div class="card-header"><span class="card-dot" style="background:${receipt.pass ? "var(--backend-stroke)" : "var(--security-stroke)"}"></span><h3>检查结果 · ${receipt.pass ? "通过" : "未通过"}</h3></div>
    <div class="receipt-grid">
      <div><strong class="muted" style="font-size:0.72rem">阻塞问题</strong>${errorList}</div>
      <div><strong class="muted" style="font-size:0.72rem">提示</strong>${warnList}</div>
    </div>
    <p class="ctx">当前代码版本 <code>${esc((plane.context?.head ?? "unknown").slice(0, 7))}</code> · 生成于 ${esc(plane.generatedAt)}</p>
  </div>

  <details class="card glossary" id="glossary">
    <summary>术语表 · 共 ${(plane.glossary ?? []).length} 条（点开看每个内部说法的意思）</summary>
    <dl>
      ${(plane.glossary ?? []).map((entry) => `<dt>${esc(entry.term)}<button class="ask" type="button" data-ask-context="术语「${esc(entry.term)}」" data-ask-q="这个词是什么意思？">问</button><button class="ask" type="button" data-change-context="术语「${esc(entry.term)}」的解释" data-change-current="${esc(entry.plain)}">改</button></dt><dd>${esc(entry.plain)}</dd>`).join("\n      ")}
    </dl>
  </details>
</div>

<div class="fb"><button class="nav-btn" id="fb-toggle" type="button">提问与反馈 <span id="fb-count">0</span></button></div>
<section class="fb-panel" id="fb-panel" aria-live="polite">
  <div class="detail-bar">
    <span class="detail-kind">提问与反馈清单</span><span class="spacer"></span>
    <button class="nav-btn" id="fb-copy-all" type="button">复制整份清单</button>
    <button class="nav-btn" id="fb-export" type="button">导出</button>
    <button class="nav-btn" id="fb-clear" type="button">清空</button>
    <button class="nav-btn" id="fb-close" type="button">关闭</button>
  </div>
  <ul id="fb-list"></ul>
  <p class="ctx">点条目旁的「问」提问、点「改」提出修改。每条都单独列出，可逐条复制，也可以复制整份清单后粘贴给 agent 执行。</p>
</section>

<section class="ask-panel" id="ask-panel" aria-live="polite">
  <div class="detail-bar"><span class="detail-kind" id="ask-mode-label">提问</span><span class="spacer"></span><button class="nav-btn" id="ask-close" type="button">关闭</button></div>
  <div class="where" id="ask-where"></div>
  <div id="ask-question-field"><textarea id="ask-text" placeholder="你想问什么？"></textarea></div>
  <div id="ask-change-fields" hidden>
    <label class="field-label" for="change-current">现在的内容</label>
    <textarea id="change-current" readonly></textarea>
    <label class="field-label" for="change-want">希望改成</label>
    <textarea id="change-want" placeholder="直接改成你想要的样子"></textarea>
    <label class="field-label" for="change-reason">理由（可选）</label>
    <textarea id="change-reason" placeholder="为什么这样改"></textarea>
  </div>
  <div class="ask-actions"><button class="nav-btn" id="ask-submit" type="button">复制提问并加入清单</button><span class="hint">复制后到 Pi 里粘贴发送</span></div>
  <textarea id="ask-preview" readonly hidden></textarea>
</section>

<div id="toast" role="status" aria-live="polite"></div>

<script type="application/json" id="plane-data">${JSON.stringify(plane).replace(/</g, "\\u003c")}</script>
<script>${viewerJs}</script>
</body>
</html>`;
}

export function renderMermaid(plane) {
  const { hierarchy, units } = plane;
  const groups = hierarchy.nodes.filter((node) => node.kind === "group");
  const lines = ["flowchart TB", `  ${hierarchy.rootId}(["${plane.project.name}"])`];
  for (const group of groups) {
    lines.push(`  subgraph ${group.id}["${group.title}"]`);
    for (const unit of units.filter((item) => item.parent === group.id)) lines.push(`    ${unit.id}["${unit.id}<br/>${unit.title}"]`);
    lines.push("  end");
    lines.push(`  ${hierarchy.rootId} --> ${group.id}`);
  }
  const grouped = new Set(groups.flatMap((group) => units.filter((unit) => unit.parent === group.id).map((unit) => unit.id)));
  for (const unit of units.filter((item) => !grouped.has(item.id))) lines.push(`  ${unit.id}["${unit.id}<br/>${unit.title}"]`);
  for (const unit of units) for (const dep of unit.edges.dependsOn) lines.push(`  ${dep} --> ${unit.id}`);
  for (const goal of plane.goals ?? []) {
    for (const design of goal.designs ?? []) {
      lines.push(`  ${design.id}["${design.id}<br/>${design.title}"]`);
      for (const unitId of design.unitIds ?? []) lines.push(`  ${design.id} -.-> ${unitId}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
