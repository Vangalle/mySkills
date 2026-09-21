/* Workplane viewer — client-side.
   Visual language ported from Archify (MIT) classic preset: semantic class
   names (.c-* / .t-* / .a-* / .m-*), 40px grid, rounded orthogonal edges,
   node = mask + colored rect + sigil + centered label. Interaction is
   click/tap only: no wheel or trackpad gestures.
   The page is read-only: Work Units come from WORKPLANE.json and Designs come
   from the Tracker snapshot embedded in the Plane Document. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const plane = JSON.parse(document.getElementById("plane-data").textContent);
  const nodes = plane.hierarchy.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const unitById = new Map(plane.units.map((u) => [u.id, u]));
  const designById = new Map();
  const designs = [];
  for (const goal of plane.goals ?? []) {
    for (const design of goal.designs ?? []) {
      const entry = { ...design, goalId: goal.id, goalTitle: goal.title };
      designById.set(design.id, entry);
      designs.push(entry);
    }
  }
  const rootId = plane.hierarchy.rootId;
  const goal = byId.get(rootId);

  const STATUS_LABEL = { verified: "已验证", partial: "部分验证", stale: "需重新验证", pending: "待验证", blocked: "受阻" };
  const KIND_LABEL = { goal: "目标", group: "功能分组", capability: "能力", interface: "接口", support: "基础" };
  const GLOSS = new Map((plane.glossary ?? []).map((g) => [g.term, g.plain]));
  const tip = (term) => (GLOSS.has(term) ? ` title="${escAttr(GLOSS.get(term))}"` : "");
  /* status → archify semantic palette (backend/cloud/messagebus/external/security) */
  const STATUS_TOKEN = { verified: "backend", partial: "cloud", stale: "messagebus", pending: "external", blocked: "security" };
  const SIGILS = {
    goal: '<circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="1.6" class="sigil-fill"/>',
    capability: '<path d="M6 3 3 8l3 5M10 3l3 5-3 5"/>',
    interface: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/><circle cx="5" cy="4.5" r="1" class="sigil-fill"/><circle cx="10.5" cy="8" r="1" class="sigil-fill"/><circle cx="7" cy="11.5" r="1" class="sigil-fill"/>',
    support: '<rect x="2.5" y="5" width="8.5" height="8" rx="1.5"/><path d="M8 2.5h5.5V8M13.5 2.5 7.5 8.5"/>',
    group: '<path d="M2.5 5.5h11M2.5 8h11M2.5 10.5h11"/>',
    design: '<path d="M3 2.5h7l3 3v8H3z"/><path d="M10 2.5v3h3"/><path d="M5 9h6M5 11.5h4"/>',
  };

  // --- hierarchy helpers -----------------------------------------------------
  const childrenOf = (id) => byId.get(id)?.children ?? [];
  function descendants(id) {
    const out = [];
    const stack = [...childrenOf(id)];
    while (stack.length) {
      const n = stack.pop();
      out.push(n);
      stack.push(...childrenOf(n));
    }
    return out;
  }
  const collectUnits = (id) => [id, ...descendants(id)].map((x) => unitById.get(x)).filter(Boolean);
  const depUp = new Map();
  const depDown = new Map();
  for (const u of plane.units) { depUp.set(u.id, u.edges.dependsOn.filter((d) => unitById.has(d))); depDown.set(u.id, []); }
  for (const u of plane.units) for (const d of depUp.get(u.id)) depDown.get(d).push(u.id);
  function closure(start, map) {
    const seen = new Set([start]);
    const stack = [...(map.get(start) ?? [])];
    while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); stack.push(...(map.get(id) ?? [])); }
    return seen;
  }
  const unitStatus = (id) => unitById.get(id)?.status ?? "pending";
  function rollup(id) {
    const list = collectUnits(id);
    if (!list.length) return "pending";
    const s = new Set(list.map((u) => u.status));
    if (s.has("blocked")) return "blocked";
    if ([...s].every((x) => x === "verified")) return "verified";
    if (s.has("verified") || s.has("partial")) return "partial";
    if (s.has("stale")) return "stale";
    return "pending";
  }
  const statusOf = (n) => (n.kind === "unit" ? unitStatus(n.id) : n.kind === "group" ? rollup(n.id) : goalStatus());
  function goalStatus() {
    const s = new Set(plane.units.map((u) => u.status));
    if (s.has("blocked")) return "blocked";
    if ([...s].every((x) => x === "verified")) return "verified";
    return s.has("verified") ? "partial" : "pending";
  }

  // --- layout ----------------------------------------------------------------
  const NODE_W = 178, UNIT_H = 68, GOAL_W = 224, GOAL_H = 76, REGION_HEAD = 40;
  const GAP_Y = 16, COL_GAP = 42, PAD = 48, GOAL_GAP = 58;
  const DESIGN_W = 190, DESIGN_H = 58, DESIGN_GAP = 18, DESIGN_COLS = 4, DESIGN_HEAD = 34;
  const layout = new Map();
  const topGroups = goal.children.map((id) => byId.get(id)).filter((n) => n && n.kind === "group");
  const loose = goal.children.map((id) => byId.get(id)).filter((n) => n && n.kind !== "group");
  const columns = topGroups.length ? topGroups : [{ id: "__root", title: "未分组", children: loose.map((n) => n.id), kind: "group" }];

  const REGION_TOP = PAD + GOAL_H + GOAL_GAP;
  let bottom = REGION_TOP;
  const containers = [];
  columns.forEach((col, i) => {
    const x = PAD + i * (NODE_W + COL_GAP);
    let y = REGION_TOP + REGION_HEAD;
    const place = (id, depth) => {
      if (!byId.get(id)) return;
      const indent = depth * 16;
      layout.set(id, { x: x + indent, y, w: NODE_W - indent, h: UNIT_H, cx: x + NODE_W / 2 });
      y += UNIT_H + GAP_Y;
      for (const c of childrenOf(id)) place(c, depth + 1);
    };
    for (const c of col.children) place(c, 0);
    containers.push({ id: col.id, x: x - 14, y: REGION_TOP, w: NODE_W + 28, h: y - REGION_TOP + 8, title: col.title, col: i });
    bottom = Math.max(bottom, y);
  });

  // Design lane (dotted region): historical Designs owned by Project Tracker.
  const designRows = Math.max(1, Math.ceil(designs.length / DESIGN_COLS));
  const designTop = bottom + 44;
  designs.forEach((design, i) => {
    const col = i % DESIGN_COLS;
    const row = Math.floor(i / DESIGN_COLS);
    const x = PAD + col * (DESIGN_W + DESIGN_GAP);
    const y = designTop + row * (DESIGN_H + DESIGN_GAP);
    layout.set(design.id, { x, y, w: DESIGN_W, h: DESIGN_H, cx: x + DESIGN_W / 2 });
  });
  const designLane = designs.length
    ? {
        id: "__designs",
        x: PAD - 14,
        y: designTop - DESIGN_HEAD,
        w: Math.min(DESIGN_COLS, designs.length) * (DESIGN_W + DESIGN_GAP) - DESIGN_GAP + 28,
        h: designRows * (DESIGN_H + DESIGN_GAP) + DESIGN_HEAD - DESIGN_GAP + 8,
        title: "设计演进 · 来自 Project Tracker（只读）",
      }
    : null;
  if (designs.length) bottom = designTop + designRows * (DESIGN_H + DESIGN_GAP);

  const unitsWidth = PAD * 2 + columns.length * NODE_W + (columns.length - 1) * COL_GAP;
  const designsWidth = designLane ? designLane.w + PAD * 2 : 0;
  const totalW = Math.max(unitsWidth, designsWidth);
  const totalH = bottom + PAD;
  layout.set(rootId, { x: (totalW - GOAL_W) / 2, y: PAD, w: GOAL_W, h: GOAL_H, cx: totalW / 2 });

  // --- svg scaffolding -------------------------------------------------------
  const svg = document.getElementById("map");
  svg.setAttribute("viewBox", `0 0 ${totalW} ${totalH}`);
  const defs = document.createElementNS(NS, "defs");
  defs.innerHTML =
    '<marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" class="m-default"/></marker>' +
    '<marker id="arrowhead-derives" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" class="m-derives"/></marker>' +
    '<marker id="arrowhead-hot" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" class="m-hot"/></marker>' +
    '<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" class="c-grid" stroke-width="0.5"/></pattern>';
  svg.insertBefore(defs, svg.firstChild);
  const viewport = document.getElementById("viewport");
  viewport.appendChild(el("rect", { x: 0, y: 0, width: totalW, height: totalH, fill: "url(#grid)" }));
  const layers = {};
  for (const key of ["container", "hier", "dep", "node"]) {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "layer-" + key);
    viewport.appendChild(g);
    layers[key] = g;
  }

  function el(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function text(cls, x, y, value, attrs = {}) {
    const t = el("text", { x, y, class: cls, "text-anchor": "middle", ...attrs });
    t.textContent = value;
    return t;
  }
  const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

  /** Rounded orthogonal polyline, matching Archify's Q-corner routing. */
  function roundedPath(points, r = 7) {
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i], a = points[i - 1], b = points[i + 1];
      const inLen = Math.hypot(p.x - a.x, p.y - a.y) || 1;
      const outLen = Math.hypot(b.x - p.x, b.y - p.y) || 1;
      const rr = Math.min(r, inLen / 2, outLen / 2);
      const p1 = { x: p.x - ((p.x - a.x) / inLen) * rr, y: p.y - ((p.y - a.y) / inLen) * rr };
      const p2 = { x: p.x + ((b.x - p.x) / outLen) * rr, y: p.y + ((b.y - p.y) / outLen) * rr };
      d += ` L ${p1.x} ${p1.y} Q ${p.x} ${p.y} ${p2.x} ${p2.y}`;
    }
    const last = points[points.length - 1];
    return `${d} L ${last.x} ${last.y}`;
  }
  const channelUse = new Map();
  function route(a, b) {
    const aSameCol = Math.abs(a.cx - b.cx) < 9;
    if (aSameCol) {
      const rightRoom = a.x + a.w + 24 <= totalW - PAD;
      const key = (rightRoom ? "R" : "L") + Math.round(a.x);
      const n = channelUse.get(key) ?? 0;
      channelUse.set(key, n + 1);
      const off = (n % 3) * 9;
      const channelX = rightRoom ? a.x + a.w + 12 + off : a.x - 12 - off;
      const p1 = { x: rightRoom ? a.x + a.w : a.x, y: a.y + a.h / 2 };
      const p2 = { x: rightRoom ? b.x + b.w : b.x, y: b.y + b.h / 2 };
      return roundedPath([p1, { x: channelX, y: p1.y }, { x: channelX, y: p2.y }, p2]);
    }
    const right = a.cx < b.cx;
    const p1 = { x: right ? a.x + a.w : a.x, y: a.y + a.h / 2 };
    const p2 = { x: right ? b.x : b.x + b.w, y: b.y + b.h / 2 };
    const midX = (p1.x + p2.x) / 2;
    return roundedPath([p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2]);
  }

  // Regions (functional domains) as Archify lanes.
  for (const c of containers) {
    const g = el("g", { class: "region" });
    g.dataset.for = c.id;
    g.appendChild(el("rect", { x: c.x, y: c.y, width: c.w, height: c.h, rx: 12, class: "c-lane", "stroke-width": 1 }));
    const list = collectUnits(c.id);
    const label = text("t-muted lane-label", c.x + 14, c.y + 25, c.title, { "text-anchor": "start" });
    label.setAttribute("font-size", "12");
    g.appendChild(label);
    const count = text("t-dim", c.x + c.w - 14, c.y + 25, `${list.filter((u) => u.status === "verified").length}/${list.length}`, { "text-anchor": "end" });
    count.setAttribute("font-size", "10");
    g.appendChild(count);
    g.addEventListener("click", (ev) => { ev.stopPropagation(); if (!dragged) select(c.id); });
    g.appendChild(Object.assign(el("title", {}), { textContent: `${c.id} — ${c.title}` }));
    layers.container.appendChild(g);
  }
  if (designLane) {
    const g = el("g", { class: "region" });
    g.dataset.for = designLane.id;
    g.appendChild(el("rect", { x: designLane.x, y: designLane.y, width: designLane.w, height: designLane.h, rx: 12, class: "c-lane", "stroke-width": 1, "stroke-dasharray": "5,4" }));
    const label = text("t-database lane-label", designLane.x + 14, designLane.y + 22, designLane.title, { "text-anchor": "start" });
    label.setAttribute("font-size", "11");
    g.appendChild(label);
    layers.container.appendChild(g);
  }

  // Hierarchy spine: goal → region.
  const hierEdges = [];
  for (const c of containers) {
    const a = layout.get(rootId);
    const p1 = { x: a.cx, y: a.y + a.h };
    const p2 = { x: c.x + c.w / 2, y: c.y };
    const path = el("path", { d: roundedPath([p1, { x: p1.x, y: (p1.y + p2.y) / 2 }, { x: p2.x, y: (p1.y + p2.y) / 2 }, p2], 6), class: "a-hier" });
    layers.hier.appendChild(path);
    hierEdges.push({ from: rootId, to: c.id, el: path });
  }

  // Dependency and Design-impact edges.
  const depEdges = [];
  function addEdge(from, to, kind) {
    const a = layout.get(from), b = layout.get(to);
    if (!a || !b) return;
    const soft = kind === "design";
    const path = el("path", {
      d: route(a, b),
      class: soft ? "a-derives" : "a-default",
      "stroke-width": soft ? 1.2 : 1.5,
      "marker-end": soft ? "url(#arrowhead-derives)" : "url(#arrowhead)",
      "data-kind": kind,
    });
    layers.dep.appendChild(path);
    depEdges.push({ from, to, el: path, kind });
  }
  for (const u of plane.units) for (const d of depUp.get(u.id)) addEdge(d, u.id, "depends");
  for (const design of designs) for (const unitId of design.unitIds ?? []) addEdge(design.id, unitId, "design");

  // Nodes (Archify component style).
  const nodeEls = new Map();
  function drawNode(node) {
    const box = layout.get(node.id);
    if (!box) return;
    const status = statusOf(node);
    const token = node.kind === "goal" ? "database" : STATUS_TOKEN[status];
    const g = el("g", { class: "node", transform: `translate(${box.x} ${box.y})`, tabindex: "0", role: "button" });
    g.dataset.id = node.id;
    g.dataset.status = status;
    g.dataset.kind = node.kind;
    g.appendChild(el("rect", { width: box.w, height: box.h, rx: 6, class: "c-mask" }));
    g.appendChild(el("rect", { width: box.w, height: box.h, rx: 6, class: `c-${token}`, "stroke-width": 1.5 }));
    const sigil = el("g", { class: "semantic-sigil", transform: "translate(10 9) scale(0.72)" });
    sigil.innerHTML = SIGILS[node.kind === "goal" ? "goal" : node.kind] ?? SIGILS.support;
    g.appendChild(sigil);
    const unit = unitById.get(node.id);
    if (node.kind === "unit") {
      g.appendChild(text("t-primary n-title", box.w / 2, 28, truncate(node.title, 12), { "font-size": "11", "font-weight": "600" }));
      g.appendChild(text("t-muted n-id", box.w / 2, 43, truncate(node.id, 24), { "font-size": "9" }));
      g.appendChild(text(`t-${token} n-meta`, box.w / 2, 57, `${KIND_LABEL[unit.kind]} · 完成 ${unit.progress.satisfied}/${unit.progress.total}`, { "font-size": "8" }));
    } else {
      g.appendChild(text("t-primary n-title", box.w / 2, 33, truncate(node.title, 16), { "font-size": "12", "font-weight": "700" }));
      g.appendChild(text("t-muted n-id", box.w / 2, 50, "项目目标", { "font-size": "9" }));
      g.appendChild(text("t-database n-meta", box.w / 2, 64, `${plane.units.length} 个单元`, { "font-size": "8" }));
    }
    g.appendChild(Object.assign(el("title", {}), { textContent: `${node.id} — ${node.title}` }));
    g.addEventListener("click", (ev) => { ev.stopPropagation(); if (!dragged) select(node.id); });
    g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(node.id); } });
    layers.node.appendChild(g);
    nodeEls.set(node.id, g);
  }
  drawNode(goal);
  for (const u of plane.units) drawNode(byId.get(u.id));

  const designEls = new Map();
  for (const design of designs) {
    const box = layout.get(design.id);
    if (!box) continue;
    const g = el("g", { class: "node", transform: `translate(${box.x} ${box.y})`, tabindex: "0", role: "button" });
    g.dataset.id = design.id;
    g.dataset.kind = "design";
    g.appendChild(el("rect", { width: box.w, height: box.h, rx: 6, class: "c-mask" }));
    g.appendChild(el("rect", { width: box.w, height: box.h, rx: 6, class: "c-database", "stroke-width": 1.5 }));
    const sigil = el("g", { class: "semantic-sigil", transform: "translate(10 9) scale(0.72)" });
    sigil.innerHTML = SIGILS.design;
    g.appendChild(sigil);
    g.appendChild(text("t-primary n-title", box.w / 2, 30, truncate(design.title, 13), { "font-size": "10", "font-weight": "600" }));
    g.appendChild(text("t-muted n-id", box.w / 2, 45, truncate(design.id, 26), { "font-size": "8" }));
    g.appendChild(text("t-database n-meta", box.w / 2, 58, `影响 ${(design.unitIds ?? []).length} 个模块`, { "font-size": "8" }));
    g.appendChild(Object.assign(el("title", {}), { textContent: `${design.id} — ${design.title}` }));
    g.addEventListener("click", (ev) => { ev.stopPropagation(); if (!dragged) select(design.id); });
    g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(design.id); } });
    layers.node.appendChild(g);
    designEls.set(design.id, g);
  }

  // --- selection & highlighting ---------------------------------------------
  let selected = null;
  function designRelated(id) {
    const design = designById.get(id);
    const set = new Set([id]);
    const impacted = (design?.unitIds ?? []).filter((unitId) => byId.has(unitId));
    for (const unitId of impacted) {
      set.add(unitId);
      const node = byId.get(unitId);
      for (const a of node.ancestors) set.add(a);
      for (const d of descendants(unitId)) set.add(d);
      for (const x of closure(unitId, depUp)) set.add(x);
      for (const x of closure(unitId, depDown)) set.add(x);
      for (const rel of unitById.get(unitId)?.designs ?? []) set.add(rel.designId);
    }
    return set;
  }
  function computeRelated(id) {
    if (designById.has(id)) return designRelated(id);
    const node = byId.get(id);
    const set = new Set([id]);
    if (!node || node.kind === "goal") {
      for (const n of byId.values()) set.add(n.id);
      for (const d of designById.keys()) set.add(d);
      return set;
    }
    for (const a of node.ancestors) set.add(a);
    for (const d of descendants(id)) set.add(d);
    const seeds = node.kind === "unit" ? [id] : collectUnits(id).map((u) => u.id);
    for (const s of seeds) { for (const x of closure(s, depUp)) set.add(x); for (const x of closure(s, depDown)) set.add(x); }
    for (const s of seeds) for (const rel of unitById.get(s)?.designs ?? []) set.add(rel.designId);
    return set;
  }
  function clearSelection() {
    selected = null;
    svg.removeAttribute("data-focus-active");
    for (const g of nodeEls.values()) g.classList.remove("dim", "sel");
    for (const g of designEls.values()) g.classList.remove("dim", "sel");
    for (const e of [...depEdges, ...hierEdges]) e.el.classList.remove("dim", "hl");
    document.querySelectorAll(".region").forEach((r) => r.classList.remove("dim", "hl"));
    document.getElementById("detail").classList.remove("open");
    document.querySelector(".diagram-container").classList.remove("has-detail");
  }
  function select(id) {
    selected = id;
    svg.setAttribute("data-focus-active", "");
    const related = computeRelated(id);
    for (const [nid, g] of nodeEls) {
      g.classList.toggle("dim", !related.has(nid));
      g.classList.toggle("sel", nid === id);
    }
    for (const [did, g] of designEls) {
      g.classList.toggle("dim", !related.has(did));
      g.classList.toggle("sel", did === id);
    }
    for (const e of depEdges) {
      const hot = related.has(e.from) && related.has(e.to);
      e.el.classList.toggle("hl", hot);
      e.el.classList.toggle("dim", !hot);
      e.el.setAttribute("marker-end", hot ? "url(#arrowhead-hot)" : e.kind === "design" ? "url(#arrowhead-derives)" : "url(#arrowhead)");
    }
    for (const e of hierEdges) {
      const hot = related.has(e.from) && related.has(e.to);
      e.el.classList.toggle("hl", hot);
      e.el.classList.toggle("dim", !hot);
    }
    document.querySelectorAll(".region").forEach((r) => {
      if (r.dataset.for === "__designs") {
        r.classList.toggle("dim", false);
        r.classList.toggle("hl", [...designEls.keys()].some((did) => related.has(did)));
        return;
      }
      const inside = collectUnits(r.dataset.for).some((u) => related.has(u.id));
      r.classList.toggle("dim", !inside && r.dataset.for !== id);
      r.classList.toggle("hl", r.dataset.for === id);
    });
    showDetail(id);
  }

  // --- detail drawer ---------------------------------------------------------
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const escAttr = (v) => esc(v);
  const chip = (s) => `<span class="chip status-${s}"${tip(STATUS_LABEL[s])}>${STATUS_LABEL[s] ?? s}</span>`;
  const link = (id) => (byId.has(id) || unitById.has(id) || designById.has(id) ? `<a href="#" data-goto="${esc(id)}">${esc(id)}</a>` : esc(id));
  const FINE = { function: "功能", boundary: "功能范围", contract: "对外接口", acceptance: "完成标准", anchors: "代码位置", operations: "可执行操作" };
  const changeBtn = (context, current) => `<button class="ask" type="button" data-change-context="${escAttr(context)}" data-change-current="${escAttr(current)}">改</button>`;
  function evidenceLine(r) {
    if (!r) return "";
    if (r.status === "unknown") return "需要人工确认，这里不代替判断";
    const parts = [];
    if (r.command) parts.push(`<code>${esc(r.command)}</code>`);
    if (r.status === "pass") parts.push("在当前快照上通过");
    else if (r.status === "stale") parts.push("记录的是旧版本");
    else if (r.status === "fail") parts.push("未通过");
    else if (r.status === "missing") parts.push("快照里没有运行记录");
    return parts.join(" · ");
  }
  function evidenceTitle(r) {
    const bits = [];
    if (r.evidenceId) bits.push(`证据编号 ${r.evidenceId}`);
    if (r.verifiedAt) bits.push(`检查于 ${r.verifiedAt}`);
    if (r.freshness) bits.push(`时效 ${r.freshness}`);
    return bits.join(" · ");
  }
  function designList(u) {
    if (!u.designs || !u.designs.length) return '<p class="muted">没有关联的设计</p>';
    return `<ul class="unit-list">${u.designs.map((d) => `<li><a href="#" data-goto="${esc(d.designId)}">${esc(d.title)}</a> <span class="muted">${esc(d.goalId)}</span></li>`).join("")}</ul>`;
  }
  function detailUnit(u) {
    const facets = Object.entries(u.facets).map(([k, ok]) => `<span class="facet ${ok ? "ok" : "missing"}"${tip(FINE[k])}>${ok ? "✓" : "✗"} ${FINE[k]}</span>`).join("");
    const acc = u.acceptance.length
      ? u.acceptance.map((a) => {
          const mark = { pass: "✓", present: "✓", stale: "!", fail: "✗", missing: "✗", unknown: "?" }[a.resolved.status] ?? "?";
          const where = `工作单元 ${u.id} 的完成标准「${a.criterion}」`;
          return `<li class="acc acc-${a.resolved.status}"><span class="acc-mark">${mark}</span><span class="acc-body"><span class="acc-crit">${esc(a.criterion)}</span><span class="acc-detail" title="${escAttr(evidenceTitle(a.resolved))}">${evidenceLine(a.resolved)}</span></span><button class="ask" type="button" data-ask-context="${esc(where)}" data-ask-q="这条完成标准具体是什么意思？">问</button>${changeBtn(where, a.criterion)}</li>`;
        }).join("")
      : '<li class="muted">未声明验收条件</li>';
    const anchors = [["代码", u.anchors.code], ["文档", u.anchors.docs], ["Map", u.anchors.map]]
      .filter(([, l]) => l.length)
      .map(([k, l]) => `<div class="anchor-row"><span class="anchor-label">${k}</span>${l.map((x) => `<code>${esc(x)}</code>`).join(" ")}</div>`).join("") || '<p class="muted">没有锚点</p>';
    const rel = [];
    if (u.edges.dependsOn.length) rel.push(`要用到 → ${u.edges.dependsOn.map(link).join("、")}`);
    if (u.relations.dependents.length) rel.push(`被这些模块用到 ← ${u.relations.dependents.map(link).join("、")}`);
    return `<div class="d-head"><div><h3>${esc(u.id)}</h3><p class="muted">${esc(u.title)} · ${KIND_LABEL[u.kind]}</p></div><div class="d-head-right">${chip(u.status)}<button class="ask" type="button" data-ask-context="工作单元 ${esc(u.id)}（${esc(u.title)}）" data-ask-q="这个模块是做什么的？">问</button>${changeBtn(`工作单元 ${u.id} 的名称`, u.title)}</div></div>
      <div class="does-row"><p class="does">${esc(u.function.does)}</p>${changeBtn(`工作单元 ${u.id} 的功能说明`, u.function.does)}</div>
      <div class="facets">${facets}</div>
      ${u.blocked ? `<p class="blocked-note">受阻：${esc(u.blocked.reason)}</p>` : ""}
      <div class="d-grid">
        <section class="col-acceptance"><h4>完成标准与证据</h4><ul class="acceptance">${acc}</ul></section>
        <section>
          <h4>功能范围</h4>
          <div class="scope">
            <div><strong>做什么</strong></div>
            <ul class="scope-list">${u.function.inScope.map((s) => `<li><span>${esc(s)}</span>${changeBtn(`工作单元 ${u.id} 的“做什么”：${s}`, s)}</li>`).join("") || '<li class="muted">—</li>'}</ul>
            <div><strong>不做什么</strong></div>
            <ul class="scope-list">${u.function.outOfScope.map((s) => `<li><span>${esc(s)}</span>${changeBtn(`工作单元 ${u.id} 的“不做什么”：${s}`, s)}</li>`).join("") || '<li class="muted">—</li>'}</ul>
          </div>
          <h4>可执行操作</h4><div class="ops">${u.operations.map((o) => `<code>${esc(o)}</code>`).join(" ") || '<span class="muted">未声明</span>'}</div>
        </section>
        <section><h4>代码与文档位置</h4>${anchors}<h4>关系</h4><div class="edges">${rel.length ? rel.map((r) => `<span class="edge-pill">${r}</span>`).join("") : '<span class="muted">无显式依赖</span>'}</div></section>
        <section><h4>相关设计</h4>${designList(u)}</section>
      </div>`;
  }
  function detailGroup(g) {
    const list = collectUnits(g.id);
    return `<div class="d-head"><div><h3>${esc(g.id)}</h3><p class="muted">${esc(g.title)} · 功能分组</p></div><div class="d-head-right">${chip(rollup(g.id))}<button class="ask" type="button" data-ask-context="功能分组 ${esc(g.id)}（${esc(g.title)}）" data-ask-q="这个功能分组包含哪些模块？">问</button>${changeBtn(`功能分组 ${g.id} 的名称`, g.title)}</div></div>
      <p class="does">这个功能分组包含 ${list.length} 个工作单元，其中 ${list.filter((u) => u.status === "verified").length} 个已验证。</p>
      <div class="d-grid"><section><h4>包含的工作单元</h4><ul class="unit-list">${list.map((u) => `<li><a href="#" data-goto="${esc(u.id)}">${esc(u.title)}</a> ${chip(u.status)}</li>`).join("")}</ul></section></div>`;
  }
  function detailGoal() {
    const p = plane.project;
    return `<div class="d-head"><div><h3>${esc(p.name)}</h3><p class="muted">项目目标 · 整张图的根节点</p></div><div class="d-head-right">${chip(goalStatus())}<button class="ask" type="button" data-ask-context="项目目标「${esc(p.name)}」" data-ask-q="这个项目的目标到底在说什么？">问</button></div></div>
      <div class="does-row"><p class="does">${p.goalStatement ? esc(p.goalStatement) : "尚未建立项目目标。"}</p></div>
      <div class="d-grid">
        <section><h4>覆盖情况</h4><p>共 ${plane.coverage.units} 个工作单元，信息完整 ${plane.coverage.defined} 个，已验证 ${plane.coverage.delivered} 个。</p><p class="muted">项目根目录：<code>${esc(p.root)}</code></p></section>
      </div>`;
  }
  function detailDesign(d) {
    const affected = (d.unitIds ?? []).map((unitId) => unitById.get(unitId)).filter(Boolean);
    const progress = d.progress ?? [];
    const acceptance = d.acceptance ?? [];
    const where = `设计 ${d.id}（${d.title}）`;
    return `<div class="d-head"><div><h3>${esc(d.id)}</h3><p class="muted">${esc(d.title)} · 设计 · 来自 ${esc(d.goalTitle)}</p></div><div class="d-head-right"><button class="ask" type="button" data-ask-context="${escAttr(where)}" data-ask-q="这次设计变化到底做了什么？">问</button></div></div>
      <p class="does">这是 Project Tracker 拥有的设计变化，工作视图只读展示它影响了哪些功能模块。</p>
      <div class="d-grid">
        <section><h4>受影响的模块</h4>${affected.length ? `<ul class="unit-list">${affected.map((u) => `<li><a href="#" data-goto="${esc(u.id)}">${esc(u.title)}</a> ${chip(u.status)}</li>`).join("")}</ul>` : '<p class="muted">尚未声明影响范围</p>'}</section>
        <section><h4>Tracker 进展</h4>${progress.length ? `<ul class="unit-list">${progress.map((entry) => `<li>${esc(entry.text)} <span class="muted">${esc(entry.recordedAt)}</span></li>`).join("")}</ul>` : '<p class="muted">尚无进展记录</p>'}</section>
        <section><h4>设计验收</h4>${acceptance.length ? `<ul class="unit-list">${acceptance.map((entry) => `<li>${entry.complete ? "✓" : "○"} ${esc(entry.criterion)}</li>`).join("")}</ul>` : '<p class="muted">尚未声明验收条件</p>'}</section>
      </div>`;
  }
  function showDetail(id) {
    const panel = document.getElementById("detail");
    const body = document.getElementById("detail-body");
    if (designById.has(id)) {
      body.innerHTML = detailDesign(designById.get(id));
      document.getElementById("detail-kind").textContent = "设计";
    } else {
      const node = byId.get(id);
      if (!node) return;
      body.innerHTML = node.kind === "unit" ? detailUnit(unitById.get(id)) : node.kind === "group" ? detailGroup(node) : detailGoal();
      document.getElementById("detail-kind").textContent = node.kind === "unit" ? "工作单元" : node.kind === "group" ? "功能分组" : "项目目标";
    }
    panel.classList.add("open");
    document.querySelector(".diagram-container").classList.add("has-detail");
    body.querySelectorAll("[data-goto]").forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); select(a.dataset.goto); }));
    if (document.body.getAttribute("data-detail") === "bottom") panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // --- on-screen navigation only (no wheel / trackpad gestures) --------------
  let tx = 0, ty = 0, k = 1, dragged = false;
  const applyTransform = () => document.getElementById("viewport").setAttribute("transform", `translate(${tx} ${ty}) scale(${k})`);
  document.getElementById("zoom-in").addEventListener("click", () => { k = Math.min(2.4, k * 1.2); applyTransform(); });
  document.getElementById("zoom-out").addEventListener("click", () => { k = Math.max(0.4, k / 1.2); applyTransform(); });
  document.getElementById("zoom-fit").addEventListener("click", () => { tx = 0; ty = 0; k = 1; applyTransform(); });

  const PLACE_KEY = "workplane-detail-place";
  const detailPanel = document.getElementById("detail");
  const placeBtn = document.getElementById("detail-place");
  const currentPlace = () => document.body.getAttribute("data-detail") || "right";
  function applyPlacement(place) {
    document.body.setAttribute("data-detail", place);
    placeBtn.textContent = place === "right" ? "移到下面" : "移到右侧";
  }
  try { const saved = localStorage.getItem(PLACE_KEY); if (saved === "right" || saved === "bottom") applyPlacement(saved); } catch (_) {}
  placeBtn.addEventListener("click", () => {
    const next = currentPlace() === "right" ? "bottom" : "right";
    applyPlacement(next);
    try { localStorage.setItem(PLACE_KEY, next); } catch (_) {}
    if (next === "bottom" && selected) detailPanel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  document.getElementById("detail-close").addEventListener("click", clearSelection);
  document.getElementById("glossary-btn").addEventListener("click", () => {
    clearSelection();
    const g = document.getElementById("glossary");
    g.open = true;
    g.scrollIntoView({ block: "start", behavior: "smooth" });
  });
  document.getElementById("theme").addEventListener("click", () => {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
  });

  const svgWrap = document.getElementById("map-wrap");
  let panning = null;
  svgWrap.addEventListener("pointerdown", (e) => { panning = { x: e.clientX, y: e.clientY, tx, ty, moved: false }; });
  window.addEventListener("pointermove", (e) => {
    if (!panning) return;
    const dx = e.clientX - panning.x, dy = e.clientY - panning.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) panning.moved = true;
    if (panning.moved) {
      dragged = true;
      tx = panning.tx + dx; ty = panning.ty + dy;
      applyTransform();
      svgWrap.classList.add("panning");
    }
  });
  window.addEventListener("pointerup", () => {
    panning = null;
    svgWrap.classList.remove("panning");
    setTimeout(() => (dragged = false), 0);
  });
  svgWrap.addEventListener("click", (e) => {
    if (dragged) return;
    if (!e.target.closest(".node") && !e.target.closest(".region")) clearSelection();
  });

  // --- search ----------------------------------------------------------------
  document.getElementById("search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    for (const [id, g] of nodeEls) {
      const n = byId.get(id);
      g.classList.remove("dim", "sel");
      if (!q) continue;
      const hit = id.toLowerCase().includes(q) || n.title.toLowerCase().includes(q);
      g.classList.toggle("dim", !hit);
    }
    for (const [id, g] of designEls) {
      const d = designById.get(id);
      g.classList.remove("dim", "sel");
      if (!q) continue;
      const hit = id.toLowerCase().includes(q) || d.title.toLowerCase().includes(q);
      g.classList.toggle("dim", !hit);
    }
    document.querySelectorAll(".region").forEach((r) => r.classList.add("dim"));
    if (!q) { for (const e2 of [...depEdges, ...hierEdges]) e2.el.classList.remove("dim", "hl"); svg.removeAttribute("data-focus-active"); document.querySelectorAll(".region").forEach((r) => r.classList.remove("dim", "hl")); }
  });

  // --- ask / feedback fast path ----------------------------------------------
  const FB_KEY = "workplane-feedback";
  let feedback = [];
  try { feedback = JSON.parse(localStorage.getItem(FB_KEY) || "[]"); } catch (_) { feedback = []; }
  const saveFeedback = () => { try { localStorage.setItem(FB_KEY, JSON.stringify(feedback)); } catch (_) {} };

  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 3000);
  }
  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); return true; } catch (_) { /* fall through */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (_) { return false; }
  }
  function composePrompt(where, question) {
    return [
      "我在看项目工作视图时有一条提问/反馈。",
      `位置：${where}`,
      `问题：${question || "这里是什么意思？"}`,
      "请用普通话解释它在本项目里具体指什么；如果这条信息本身不对，请直接说明应该改成什么。",
    ].join("\n");
  }
  let askWhere = "";
  let askMode = "ask";
  function showAskPanel() {
    const preview = document.getElementById("ask-preview");
    preview.hidden = true;
    preview.value = "";
    document.getElementById("ask-panel").classList.add("open");
  }
  function openAsk(where, question) {
    askMode = "ask";
    askWhere = where;
    document.getElementById("ask-mode-label").textContent = "提问";
    document.getElementById("ask-submit").textContent = "复制提问并加入清单";
    document.getElementById("ask-where").textContent = where;
    document.getElementById("ask-text").value = question || "这里是什么意思？";
    document.getElementById("ask-question-field").hidden = false;
    document.getElementById("ask-change-fields").hidden = true;
    showAskPanel();
  }
  function openChange(where, current) {
    askMode = "change";
    askWhere = where;
    document.getElementById("ask-mode-label").textContent = "修改";
    document.getElementById("ask-submit").textContent = "复制修改请求并加入清单";
    document.getElementById("ask-where").textContent = where;
    document.getElementById("change-current").value = current || "";
    document.getElementById("change-want").value = current || "";
    document.getElementById("change-reason").value = "";
    document.getElementById("ask-question-field").hidden = true;
    document.getElementById("ask-change-fields").hidden = false;
    showAskPanel();
  }
  function composeChangePrompt(where, current, want, reason) {
    return [
      "我要修改项目工作视图里的一条内容。",
      `位置：${where}`,
      `现在的内容：${current || "（空）"}`,
      `希望改成：${want}`,
      `理由：${reason || "未填写"}`,
      "这是定义/结构类修改，请先说明会影响到哪些模块或完成标准并让我确认；确认后再更新 WORKPLANE.json、重新生成视图并跑质量回执。",
    ].join("\n");
  }
  document.addEventListener("click", (e) => {
    const askBtn = e.target.closest("[data-ask-context]");
    if (askBtn) { e.preventDefault(); e.stopPropagation(); openAsk(askBtn.dataset.askContext, askBtn.dataset.askQ); return; }
    const chgBtn = e.target.closest("[data-change-context]");
    if (chgBtn) { e.preventDefault(); e.stopPropagation(); openChange(chgBtn.dataset.changeContext, chgBtn.dataset.changeCurrent); }
  });
  document.getElementById("ask-close").addEventListener("click", () => document.getElementById("ask-panel").classList.remove("open"));
  document.getElementById("ask-submit").addEventListener("click", async () => {
    let prompt;
    if (askMode === "change") {
      const want = document.getElementById("change-want").value.trim();
      if (!want) return toast("请先填写希望改成什么。");
      const current = document.getElementById("change-current").value.trim();
      const reason = document.getElementById("change-reason").value.trim();
      prompt = composeChangePrompt(askWhere, current, want, reason);
      feedback.push({ at: new Date().toISOString(), kind: "change", where: askWhere, current, want, reason, prompt });
    } else {
      const question = document.getElementById("ask-text").value.trim() || "这里是什么意思？";
      prompt = composePrompt(askWhere, question);
      feedback.push({ at: new Date().toISOString(), kind: "ask", where: askWhere, question, prompt });
    }
    const ok = await copyText(prompt);
    saveFeedback();
    renderFeedback();
    const preview = document.getElementById("ask-preview");
    preview.value = prompt;
    preview.hidden = false;
    toast(ok ? "已复制，去 Pi 里粘贴发送即可。" : "自动复制失败，请手动复制下面的内容。");
  });
  document.getElementById("ask-preview").addEventListener("focus", (e) => e.target.select());

  function renderFeedback() {
    document.getElementById("fb-count").textContent = String(feedback.length);
    const list = document.getElementById("fb-list");
    if (!feedback.length) {
      list.innerHTML = '<li class="muted">还没有记录。点任意条目旁的「问」或「改」就会加入这里。</li>';
      return;
    }
    list.innerHTML = feedback
      .map((f, i) => {
        const isChange = f.kind === "change";
        const detail = isChange ? `改成：${f.want ?? ""}` : f.question;
        return `<li class="fb-item"><span class="fb-index">${i + 1}</span><span class="fb-body"><span class="fb-where"><span class="fb-kind ${isChange ? "kind-change" : "kind-ask"}">${isChange ? "修改" : "提问"}</span>${esc(f.where)}</span><span class="fb-q">${esc(detail)}</span></span><span class="fb-item-actions"><button class="ask" type="button" data-fb-copy="${i}">复制这条</button><button class="ask" type="button" data-fb-remove="${i}">删除</button></span></li>`;
      })
      .join("");
  }
  function feedbackMarkdown() {
    if (!feedback.length) return "";
    const lines = ["# 项目工作视图 · 提问与修改清单", ""];
    feedback.forEach((f, i) => {
      const isChange = f.kind === "change";
      lines.push(`## ${i + 1}. [${isChange ? "修改" : "提问"}] ${f.where}`);
      if (isChange) {
        lines.push(`- 现在：${f.current || "（空）"}`);
        lines.push(`- 改成：${f.want}`);
        if (f.reason) lines.push(`- 理由：${f.reason}`);
      } else {
        lines.push(`- 问题：${f.question}`);
      }
      lines.push("- 可直接粘贴给 agent：");
      lines.push("");
      lines.push("```");
      lines.push(f.prompt);
      lines.push("```");
      lines.push("");
    });
    return lines.join("\n");
  }
  document.getElementById("fb-list").addEventListener("click", async (e) => {
    const copyBtn = e.target.closest("[data-fb-copy]");
    if (copyBtn) {
      const item = feedback[Number(copyBtn.dataset.fbCopy)];
      if (item) toast((await copyText(item.prompt)) ? "已复制这一条。" : "复制失败。");
      return;
    }
    const removeBtn = e.target.closest("[data-fb-remove]");
    if (removeBtn) {
      feedback.splice(Number(removeBtn.dataset.fbRemove), 1);
      saveFeedback();
      renderFeedback();
    }
  });
  document.getElementById("fb-toggle").addEventListener("click", () => document.getElementById("fb-panel").classList.toggle("open"));
  document.getElementById("fb-close").addEventListener("click", () => document.getElementById("fb-panel").classList.remove("open"));
  document.getElementById("fb-copy-all").addEventListener("click", async () => {
    if (!feedback.length) return toast("清单是空的。");
    toast((await copyText(feedbackMarkdown())) ? "已复制整份清单（每条分开）。" : "复制失败。");
  });
  document.getElementById("fb-export").addEventListener("click", () => {
    if (!feedback.length) return toast("清单是空的。");
    const blob = new Blob([feedbackMarkdown()], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "workplane-feedback.md";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById("fb-clear").addEventListener("click", () => { feedback = []; saveFeedback(); renderFeedback(); toast("已清空。"); });
  renderFeedback();

  applyTransform();
})();
