import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

// Role models come from ~/.pi/agent/model-collaboration.json as provider/model strings for
// planner, worker, and reviewer. Missing roles fall back to the current model (planner) and the
// explicit deployment defaults below; PI_MODEL_COLLABORATION_CONFIG overrides the file path.
// Saving global defaults rewrites only this file, for new sessions; session assignments stay in
// the session branch.
const STATE_TYPE = 'model-collaboration';
const ROUTING_TYPE = 'model-collaboration-routing';
const REVOCATION_TYPE = 'model-collaboration-revocation';
const CONFIG_ENV = 'PI_MODEL_COLLABORATION_CONFIG';
const CONFIG_PATH = join(homedir(), '.pi', 'agent', 'model-collaboration.json');
const DEFAULT_WORKER_MODEL = 'deepseek/deepseek-flash';
const DEFAULT_REVIEWER_MODEL = 'deepseek/deepseek-flash';

type Role = 'planner' | 'worker' | 'reviewer';
type RoleAssignment = Record<Role, string>;
type RoleConfig = Partial<RoleAssignment>;

interface Choice {
  value: string;
  label: string;
  description?: string;
}

const ROLES: readonly Role[] = ['planner', 'worker', 'reviewer'];
const SESSION_SCOPE = 'Only this session';
const GLOBAL_SCOPE = 'Also save as global defaults';
const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const DISABLED_STATE = { disabled: true } as const;

// The searchable pickers match any provider/model keyword, not only a prefix.
export function filterChoices<T extends Choice>(choices: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...choices];
  return choices.filter((choice) => [choice.value, choice.label, choice.description ?? '']
    .some((text) => text.toLowerCase().includes(needle)));
}

// pi-subagents accepts these aliases for the same writer/reviewer agents.
const ROLE_ALIASES: Record<string, Role> = {
  worker: 'worker',
  developer: 'worker',
  coder: 'worker',
  implementer: 'worker',
  develop: 'worker',
  reviewer: 'reviewer',
};

// pi-subagents 0.81.0 subagent actions that cannot start child, workflow, scheduled, or peer-session
// model work. Every action outside this set is refused after consent: known launch actions because
// the tool input does not prove which model they will use, and unknown actions because a newer
// pi-subagents release may add another launch path.
const SAFE_SUBAGENT_ACTIONS = new Set([
  'list',
  'get',
  'models',
  'children.list',
  'guide',
  'validate',
  'create',
  'update',
  'delete',
  'eject',
  'disable',
  'enable',
  'reset',
  'mission.create',
  'mission.list',
  'mission.show',
  'mission.update',
  'mission.resolve-decision',
  'mission.attach-run',
  'mission.close',
  'worktree.discard',
  'worktree.cleanup',
  'lane.status',
  'lane.recordMerge',
  'lane.recordSupersession',
  'refine.show',
  'refine.rollback',
  'inspector.open',
  'inspector.command',
  'inspector.status',
  'inspector.close',
  'project.status',
  'project.close',
  'status',
  'debug.run',
  'grant-spawn-budget',
  'interrupt',
  'steer',
  'stop',
  'command.status',
  'command.yield',
  'command.cancel',
  'dismiss',
  'doctor',
  'watchdog.status',
  'watchdog.check',
  'watchdog.configure',
  'watchdog.recommend-model',
  'schedule.list',
  'schedule.show',
  'schedule.history',
  'schedule.pause',
  'schedule.delete',
]);

// Actions that reuse a stored run, start a workflow, or open a peer session without naming a model
// in the call, so the approved role models cannot be enforced from the input.
const MODEL_LAUNCH_ACTIONS = new Set([
  'refine',
  'resume',
  'project.open',
  'schedule.create',
  'schedule.resume',
  'schedule.run',
  'schedule.run-due',
]);

function actionBlockReason(action: string, assignment: RoleAssignment | undefined): string {
  if (!MODEL_LAUNCH_ACTIONS.has(action)) {
    return `Model collaboration: subagent action "${action}" is not a known read-only or control action and may start work on an unapproved model; refusing it.`;
  }
  if (!assignment) {
    return `Model collaboration: subagent action "${action}" requires a confirmed session assignment; confirm the proposed role models with an interactive prompt first.`;
  }
  return `Model collaboration: subagent action "${action}" can start child or peer-session work without naming its model, so it cannot be checked against the approved worker (${assignment.worker}) or reviewer (${assignment.reviewer}) model; call subagent with agent "worker" or "reviewer" and the approved model instead.`;
}

function parseModelId(value: string): { provider: string; modelId: string } | undefined {
  const slash = value.indexOf('/');
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
}

function effectiveConfigPath(): string {
  return process.env[CONFIG_ENV] ?? CONFIG_PATH;
}

function readConfigDocument(path: string): Record<string, unknown> | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('role configuration must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function roleConfigFromDocument(document: Record<string, unknown>): RoleConfig {
  const config: RoleConfig = {};
  for (const role of ROLES) {
    const value = document[role];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${role} must be a non-empty provider/model string`);
    }
    config[role] = value.trim();
  }
  return config;
}

function loadRoleConfig(): RoleConfig {
  const document = readConfigDocument(effectiveConfigPath());
  return document ? roleConfigFromDocument(document) : {};
}

interface ConfigFileSnapshot {
  path: string;
  document: Record<string, unknown> | undefined;
  roles: RoleConfig;
}

// A global save is prepared after its dialogs but written only after the planner switch, so the
// prepared form carries the path and role baseline needed to detect concurrent edits.
interface PreparedGlobalSave {
  path: string;
  baselineRoles: RoleConfig;
  next: RoleAssignment;
}

function readConfigFileSnapshot(): ConfigFileSnapshot {
  const path = effectiveConfigPath();
  const document = readConfigDocument(path);
  return { path, document, roles: document ? roleConfigFromDocument(document) : {} };
}

function sameRoleModels(left: RoleConfig, right: RoleConfig): boolean {
  return ROLES.every((role) => left[role] === right[role]);
}

function writeConfigFile(path: string, document: Record<string, unknown>): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let mode = 0o600;
  try {
    const stats = lstatSync(path);
    // rename() replaces a symlink entry instead of writing its target, so refuse rather than
    // silently detaching the user's configuration from its intended file.
    if (stats.isSymbolicLink()) {
      throw new Error('role configuration path is a symbolic link; refusing to replace it');
    }
    if (!stats.isFile()) {
      throw new Error('role configuration path is not a regular file');
    }
    mode = stats.mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    // A same-directory temporary file makes the replacement atomic; the exclusive create flag
    // means a planted link at that name is never followed.
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx', mode });
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file may not exist when creating or writing it failed.
    }
    throw error;
  }
}

function matchesApprovedModel(requested: string, approved: string): boolean {
  if (requested === approved) return true;
  const prefix = `${approved}:`;
  return requested.startsWith(prefix) && THINKING_LEVELS.has(requested.slice(prefix.length));
}

function isRoleAssignment(value: unknown): value is RoleAssignment {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return ROLES.every((role) => typeof candidate[role] === 'string' && candidate[role].trim() !== '');
}

function isDisabledState(value: unknown): boolean {
  return value !== null && typeof value === 'object' && (value as Record<string, unknown>).disabled === true;
}

function isRole(value: string | undefined): value is Role {
  return value !== undefined && (ROLES as readonly string[]).includes(value);
}

function describeRoles(assignment: RoleAssignment): string {
  return [
    'Role/model assignment for this new session:',
    `Planner (this conversation): ${assignment.planner}`,
    `Worker (implementation, one writer at a time): ${assignment.worker}`,
    `Reviewer (fresh security/code review of changes): ${assignment.reviewer}`,
    '',
    'Worker and reviewer are used only when the request needs those roles. Approve this assignment?',
  ].join('\n');
}

function routingInstruction(assignment: RoleAssignment): string {
  return [
    'Model collaboration is approved for this session. This assignment supersedes earlier collaboration routing in this session.',
    `Plan and discuss the request in this conversation; the approved planner model for this session is ${assignment.planner}.`,
    `When the request needs implementation, call the \`subagent\` tool with agent "worker" and model "${assignment.worker}"; keep one writer at a time.`,
    `When completed changes need code or security review, call the \`subagent\` tool with agent "reviewer" and model "${assignment.reviewer}"; reviewers are review-only.`,
    'Do not substitute another model for a role. Do not re-confirm this assignment unless the user explicitly changes it with /collaboration.',
    'This is a cooperation policy, not a security sandbox.',
  ].join('\n');
}

function revocationInstruction(): string {
  return [
    'Model collaboration is disabled for this session.',
    'The earlier collaboration routing directives in this conversation are superseded: no role/model assignment is active, so their planner, worker, and reviewer routing no longer applies.',
    'Handle requests with the current conversation, the standard system prompt, and the tools available now; do not treat any earlier collaboration directive as active policy.',
  ].join('\n');
}

function availableModel(ctx: ExtensionContext, modelId: string) {
  const parsed = parseModelId(modelId);
  if (!parsed) return undefined;
  const model = ctx.modelRegistry.find(parsed.provider, parsed.modelId);
  if (!model) return undefined;
  return ctx.modelRegistry.getAvailable()
    .some((candidate) => candidate.provider === model.provider && candidate.id === model.id)
    ? model
    : undefined;
}

async function ensurePlannerModel(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  modelId: string,
): Promise<boolean> {
  const model = availableModel(ctx, modelId);
  if (!model) {
    ctx.ui.notify(
      `Model collaboration: unavailable planner model (${modelId}). No model was substituted; task cancelled.`,
      'error',
    );
    return false;
  }
  if (ctx.model?.provider === model.provider && ctx.model?.id === model.id) return true;
  let switched = false;
  try {
    switched = await pi.setModel(model);
  } catch {
    switched = false;
  }
  if (!switched) {
    ctx.ui.notify(
      `Model collaboration: could not switch to planner model ${modelId}; task cancelled.`,
      'error',
    );
  }
  return switched;
}

function roleLines(assignment: RoleAssignment): string {
  return ROLES.map((role) => `${role}: ${assignment[role]}`).join('\n');
}

function sameAssignment(left: RoleAssignment, right: RoleAssignment): boolean {
  return ROLES.every((role) => left[role] === right[role]);
}

function modelChoices(ctx: ExtensionContext): Choice[] {
  return [...new Set(ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`))]
    .sort()
    .map((id) => ({ value: id, label: id }));
}

function roleChoices(assignment: RoleAssignment): Choice[] {
  return ROLES.map((role) => ({ value: role, label: `${role} — ${assignment[role]}` }));
}

function choiceLabel(choice: Choice): string {
  return choice.description ? `${choice.label} — ${choice.description}` : choice.label;
}

async function selectFallback(
  ctx: ExtensionContext,
  title: string,
  choices: readonly Choice[],
): Promise<string | undefined> {
  const labels = choices.map(choiceLabel);
  const selected = await ctx.ui.select(title, labels);
  if (selected === undefined) return undefined;
  const index = labels.indexOf(selected);
  return index === -1 ? undefined : choices[index].value;
}

// TUI list dialogs are not searchable, so the TUI path composes Pi's Input and SelectList. RPC and
// other dialog-capable clients keep the portable select fallback.
async function pickWithSearch(
  ctx: ExtensionContext,
  title: string,
  choices: readonly Choice[],
): Promise<string | undefined> {
  let tui: typeof import('@earendil-works/pi-tui');
  try {
    tui = await import('@earendil-works/pi-tui');
  } catch {
    return selectFallback(ctx, title, choices);
  }
  return ctx.ui.custom<string | undefined>((renderer, theme, keybindings, done) => {
    const container = new tui.Container();
    container.addChild(new tui.Text(theme.fg('accent', theme.bold(title)), 1, 0));
    container.addChild(new tui.Spacer(1));
    const search = new tui.Input({ prompt: 'Filter: ', placeholder: 'type a provider, model, or role' });
    container.addChild(search);
    container.addChild(new tui.Spacer(1));
    const listContainer = new tui.Container();
    container.addChild(listContainer);
    container.addChild(new tui.Spacer(1));
    container.addChild(new tui.Text(theme.fg('dim', '↑↓ move • enter select • esc cancel'), 1, 0));

    const buildList = (): import('@earendil-works/pi-tui').SelectList => {
      const filtered = filterChoices(choices, search.getValue());
      listContainer.clear();
      const next = new tui.SelectList(
        filtered.map((choice) => ({ value: choice.value, label: choice.label, description: choice.description })),
        Math.max(1, Math.min(filtered.length, 12)),
        {
          selectedPrefix: (text) => theme.fg('accent', text),
          selectedText: (text) => theme.fg('accent', text),
          description: (text) => theme.fg('muted', text),
          scrollInfo: (text) => theme.fg('dim', text),
          noMatch: (text) => theme.fg('warning', text),
        },
      );
      next.onSelect = (item) => done(item.value);
      next.onCancel = () => done(undefined);
      if (filtered.length === 0) {
        listContainer.addChild(new tui.Text(theme.fg('warning', '  No matching models or roles'), 0, 0));
      } else {
        listContainer.addChild(next);
      }
      return next;
    };
    let list = buildList();
    const rebuild = (): void => {
      list = buildList();
      renderer.requestRender();
    };

    return {
      get focused(): boolean {
        return search.focused;
      },
      set focused(value: boolean) {
        search.focused = value;
      },
      render(width: number) {
        return container.render(width);
      },
      invalidate() {
        container.invalidate();
        search.invalidate();
        list.invalidate();
      },
      handleInput(data: string) {
        const selectKeys = ['tui.select.up', 'tui.select.down', 'tui.select.confirm', 'tui.select.cancel'];
        if (selectKeys.some((key) => keybindings.matches(data, key))) {
          list.handleInput(data);
          renderer.requestRender();
          return;
        }
        const before = search.getValue();
        search.handleInput(data);
        // Rebuilding resets SelectList's highlighted row, so only do it when the filter changed.
        if (search.getValue() === before) renderer.requestRender();
        else rebuild();
      },
    };
  });
}

async function selectChoice(
  ctx: ExtensionContext,
  title: string,
  choices: readonly Choice[],
): Promise<string | undefined> {
  if (choices.length === 0) return undefined;
  if (ctx.mode !== 'tui' || typeof ctx.ui.custom !== 'function') {
    return selectFallback(ctx, title, choices);
  }
  return pickWithSearch(ctx, title, choices);
}

export default function modelCollaboration(pi: ExtensionAPI): void {
  let assignment: RoleAssignment | undefined;
  let lastAssignment: RoleAssignment | undefined;
  let plannerApplied = false;
  let assignmentVersion = 0;
  let disabled = false;

  // Persist the revocation in model context without starting a model call.
  const sendRevocation = (): void => {
    pi.sendMessage(
      { customType: REVOCATION_TYPE, content: revocationInstruction(), display: false },
      { triggerTurn: false },
    );
  };

  const disableForSession = (ctx: ExtensionContext): void => {
    pi.appendEntry(STATE_TYPE, DISABLED_STATE);
    lastAssignment = assignment ?? lastAssignment;
    disabled = true;
    assignment = undefined;
    plannerApplied = false;
    assignmentVersion++;
    sendRevocation();
    ctx.ui.notify('Model collaboration disabled for this session.', 'info');
  };

  const hasRevocationInContext = (ctx: ExtensionContext): boolean => {
    const branch = ctx.sessionManager.getBranch();
    let barrier = -1;
    branch.forEach((entry, index) => {
      if (entry.type === 'compaction' || (entry.type === 'custom' && entry.customType === STATE_TYPE)) {
        barrier = index;
      }
    });
    return branch
      .slice(barrier + 1)
      .some((entry) => entry.type === 'custom_message' && entry.customType === REVOCATION_TYPE);
  };

  const restoreState = (ctx: ExtensionContext): void => {
    assignmentVersion++;
    assignment = undefined;
    lastAssignment = undefined;
    plannerApplied = false;
    disabled = false;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== 'custom' || entry.customType !== STATE_TYPE) continue;
      if (isRoleAssignment(entry.data)) {
        assignment = entry.data;
        lastAssignment = entry.data;
        disabled = false;
      } else if (isDisabledState(entry.data)) {
        assignment = undefined;
        disabled = true;
      } else {
        assignment = undefined;
        lastAssignment = undefined;
        disabled = false;
      }
    }
    // A branch can retain the disabled state after its revocation was compacted or never delivered.
    if (disabled && !hasRevocationInContext(ctx)) sendRevocation();
  };

  pi.on('session_start', (_event, ctx) => restoreState(ctx));
  pi.on('session_tree', (_event, ctx) => restoreState(ctx));
  pi.on('session_compact', () => {
    if (disabled) sendRevocation();
  });

  const stillCurrent = (ctx: ExtensionContext, version: number): boolean => {
    if (version === assignmentVersion && ctx.isIdle()) return true;
    ctx.ui.notify('Model collaboration: the session or active run changed; change cancelled.', 'warning');
    return false;
  };

  const versionCurrent = (ctx: ExtensionContext, version: number): boolean => {
    if (version === assignmentVersion) return true;
    ctx.ui.notify('Model collaboration: the session changed; change cancelled.', 'warning');
    return false;
  };

  // Invalidate dialogs and confirmations started before an explicit off without changing the
  // persisted disabled state or sending a second revocation.
  const cancelPendingChange = (): void => {
    assignmentVersion++;
  };

  // Pi setModel applies the new model before returning, so a change cancelled during that await
  // must undo its own switch. A newer model choice is never overwritten.
  const restoreCancelledPlannerSwitch = async (
    ctx: ExtensionContext,
    previous: { provider: string; id: string } | undefined,
    target: { provider: string; modelId: string },
  ): Promise<void> => {
    const current = ctx.model;
    if (current?.provider !== target.provider || current.id !== target.modelId) return;
    // Reused after a committed switch too, so there may be nothing to restore.
    if (previous?.provider === target.provider && previous.id === target.modelId) return;
    if (!previous) {
      ctx.ui.notify(
        `Model collaboration: change cancelled, but the parent model remains ${target.provider}/${target.modelId} because no previous model can be restored.`,
        'error',
      );
      return;
    }
    const previousModel = availableModel(ctx, `${previous.provider}/${previous.id}`);
    if (!previousModel) {
      ctx.ui.notify(
        `Model collaboration: change cancelled, but the parent model remains ${target.provider}/${target.modelId} because the previous model ${previous.provider}/${previous.id} is unavailable.`,
        'error',
      );
      return;
    }
    let restored = false;
    try {
      restored = await pi.setModel(previousModel);
    } catch {
      restored = false;
    }
    if (!restored) {
      ctx.ui.notify(
        `Model collaboration: change cancelled, but restoring the previous parent model ${previous.provider}/${previous.id} failed; the parent model remains ${target.provider}/${target.modelId}.`,
        'error',
      );
    }
  };

  const switchPlannerForChange = async (
    ctx: ExtensionContext,
    version: number,
    modelId: string,
  ): Promise<boolean> => {
    const target = parseModelId(modelId);
    const previous = ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined;
    const switching = !previous || !target
      || previous.provider !== target.provider
      || previous.id !== target.modelId;
    if (!(await ensurePlannerModel(pi, ctx, modelId))) return false;
    if (stillCurrent(ctx, version)) return true;
    if (switching && target) await restoreCancelledPlannerSwitch(ctx, previous, target);
    return false;
  };

  const commitAssignment = (next: RoleAssignment, plannerSwitched: boolean): void => {
    pi.appendEntry(STATE_TYPE, next);
    assignment = next;
    lastAssignment = next;
    disabled = false;
    assignmentVersion++;
    if (plannerSwitched) plannerApplied = true;
  };

  const chooseSaveScope = async (
    ctx: ExtensionContext,
    title: string,
  ): Promise<'session' | 'global' | undefined> => {
    const selected = await ctx.ui.select(title, [SESSION_SCOPE, GLOBAL_SCOPE]);
    if (selected === SESSION_SCOPE) return 'session';
    if (selected === GLOBAL_SCOPE) return 'global';
    return undefined;
  };

  // Role models can disappear while dialogs or a model switch are open; report every role whose
  // model is no longer available and return true when the change must be refused.
  const refuseUnavailableRoles = (ctx: ExtensionContext, next: RoleAssignment): boolean => {
    const unavailable = ROLES
      .filter((role) => !availableModel(ctx, next[role]))
      .map((role) => `${role}=${next[role]}`);
    if (unavailable.length === 0) return false;
    ctx.ui.notify(
      `Model collaboration: unavailable role model (${unavailable.join(', ')}); role assignment unchanged.`,
      'error',
    );
    return true;
  };

  // Runs every dialog and validation but writes nothing: the caller may still switch the planner
  // model, and only commitGlobalSave persists the defaults.
  const prepareGlobalSave = async (
    ctx: ExtensionContext,
    next: RoleAssignment,
    version: number,
    pendingSessionChange: boolean,
  ): Promise<PreparedGlobalSave | undefined> => {
    let baseline: ConfigFileSnapshot;
    try {
      baseline = readConfigFileSnapshot();
    } catch {
      ctx.ui.notify(
        `Model collaboration: global role configuration ${effectiveConfigPath()} is unreadable or invalid; global defaults were not changed and no session role change was applied.`,
        'error',
      );
      return undefined;
    }
    const effect = pendingSessionChange
      ? 'Effect: new sessions use these defaults. The session role change is applied only if this save succeeds; other active sessions are unchanged. Collaboration is not enabled globally.'
      : 'Effect: new sessions use these defaults. This session keeps its current assignment; other active sessions are unchanged. Collaboration is not enabled globally.';
    const approved = await ctx.ui.confirm(
      'Save global model collaboration defaults',
      [
        'Save these role models as global defaults?',
        roleLines(next),
        '',
        `File: ${baseline.path}`,
        effect,
      ].join('\n'),
    );
    if (!approved || !stillCurrent(ctx, version)) return undefined;

    let latest: ConfigFileSnapshot;
    try {
      latest = readConfigFileSnapshot();
    } catch {
      ctx.ui.notify(
        `Model collaboration: global role configuration ${effectiveConfigPath()} became unreadable or invalid; global defaults were not changed and no session role change was applied.`,
        'error',
      );
      return undefined;
    }
    if (latest.path !== baseline.path) {
      ctx.ui.notify(
        'Model collaboration: the global role configuration path changed while the confirmation was open; nothing was saved and no session role change was applied.',
        'warning',
      );
      return undefined;
    }
    // Another process may have edited the file while the confirmation was open. Merge unrelated
    // keys from the latest file, but do not overwrite role edits the user did not see.
    if (!sameRoleModels(baseline.roles, latest.roles)) {
      ctx.ui.notify(
        'Model collaboration: global role defaults changed while the confirmation was open; nothing was saved and no session role change was applied.',
        'warning',
      );
      return undefined;
    }
    if (refuseUnavailableRoles(ctx, next)) return undefined;
    if (!stillCurrent(ctx, version)) return undefined;
    return { path: latest.path, baselineRoles: latest.roles, next };
  };

  // Synchronous from the fresh read to the atomic write, so no dialog, model switch, or other
  // await can interleave between the last validation and the persisted change.
  const commitGlobalSave = (
    ctx: ExtensionContext,
    prepared: PreparedGlobalSave,
    version: number,
  ): boolean => {
    let latest: ConfigFileSnapshot;
    try {
      latest = readConfigFileSnapshot();
    } catch {
      ctx.ui.notify(
        `Model collaboration: global role configuration ${prepared.path} became unreadable or invalid; global defaults were not changed and no session role change was applied.`,
        'error',
      );
      return false;
    }
    if (latest.path !== prepared.path) {
      ctx.ui.notify(
        'Model collaboration: the global role configuration path changed while the change was pending; nothing was saved and no session role change was applied.',
        'warning',
      );
      return false;
    }
    if (!sameRoleModels(latest.roles, prepared.baselineRoles)) {
      ctx.ui.notify(
        'Model collaboration: global role defaults changed while the change was pending; nothing was saved and no session role change was applied.',
        'warning',
      );
      return false;
    }
    if (refuseUnavailableRoles(ctx, prepared.next)) return false;
    if (!stillCurrent(ctx, version)) return false;

    const document: Record<string, unknown> = latest.document ?? {};
    for (const role of ROLES) document[role] = prepared.next[role];
    try {
      writeConfigFile(latest.path, document);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Model collaboration: could not save global defaults to ${latest.path}: ${reason}. Global defaults are unchanged and no session role change was applied.`,
        'error',
      );
      return false;
    }
    ctx.ui.notify(
      `Model collaboration: saved global defaults to ${latest.path} for new sessions. Other active sessions are unchanged; collaboration is not enabled globally.`,
      'info',
    );
    return true;
  };

  const proposedAssignment = (ctx: ExtensionContext): RoleAssignment | undefined => {
    if (assignment) return assignment;
    if (lastAssignment) return lastAssignment;
    let config: RoleConfig;
    try {
      config = loadRoleConfig();
    } catch {
      ctx.ui.notify('Model collaboration: role configuration is unreadable or invalid; task cancelled.', 'error');
      return undefined;
    }
    const planner = config.planner ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined);
    if (!planner) {
      ctx.ui.notify('Model collaboration: no planner model is selected or configured; task cancelled.', 'error');
      return undefined;
    }
    return {
      planner,
      worker: config.worker ?? DEFAULT_WORKER_MODEL,
      reviewer: config.reviewer ?? DEFAULT_REVIEWER_MODEL,
    };
  };

  const changeRole = async (ctx: ExtensionContext, role: Role): Promise<void> => {
    const current = assignment;
    if (!current) return;
    const version = assignmentVersion;
    const models = modelChoices(ctx);
    if (models.length === 0) {
      ctx.ui.notify('Model collaboration: no available models; role assignment unchanged.', 'error');
      return;
    }
    const selected = await selectChoice(ctx, `Choose ${role} model (current: ${current[role]})`, models);
    if (selected === undefined || selected === current[role]) return;
    if (!stillCurrent(ctx, version)) return;
    if (!availableModel(ctx, selected)) {
      ctx.ui.notify(`Model collaboration: unavailable ${role} model (${selected}); role assignment unchanged.`, 'error');
      return;
    }
    const scope = role === 'planner'
      ? 'The parent model switches after this change.'
      : 'Applies to future tasks in this session; running tasks and the planner are unchanged.';
    const approved = await ctx.ui.confirm(
      'Confirm model collaboration change',
      `${role}: ${current[role]} → ${selected}\n\n${scope}\n\nNext, choose whether to keep the change only in this session or also save the roles as global defaults.`,
    );
    if (!approved || !stillCurrent(ctx, version)) return;
    if (!availableModel(ctx, selected)) {
      ctx.ui.notify(`Model collaboration: unavailable ${role} model (${selected}); role assignment unchanged.`, 'error');
      return;
    }
    const updated = { ...current, [role]: selected };
    const saveScope = await chooseSaveScope(ctx, `Save the ${role} change`);
    if (saveScope === undefined || !stillCurrent(ctx, version)) return;
    const prepared = saveScope === 'global'
      ? await prepareGlobalSave(ctx, updated, version, true)
      : undefined;
    if (saveScope === 'global' && !prepared) return;
    const previous = role === 'planner' && ctx.model
      ? { provider: ctx.model.provider, id: ctx.model.id }
      : undefined;
    if (role === 'planner') {
      if (!(await switchPlannerForChange(ctx, version, selected))) return;
    } else if (!availableModel(ctx, selected)) {
      // The scope dialog can stay open long enough for the selected model to disappear.
      ctx.ui.notify(`Model collaboration: unavailable ${role} model (${selected}); role assignment unchanged.`, 'error');
      return;
    }
    if (prepared && !commitGlobalSave(ctx, prepared, version)) {
      if (role === 'planner') {
        const target = parseModelId(selected);
        if (target) await restoreCancelledPlannerSwitch(ctx, previous, target);
      }
      return;
    }
    commitAssignment(updated, role === 'planner');
    ctx.ui.notify(`Model collaboration: ${role} is now ${selected} for future tasks in this session.`, 'info');
  };

  const enableCollaboration = async (ctx: ExtensionContext): Promise<void> => {
    const version = assignmentVersion;
    const proposed = proposedAssignment(ctx);
    if (!proposed) return;
    const mode = await selectChoice(
      ctx,
      `Model collaboration roles for this session:\n${roleLines(proposed)}\n\nEnable collaboration with these roles, or modify them first?`,
      [
        { value: 'keep', label: 'Keep this assignment' },
        { value: 'modify', label: 'Modify roles' },
      ],
    );
    if (mode === undefined) return;
    if (!stillCurrent(ctx, version)) return;

    if (mode === 'keep') {
      if (!disabled && assignment) {
        ctx.ui.notify('Model collaboration is already enabled for this session.', 'info');
        return;
      }
      if (refuseUnavailableRoles(ctx, proposed)) return;
      const previous = ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined;
      const target = parseModelId(proposed.planner);
      if (!(await switchPlannerForChange(ctx, version, proposed.planner))) return;
      if (refuseUnavailableRoles(ctx, proposed)) {
        if (target) await restoreCancelledPlannerSwitch(ctx, previous, target);
        return;
      }
      commitAssignment(proposed, true);
      ctx.ui.notify('Model collaboration enabled for this session.', 'info');
      return;
    }
    if (mode !== 'modify') return;

    let working = { ...proposed };
    while (true) {
      if (!stillCurrent(ctx, version)) return;
      const roleChoice = await selectChoice(
        ctx,
        `Current model collaboration:\n${roleLines(working)}\n\nChoose a role to change, or finish enabling`,
        [
          ...roleChoices(working),
          { value: 'done', label: 'Done — enable with these role models' },
        ],
      );
      if (roleChoice === undefined) return;
      if (!stillCurrent(ctx, version)) return;
      if (roleChoice === 'done') break;
      if (!isRole(roleChoice)) return;
      const models = modelChoices(ctx);
      if (models.length === 0) {
        ctx.ui.notify('Model collaboration: no available models; role assignment unchanged.', 'error');
        return;
      }
      const selected = await selectChoice(ctx, `Choose ${roleChoice} model (current: ${working[roleChoice]})`, models);
      if (selected === undefined) return;
      if (!stillCurrent(ctx, version)) return;
      if (selected === working[roleChoice]) continue;
      if (!availableModel(ctx, selected)) {
        ctx.ui.notify(`Model collaboration: unavailable ${roleChoice} model (${selected}); role assignment unchanged.`, 'error');
        return;
      }
      working = { ...working, [roleChoice]: selected };
    }

    if (!disabled && assignment && sameAssignment(assignment, working)) {
      ctx.ui.notify('Model collaboration: no role changes; the session assignment is unchanged.', 'info');
      return;
    }
    if (refuseUnavailableRoles(ctx, working)) return;
    if (!stillCurrent(ctx, version)) return;
    const approved = await ctx.ui.confirm(
      'Confirm model collaboration',
      `Enable model collaboration with:\n${roleLines(working)}\n\nThe planner becomes the parent model for future runs.\n\nNext, choose whether to keep the change only in this session or also save the roles as global defaults.`,
    );
    if (!approved || !stillCurrent(ctx, version)) return;
    if (refuseUnavailableRoles(ctx, working)) return;
    const saveScope = await chooseSaveScope(ctx, 'Save the changed role assignment');
    if (saveScope === undefined || !stillCurrent(ctx, version)) return;
    const prepared = saveScope === 'global'
      ? await prepareGlobalSave(ctx, working, version, true)
      : undefined;
    if (saveScope === 'global' && !prepared) return;
    // Only this session still commits every role, so it has to survive both the scope dialog and
    // the planner switch before the assignment is recorded.
    if (!prepared && refuseUnavailableRoles(ctx, working)) return;
    const previous = ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined;
    const target = parseModelId(working.planner);
    if (!(await switchPlannerForChange(ctx, version, working.planner))) return;
    if (prepared) {
      if (!commitGlobalSave(ctx, prepared, version)) {
        if (target) await restoreCancelledPlannerSwitch(ctx, previous, target);
        return;
      }
    } else if (refuseUnavailableRoles(ctx, working)) {
      if (target) await restoreCancelledPlannerSwitch(ctx, previous, target);
      return;
    }
    commitAssignment(working, true);
    ctx.ui.notify('Model collaboration enabled for this session.', 'info');
  };

  const openMenu = async (ctx: ExtensionContext): Promise<void> => {
    if (!ctx.hasUI) {
      ctx.ui.notify('Model collaboration: changing role models requires interactive dialogs.', 'error');
      return;
    }
    const version = assignmentVersion;
    const status = disabled ? 'disabled' : assignment ? 'enabled' : 'not configured';
    const actions: Choice[] = [
      { value: 'enable', label: 'Enable collaboration' },
      { value: 'disable', label: 'Disable collaboration' },
    ];
    if (!disabled && assignment) {
      actions.push({ value: 'save-global', label: 'Save current assignment as global defaults' });
    }
    const action = await selectChoice(
      ctx,
      `Model collaboration is ${status} for this session.`,
      actions,
    );
    // The status above is snapshotted; a session change while this dialog was open cancels it.
    if (!versionCurrent(ctx, version)) return;
    if (action === 'save-global') {
      if (disabled || !assignment) {
        ctx.ui.notify('Model collaboration: no active session assignment to save as global defaults.', 'warning');
        return;
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify('Model collaboration: wait for the current response to finish before saving global defaults.', 'warning');
        return;
      }
      const prepared = await prepareGlobalSave(ctx, assignment, version, false);
      if (!prepared) return;
      commitGlobalSave(ctx, prepared, version);
      return;
    }
    if (action === 'disable') {
      if (disabled) {
        cancelPendingChange();
        ctx.ui.notify('Model collaboration is already disabled for this session.', 'info');
      } else {
        disableForSession(ctx);
      }
      return;
    }
    if (action !== 'enable') return;
    if (!ctx.isIdle()) {
      ctx.ui.notify('Model collaboration: wait for the current response to finish before enabling or changing role models.', 'warning');
      return;
    }
    await enableCollaboration(ctx);
  };

  pi.registerCommand('collaboration', {
    description: 'Enable/disable collaboration, change session models, or save global defaults',
    handler: async (args, ctx) => {
      const requested = args.trim();
      if (requested === 'off') {
        if (disabled) {
          cancelPendingChange();
          ctx.ui.notify('Model collaboration is already disabled for this session.', 'info');
        } else {
          disableForSession(ctx);
        }
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify('Model collaboration: changing role models requires interactive dialogs.', 'error');
        return;
      }
      if (requested !== '' && requested !== 'on' && !isRole(requested)) {
        ctx.ui.notify('Usage: /collaboration [on|off|planner|worker|reviewer]', 'error');
        return;
      }
      if (requested === '') {
        try {
          await openMenu(ctx);
        } catch {
          ctx.ui.notify('Model collaboration: change failed; role assignment unchanged.', 'error');
        }
        return;
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify('Model collaboration: wait for the current response to finish before changing role models.', 'warning');
        return;
      }
      if (requested === 'on') {
        try {
          await enableCollaboration(ctx);
        } catch {
          ctx.ui.notify('Model collaboration: change failed; role assignment unchanged.', 'error');
        }
        return;
      }
      if (!isRole(requested)) return;
      if (disabled) {
        ctx.ui.notify('Model collaboration is disabled for this session; run /collaboration to enable it.', 'info');
        return;
      }
      if (!assignment) {
        ctx.ui.notify('Model collaboration: send a prompt and confirm the initial role assignment, or run /collaboration to enable it first.', 'warning');
        return;
      }
      try {
        await changeRole(ctx, requested);
      } catch {
        ctx.ui.notify('Model collaboration: role model change failed; role assignment unchanged.', 'error');
      }
    },
  });

  pi.on('tool_call', (event, ctx) => {
    if (disabled) return;
    if (!ctx.hasUI || event.toolName !== 'subagent') return;
    const input = event.input as Record<string, unknown>;
    const action = typeof input.action === 'string' ? input.action.trim() : '';
    if (action !== '') {
      if (SAFE_SUBAGENT_ACTIONS.has(action)) return;
      return { block: true, reason: actionBlockReason(action, assignment) };
    }
    if (!assignment) {
      return {
        block: true,
        reason:
          'Model collaboration: subagent work requires a confirmed session assignment; confirm the proposed role models with an interactive prompt first.',
      };
    }
    if (input.workflow !== undefined || input.args !== undefined) {
      return {
        block: true,
        reason: `Model collaboration: workflow and args calls cannot be checked against the approved role models; call subagent with agent "worker" and model "${assignment.worker}", or agent "reviewer" and model "${assignment.reviewer}", instead.`,
      };
    }
    const agent = typeof input.agent === 'string' ? input.agent.trim().toLowerCase() : undefined;
    const role = agent ? ROLE_ALIASES[agent] : undefined;
    if (!role) return;
    const requested = input.model;
    if (requested === undefined) {
      input.model = assignment[role];
      return;
    }
    if (typeof requested === 'string' && matchesApprovedModel(requested, assignment[role])) return;
    return {
      block: true,
      reason: `Model collaboration: ${role} requested ${String(requested)}; the approved model is ${assignment[role]}.`,
    };
  });

  pi.on('before_agent_start', (event, ctx) => {
    if (disabled || !assignment || !ctx.hasUI || event.messageType !== 'user') return;
    return {
      message: {
        customType: ROUTING_TYPE,
        content: routingInstruction(assignment),
        display: false,
      },
    };
  });

  pi.on('input', async (event, ctx: ExtensionContext) => {
    if (event.source === 'extension') return;
    if (event.streamingBehavior !== undefined) return;
    if (disabled) return;
    if (!ctx.hasUI || !ctx.isIdle()) return;

    if (assignment) {
      if (!plannerApplied) {
        if (!(await ensurePlannerModel(pi, ctx, assignment.planner))) {
          return { action: 'handled' as const };
        }
        plannerApplied = true;
      }
      return;
    }

    let config: RoleConfig;
    try {
      config = loadRoleConfig();
    } catch {
      ctx.ui.notify('Model collaboration: role configuration is unreadable or invalid; task cancelled.', 'error');
      return { action: 'handled' as const };
    }

    const planner = config.planner ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined);
    if (!planner) {
      ctx.ui.notify('Model collaboration: no planner model is selected or configured; task cancelled.', 'error');
      return { action: 'handled' as const };
    }
    const proposed: RoleAssignment = {
      planner,
      worker: config.worker ?? DEFAULT_WORKER_MODEL,
      reviewer: config.reviewer ?? DEFAULT_REVIEWER_MODEL,
    };

    const unavailable = ROLES.filter((role) => !availableModel(ctx, proposed[role]));
    if (unavailable.length > 0) {
      const roles = unavailable.map((role) => `${role}=${proposed[role]}`).join(', ');
      ctx.ui.notify(
        `Model collaboration: unavailable role model (${roles}). No model was substituted; task cancelled.`,
        'error',
      );
      return { action: 'handled' as const };
    }

    const version = assignmentVersion;
    let approved: boolean;
    try {
      approved = await ctx.ui.confirm('Confirm model collaboration', describeRoles(proposed));
    } catch {
      ctx.ui.notify('Model collaboration: confirmation is unavailable; task cancelled.', 'error');
      return { action: 'handled' as const };
    }
    if (disabled) return;
    if (version !== assignmentVersion) return { action: 'handled' as const };
    if (!approved) {
      // Refusing collaboration should not discard the original request.
      disableForSession(ctx);
      return;
    }
    if (!(await ensurePlannerModel(pi, ctx, proposed.planner))) {
      return { action: 'handled' as const };
    }
    if (disabled) return;
    if (version !== assignmentVersion) return { action: 'handled' as const };
    assignment = proposed;
    assignmentVersion++;
    plannerApplied = true;
    pi.appendEntry(STATE_TYPE, assignment);
  });
}
