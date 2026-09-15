import type { TimelineEntry } from "./api";

const STATUS_LABELS: Record<string, string> = {
  STABLE: "稳定",
  ACTIVE: "进行中",
  BLOCKED: "阻塞",
  PLANNED: "已计划",
  DEFERRED: "已推迟",
};

const MATURITY_LABELS: Record<string, string> = {
  CODE_EXISTS: "已有代码",
  DEMO_VERIFIED: "Demo 已验证",
  LOCAL_PROTOTYPE_VERIFIED: "本地原型已验证",
  PRODUCTION_VERIFIED: "生产已验证",
};

const VERIFICATION_LABELS: Record<string, string> = {
  PASS: "通过",
  FAIL: "失败",
  ERROR: "错误",
};

const CONFIDENCE_LABELS: Record<TimelineEntry["confidence"], string> = {
  observed: "已观察",
  reported: "已报告",
  inferred: "推断",
};

const SOURCE_LABELS: Record<TimelineEntry["source"], string> = {
  git: "Git",
  pi_session: "Pi 会话",
  verification: "验证",
  project_state: "项目状态",
};

const CONFLICT_KIND_LABELS: Record<string, string> = {
  stale_verification_claim: "验证结论已过期",
  baseline_drift: "基线已漂移",
  dirty_baseline: "基线包含未提交改动",
  stale_release_state: "发布状态已过期",
  project_boundary_drift: "项目边界已变化",
};

const FRESHNESS_REASON_LABELS: Record<string, string> = {
  "PROJECT_STATE.md missing or has no baseline": "PROJECT_STATE.md 缺失或没有基线",
  "HEAD moved past the recorded baseline": "HEAD 已越过记录的基线",
  "working tree has uncommitted changes": "工作树存在未提交改动",
  "no verification on record for this scan": "本次扫描没有验证记录",
};

export function statusLabel(value: string | null): string {
  if (value === null) return "未知";
  return STATUS_LABELS[value] ?? value;
}

export function maturityLabel(value: string): string {
  return MATURITY_LABELS[value] ?? value;
}

export function verificationLabel(value: string): string {
  return VERIFICATION_LABELS[value] ?? value;
}

export function confidenceLabel(value: TimelineEntry["confidence"]): string {
  return CONFIDENCE_LABELS[value];
}

export function sourceLabel(value: TimelineEntry["source"]): string {
  return SOURCE_LABELS[value];
}

export function conflictKindLabel(value: string): string {
  return CONFLICT_KIND_LABELS[value] ?? value;
}

export function freshnessReasonLabel(value: string): string {
  return FRESHNESS_REASON_LABELS[value] ?? value;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: false,
  }).format(date);
}
