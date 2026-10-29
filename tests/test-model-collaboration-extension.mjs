import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import modelCollaboration, { filterChoices } from '../extensions/model-collaboration.ts';

const ROLE_CONFIG = {
  planner: 'openai-codex/gpt-6-sol',
  worker: 'deepseek/deepseek-flash',
  reviewer: 'deepseek/deepseek-flash',
};

const CURRENT_MODEL = { provider: 'openai-codex', id: 'gpt-6-luna' };
const PLANNER_MODEL = { provider: 'openai-codex', id: 'gpt-6-sol' };
const WORKER_MODEL = { provider: 'deepseek', id: 'deepseek-flash' };
const DEEPSEEK_CHAT = { provider: 'deepseek', id: 'deepseek-chat' };
const DEEPSEEK_REASONER = { provider: 'deepseek', id: 'deepseek-reasoner' };

const TUI_KEYS = { down: '\x1b[B', left: '\x1b[D', right: '\x1b[C', backspace: '\x7f', enter: '\r', escape: '\x1b' };

function findExecutable(name) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (directory === '') continue;
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function installRootForExecutable(executable) {
  if (!executable) return undefined;
  try {
    return join(dirname(dirname(realpathSync(executable))), 'install');
  } catch {
    return undefined;
  }
}

// The TUI picker is a real Input + SelectList composition, so these tests drive the installed Pi
// components instead of a stand-in. The install root comes from the `pi` executable on PATH (or
// PI_MANAGED_INSTALL_ROOT); the tests skip when no installed Pi runtime is available.
let tuiEnvironmentPromise;
function loadTuiEnvironment() {
  tuiEnvironmentPromise ??= (async () => {
    try {
      const installRoot = process.env.PI_MANAGED_INSTALL_ROOT ?? installRootForExecutable(findExecutable('pi'));
      if (!installRoot) return undefined;
      const version = readFileSync(join(installRoot, 'current-version'), 'utf8').trim();
      const modules = join(installRoot, 'releases', version, 'node_modules');
      const tuiEntry = join(modules, '@earendil-works/pi-tui', 'dist', 'index.js');
      const jitiEntry = join(modules, 'jiti', 'lib', 'jiti.mjs');
      const keybindingsEntry = join(modules, '@earendil-works/pi-coding-agent', 'dist', 'core', 'keybindings.js');
      if (![tuiEntry, jitiEntry, keybindingsEntry].every((path) => existsSync(path))) return undefined;
      const tui = await import(pathToFileURL(tuiEntry).href);
      const { createJiti } = await import(pathToFileURL(jitiEntry).href);
      const jiti = createJiti(import.meta.url, { alias: { '@earendil-works/pi-tui': tuiEntry } });
      const extension = await jiti.import(fileURLToPath(new URL('../extensions/model-collaboration.ts', import.meta.url)));
      if (typeof extension.default !== 'function') return undefined;
      const { KeybindingsManager } = await import(pathToFileURL(keybindingsEntry).href);
      return { tui, modelCollaboration: extension.default, keybindings: new KeybindingsManager() };
    } catch {
      return undefined;
    }
  })();
  return tuiEnvironmentPromise;
}

async function tuiEnvironmentOrSkip(t) {
  const environment = await loadTuiEnvironment();
  if (!environment) {
    t.skip('installed Pi runtime is not available');
    return undefined;
  }
  return environment;
}

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function configFile(config) {
  const dir = mkdtempSync(join(tmpdir(), 'model-collaboration-test-'));
  tempDirs.push(dir);
  const path = join(dir, 'roles.json');
  writeFileSync(path, typeof config === 'string' ? config : JSON.stringify(config));
  return path;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function setup({
  config = ROLE_CONFIG,
  configPath = configFile(config),
  currentModel = CURRENT_MODEL,
  available = [CURRENT_MODEL, PLANNER_MODEL, WORKER_MODEL],
  hasUI = true,
  mode = 'tui',
  branch = [],
  extraModels = [],
  confirmAnswer = true,
  confirmAnswers,
  selectAnswers = [],
  idle = true,
  setModelResult = true,
  setModelOutcomes,
  setModelGate,
  extension = modelCollaboration,
  custom = false,
  customScripts,
  customKeybindings,
} = {}) {
  if (custom) assert.ok(customKeybindings, 'custom dialogs need the real keybindings manager');
  assert.ok(configPath.includes(tmpdir()), 'tests must use an isolated role configuration path');
  process.env.PI_MODEL_COLLABORATION_CONFIG = configPath;
  const handlers = new Map();
  const commands = new Map();
  const calls = { appendEntry: [], setModel: [], notify: [], sendMessage: [], events: [] };
  const dialogs = [];
  const selections = [];
  const answers = [...selectAnswers];
  const confirmations = confirmAnswers ? [...confirmAnswers] : undefined;
  let ctx;
  const pi = {
    on(event, handler) { handlers.set(event, handler); },
    registerCommand(name, command) { commands.set(name, command); },
    appendEntry(customType, data) {
      calls.appendEntry.push({ customType, data });
      calls.events.push({ type: 'appendEntry' });
    },
    sendMessage(message, options) { calls.sendMessage.push({ message, options }); },
    async setModel(model) {
      calls.setModel.push(model);
      calls.events.push({ type: 'setModel' });
      const outcome = setModelOutcomes?.shift() ?? setModelResult;
      if (outcome === 'throw') throw new Error('model switch failed');
      if (outcome === true) ctx.model = model;
      // Real Pi applies the model before awaiting its model_select handlers.
      if (setModelGate) await setModelGate;
      return outcome;
    },
  };
  const catalog = [CURRENT_MODEL, PLANNER_MODEL, WORKER_MODEL, ...extraModels];
  const customs = [];
  extension(pi);
  const ui = {
    async select(title, options) {
      selections.push({ title, options });
      const answer = answers.shift();
      return typeof answer === 'function' ? answer(options) : answer;
    },
    async confirm(title, message) {
      dialogs.push({ title, message });
      calls.events.push({ type: 'confirm' });
      const answer = confirmations ? confirmations.shift() : confirmAnswer;
      if (confirmations && answer === undefined) assert.fail(`unexpected confirmation: ${title}`);
      return typeof answer === 'function' ? answer(title, message) : answer;
    },
    notify(message) { calls.notify.push(message); },
  };
  if (custom) {
    ui.custom = (factory) => new Promise((resolve) => {
      const entry = { renders: 0 };
      const component = factory(
        { requestRender() { entry.renders += 1; } },
        { fg: (_token, text) => text, bold: (text) => text },
        customKeybindings,
        (value) => resolve(value),
      );
      entry.component = component;
      customs.push(entry);
      queueMicrotask(() => {
        const script = customScripts?.shift();
        if (script) script(component, entry);
        else if (customScripts !== undefined) assert.fail('unexpected TUI dialog without scripted input');
      });
    });
  }
  ctx = {
    ui,
    hasUI,
    mode,
    model: currentModel,
    isIdle: () => idle,
    sessionManager: { getBranch: () => branch },
    modelRegistry: {
      find(provider, id) {
        return catalog.find((model) => model.provider === provider && model.id === id);
      },
      getAvailable() { return available; },
    },
  };
  const emit = (event, payload = {}) => handlers.get(event)?.(payload, ctx);
  return {
    calls,
    dialogs,
    selections,
    customs,
    command: (args = '') => {
      assert.ok(commands.has('collaboration'), '/collaboration must be registered');
      return commands.get('collaboration').handler(args, ctx);
    },
    setIdle: (value) => { idle = value; },
    setBranch: (value) => { branch = value; },
    emit,
    sessionStart: (reason = 'startup') => emit('session_start', { type: 'session_start', reason }),
    input: (text = 'Implement the change', source = 'interactive') =>
      emit('input', { type: 'input', text, source }),
    streamingInput: (text = 'Steer the active run') =>
      emit('input', { type: 'input', text, source: 'interactive', streamingBehavior: 'steer' }),
    toolCall: (input) => emit('tool_call', { type: 'tool_call', toolCallId: 'call-1', toolName: 'subagent', input }),
    setCurrentModel: (model) => { ctx.model = model; },
    sessionTree: () => emit('session_tree', { type: 'session_tree' }),
    userRun: (prompt = 'Implement the change') =>
      emit('before_agent_start', {
        type: 'before_agent_start',
        messageType: 'user',
        prompt,
        systemPrompt: '',
        systemPromptOptions: {},
      }),
  };
}

const approvedEntry = (data = ROLE_CONFIG) => ({ type: 'custom', customType: 'model-collaboration', data });
const disabledEntry = () => approvedEntry({ disabled: true });
const revocationEntry = () => ({ type: 'custom_message', customType: 'model-collaboration-revocation' });

// Removing the confirmation gate or recording approval before it resolves makes this fail.
test('an idle interactive prompt proposes the exact role models and waits for consent', async () => {
  const answer = deferred();
  const run = setup({ confirmAnswer: answer.promise });

  const pending = run.input('Implement the parser');
  assert.equal(run.dialogs.length, 1);
  const message = run.dialogs[0].message;
  assert.ok(message.includes('openai-codex/gpt-6-sol'), 'planner model is shown');
  assert.ok(message.includes('deepseek/deepseek-flash'), 'worker/reviewer models are shown');
  assert.match(message, /worker/i);
  assert.match(message, /reviewer/i);
  assert.equal(run.calls.appendEntry.length, 0, 'nothing is recorded before consent');
  assert.equal(run.calls.setModel.length, 0, 'no model switch before consent');

  answer.resolve(true);
  await pending;
});

// Removing the session record or planner switch makes this fail.
test('consent records the approved assignment and switches the parent to the planner', async () => {
  const run = setup();

  const result = await run.input();

  assert.notEqual(result?.action, 'handled');
  assert.deepEqual(run.calls.appendEntry, [
    { customType: 'model-collaboration', data: ROLE_CONFIG },
  ]);
  assert.deepEqual(
    run.calls.setModel.map((model) => `${model.provider}/${model.id}`),
    ['openai-codex/gpt-6-sol'],
  );
  assert.deepEqual(run.calls.notify, []);
});

// Declining collaboration must not discard the user's original request or prompt again.
test('declining initial consent disables collaboration and lets the prompt continue', async () => {
  const run = setup({ confirmAnswer: false });

  const result = await run.input('Discuss the release branch');

  assert.equal(result, undefined);
  assert.deepEqual(run.calls.appendEntry, [{ customType: 'model-collaboration', data: { disabled: true } }]);
  assert.deepEqual(run.calls.setModel, []);
  assert.equal(run.calls.sendMessage.length, 1);
  assert.equal(run.userRun(), undefined);
  assert.equal(await run.input('Continue the discussion'), undefined);
  assert.equal(run.dialogs.length, 1);
});

// Dropping the absent-file default path (or substituting a different installed default) makes this fail.
test('without a config file the current model plans and installed role defaults apply', async () => {
  const missingDir = mkdtempSync(join(tmpdir(), 'model-collaboration-absent-'));
  tempDirs.push(missingDir);
  const missingPath = join(missingDir, 'absent.json');
  const run = setup({
    configPath: missingPath,
    currentModel: CURRENT_MODEL,
    available: [CURRENT_MODEL, WORKER_MODEL],
  });

  const result = await run.input();

  assert.notEqual(result?.action, 'handled');
  assert.deepEqual(run.calls.appendEntry, [{
    customType: 'model-collaboration',
    data: {
      planner: 'openai-codex/gpt-6-luna',
      worker: 'deepseek/deepseek-flash',
      reviewer: 'deepseek/deepseek-flash',
    },
  }]);
  assert.deepEqual(run.calls.setModel, [], 'the current planner model needs no switch');
});

// Removing availability validation would let an absent role model be silently replaced or used anyway.
test('an unavailable configured role model cancels before any dialog', async () => {
  const run = setup({
    config: { ...ROLE_CONFIG, worker: 'deepseek/deepseek-flash' },
    available: [CURRENT_MODEL, PLANNER_MODEL],
  });

  const result = await run.input();

  assert.equal(result?.action, 'handled');
  assert.equal(run.dialogs.length, 0);
  assert.deepEqual(run.calls.appendEntry, []);
  assert.ok(run.calls.notify.some((message) => message.includes('deepseek/deepseek-flash')));
});

// Falling through to a model request when configuration cannot be read makes this fail.
test('unreadable role configuration cancels without a dialog', async () => {
  const run = setup({ config: '{ this is not json' });

  const result = await run.input();

  assert.equal(result?.action, 'handled');
  assert.equal(run.dialogs.length, 0);
  assert.deepEqual(run.calls.appendEntry, []);
  assert.ok(run.calls.notify.length > 0);
});

// Recording approval after a refused planner switch makes this fail.
test('a refused planner switch cancels without recording consent', async () => {
  const run = setup({ setModelResult: false });

  const result = await run.input();

  assert.equal(result?.action, 'handled');
  assert.deepEqual(run.calls.appendEntry, []);
  assert.ok(run.calls.notify.length > 0);
});

// Letting a thrown dialog error fall through to the task makes this fail.
test('a confirmation error consumes the prompt', async () => {
  const run = setup({ confirmAnswer: () => { throw new Error('dialog unavailable'); } });

  const result = await run.input();

  assert.equal(result?.action, 'handled');
  assert.deepEqual(run.calls.appendEntry, []);
});

// Prompting again after consent makes this fail.
test('later prompts in the same session reuse the approved assignment', async () => {
  const run = setup();
  await run.input();

  const result = await run.input('Now add the missing tests');

  assert.notEqual(result?.action, 'handled');
  assert.equal(run.dialogs.length, 1, 'no second confirmation');
  assert.equal(run.calls.appendEntry.length, 1, 'the assignment is recorded once');
  assert.equal(run.calls.setModel.length, 1, 'no repeated model switch');
});

// Keeping the in-memory approval across /new makes this fail.
test('a new session asks for confirmation again', async () => {
  const run = setup();
  await run.input();

  run.sessionStart('new');
  const result = await run.input('Start the next task');

  assert.notEqual(result?.action, 'handled');
  assert.equal(run.dialogs.length, 2);
  assert.equal(run.calls.appendEntry.length, 2);
});

// Ignoring branch entries makes this fail; trusting stored data also replaces the config-derived assignment.
test('a resumed session reuses its stored assignment without a dialog', async () => {
  const run = setup({
    branch: [approvedEntry()],
    config: {
      planner: 'openai-codex/gpt-6-luna',
      worker: 'openai-codex/gpt-6-luna',
      reviewer: 'openai-codex/gpt-6-luna',
    },
  });

  run.sessionStart('resume');
  const result = await run.input();

  assert.notEqual(result?.action, 'handled');
  assert.equal(run.dialogs.length, 0);
  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(
    run.calls.setModel.map((model) => `${model.provider}/${model.id}`),
    ['openai-codex/gpt-6-sol'],
  );
});

// Treating a malformed stored entry as consent makes this fail.
test('a malformed stored assignment is not treated as consent', async () => {
  const invalidAssignments = [
    { planner: 'openai-codex/gpt-6-sol' },
    { planner: 'openai-codex/gpt-6-sol', worker: 42, reviewer: 'deepseek/deepseek-flash' },
  ];
  for (const data of invalidAssignments) {
    const run = setup({
      branch: [{ type: 'custom', customType: 'model-collaboration', data }],
    });

    run.sessionStart('resume');
    const result = await run.input();

    assert.notEqual(result?.action, 'handled');
    assert.equal(run.dialogs.length, 1, `re-confirms for ${JSON.stringify(data)}`);
  }
});

// Prompting for extension-sent messages would recurse into confirmation for system follow-ups.
test('extension-origin prompts never open a dialog or record consent', async () => {
  const run = setup();

  const result = await run.input('Continuation from another extension', 'extension');

  assert.equal(result, undefined);
  assert.deepEqual(run.dialogs, []);
  assert.deepEqual(run.calls.appendEntry, []);
});

// Opening a dialog in headless modes would break existing print/JSON runs.
test('non-dialog modes keep the existing prompt flow', async () => {
  const run = setup({ hasUI: false, mode: 'print' });

  const result = await run.input('Run headless');

  assert.equal(result, undefined);
  assert.equal(run.dialogs.length, 0);
  assert.deepEqual(run.calls.appendEntry, []);
});

// Prompting while the agent is streaming would interrupt instead of steering.
test('a streamed follow-up does not open a dialog', async () => {
  const run = setup();

  const result = await run.streamingInput();

  assert.equal(result, undefined);
  assert.equal(run.dialogs.length, 0);
  assert.deepEqual(run.calls.appendEntry, []);
});

// Treating RPC prompts as headless would lose confirmation where dialogs are supported.
test('an RPC prompt with dialog support is confirmed', async () => {
  const run = setup({ mode: 'rpc', hasUI: true });

  const result = await run.input('Implement over RPC');

  assert.notEqual(result?.action, 'handled');
  assert.equal(run.dialogs.length, 1);
  assert.equal(run.calls.appendEntry.length, 1);
});

// Omitting the model IDs from the run instruction would force the parent to guess the approved routing.
test('an approved user run receives the exact role-routing instruction', async () => {
  const run = setup();
  await run.input();

  const result = run.userRun('Implement the parser');

  assert.equal(result?.message?.customType, 'model-collaboration-routing');
  assert.equal(result?.message?.display, false);
  const content = result.message.content;
  assert.ok(content.includes('openai-codex/gpt-6-sol'));
  assert.ok(content.includes('deepseek/deepseek-flash'));
  assert.match(content, /worker/i);
  assert.match(content, /reviewer/i);
  assert.match(content, /security/i);
});

// Injecting routing before consent or into extension-triggered runs would assert an unapproved policy.
test('no routing instruction is injected before consent or on extension runs', async () => {
  const run = setup();
  assert.equal(await run.userRun(), undefined);

  await run.input();
  const custom = await run.emit('before_agent_start', {
    type: 'before_agent_start',
    messageType: 'custom',
    message: { customType: 'other-extension', content: 'Continue', display: false },
    systemPrompt: '',
    systemPromptOptions: {},
  });
  assert.equal(custom, undefined);
});

// Announcing a stored approval in headless modes would claim a confirmation the user never saw.
test('a stored approval is not announced in non-dialog modes', async () => {
  const run = setup({ branch: [approvedEntry()], hasUI: false, mode: 'print' });

  run.sessionStart('resume');

  assert.equal(await run.userRun(), undefined);
});

// Asserting the active model on every run would make the routing text false after a manual /model change.
test('routing text states the approved planner without claiming the active model', async () => {
  const run = setup();
  await run.input();
  run.setCurrentModel(CURRENT_MODEL);

  const result = await run.userRun('Discuss the next step');

  const content = result.message.content;
  assert.match(content, /approved planner model for this session is openai-codex\/gpt-6-sol/);
  assert.doesNotMatch(content, /in this conversation on openai-codex\/gpt-6-sol/);
});

// Removing the model check would let a worker run on a model the user did not approve.
test('a worker call with an unapproved model is blocked', async () => {
  const run = setup();
  await run.input();

  const result = await run.toolCall({
    agent: 'worker',
    task: 'Implement the change',
    model: 'openai-codex/gpt-6-sol',
  });

  assert.equal(result?.block, true);
  assert.ok(result.reason.includes('openai-codex/gpt-6-sol'));
  assert.ok(result.reason.includes('deepseek/deepseek-flash'));
});

// Removing the alias mapping would let the same writer role bypass the model check.
test('a worker alias with an unapproved model is blocked', async () => {
  const run = setup();
  await run.input();

  const result = await run.toolCall({
    agent: 'developer',
    task: 'Implement the change',
    model: 'openai-codex/gpt-6-sol',
  });

  assert.equal(result?.block, true);
});

// Letting an omitted model inherit the parent session model would run implementation on the planner.
test('a worker call without a model receives the approved worker model', async () => {
  const run = setup();
  await run.input();

  const input = { agent: 'worker', task: 'Implement the change' };
  const result = await run.toolCall(input);

  assert.equal(result, undefined);
  assert.equal(input.model, 'deepseek/deepseek-flash');
});

// Blocking the approved model (or its documented thinking suffix) would prevent authorized delegation.
test('approved worker and reviewer models pass the guard, including a thinking suffix', async () => {
  const run = setup();
  await run.input();

  for (const input of [
    { agent: 'worker', task: 'Implement', model: 'deepseek/deepseek-flash' },
    { agent: 'worker', task: 'Implement', model: 'deepseek/deepseek-flash:high' },
    { agent: 'reviewer', task: 'Review', model: 'deepseek/deepseek-flash' },
  ]) {
    assert.equal(await run.toolCall(input), undefined, JSON.stringify(input));
  }
});

// Allowing delegation before the user confirms would start child work without consent.
test('a worker call before consent is blocked when a dialog is available', async () => {
  const run = setup();

  const result = await run.toolCall({
    agent: 'worker',
    task: 'Implement before confirmation',
    model: 'deepseek/deepseek-flash',
  });

  assert.equal(result?.block, true);
});

// Blocking headless delegation would change existing non-interactive behavior.
test('headless worker calls are not blocked by the collaboration guard', async () => {
  const run = setup({ hasUI: false, mode: 'print' });

  const result = await run.toolCall({
    agent: 'worker',
    task: 'Implement headless',
    model: 'openai-codex/gpt-6-sol',
  });

  assert.equal(result, undefined);
});

// Treating a workflow launch as model-checked would let per-child models bypass the approved assignment.
test('a workflow launch is blocked after consent because per-child models are unknown', async () => {
  const run = setup();
  await run.input();

  for (const workflow of [
    { workflow: 'parallel', args: { tasks: [{ agent: 'worker', task: 'Implement the change' }] } },
    { workflow: 'parallel', args: { tasks: [{ agent: 'worker', model: 'openai-codex/gpt-6-sol', task: 'Implement' }] } },
    { workflow: true },
  ]) {
    const result = await run.toolCall(workflow);
    assert.equal(result?.block, true, JSON.stringify(workflow));
    assert.match(result.reason, /agent/);
    assert.match(result.reason, /model/);
  }
});

// Allowing any subagent launch before consent would start child work without an approved assignment.
test('subagent launches before consent are blocked except management calls', async () => {
  const run = setup();

  assert.equal((await run.toolCall({ agent: 'scout', task: 'Inspect the parser' }))?.block, true);
  assert.equal(
    (await run.toolCall({ workflow: 'review', args: { task: 'Review the change' } }))?.block,
    true,
  );
  assert.equal(await run.toolCall({ action: 'status' }), undefined);
});

// Treating every non-empty action as management would let resume, scheduled, project, or refinement
// actions start model work before the user confirms the role models.
test('model-launching subagent actions before consent are blocked', async () => {
  const run = setup();
  for (const input of [
    { action: 'resume', id: 'run-1', message: 'Continue the implementation' },
    { action: 'schedule.run', id: 'schedule-1' },
    { action: 'schedule.run-due' },
    { action: 'project.open', cwd: '/tmp/repo', message: 'Start in this project' },
    { action: 'refine', agent: 'worker' },
  ]) {
    const result = await run.toolCall(input);
    assert.equal(result?.block, true, JSON.stringify(input));
    assert.match(result.reason, /confirm/i, JSON.stringify(input));
  }
});

// Letting these actions through after consent would start work on a model the input never names.
test('model-launching subagent actions after consent are blocked as uncheckable', async () => {
  const run = setup();
  await run.input();
  for (const input of [
    { action: 'resume', id: 'run-1', message: 'Continue the implementation' },
    { action: 'schedule.run', id: 'schedule-1' },
    { action: 'schedule.create', workflow: true, options: { every: '6h' } },
    { action: 'schedule.run-due' },
    { action: 'project.open', cwd: '/tmp/repo', message: 'Start in this project' },
    { action: 'refine', agent: 'worker' },
  ]) {
    const result = await run.toolCall(input);
    assert.equal(result?.block, true, JSON.stringify(input));
    assert.ok(result.reason.includes(input.action), JSON.stringify(input));
    assert.match(result.reason, /model/i, JSON.stringify(input));
  }
});

// Blocking inspection or control actions would remove status, help, and stop/interrupt from the parent.
test('read-only inspection and control actions remain usable before and after consent', async () => {
  const run = setup();
  const actions = ['status', 'guide', 'doctor', 'list', 'models', 'children.list', 'refine.show', 'schedule.list', 'project.status', 'interrupt', 'stop'];
  for (const action of actions) {
    assert.equal(await run.toolCall({ action }), undefined, `${action} before consent`);
  }
  await run.input();
  for (const action of actions) {
    assert.equal(await run.toolCall({ action }), undefined, `${action} after consent`);
  }
});

// Allowing an action this extension does not know would fail open if a newer pi-subagents release
// adds another model-launching action.
test('unknown subagent actions fail closed before and after consent', async () => {
  const run = setup();
  const before = await run.toolCall({ action: 'launch.child' });
  assert.equal(before?.block, true);
  assert.ok(before.reason.includes('launch.child'));
  assert.match(before.reason, /unknown|not a known|may start/i);

  await run.input();
  const after = await run.toolCall({ action: 'launch.child' });
  assert.equal(after?.block, true);
  assert.ok(after.reason.includes('launch.child'));
  assert.match(after.reason, /unknown|not a known|may start/i);
});

// Blocking actions in headless modes would change existing non-interactive behavior.
test('headless subagent actions are not blocked by the collaboration guard', async () => {
  const run = setup({ hasUI: false, mode: 'print' });

  assert.equal(await run.toolCall({ action: 'resume', id: 'run-1', message: 'Continue' }), undefined);
  assert.equal(await run.toolCall({ action: 'schedule.run', id: 'schedule-1' }), undefined);
});

// Blocking workflow calls in headless modes would change existing non-interactive behavior.
test('headless workflow calls are not blocked by the collaboration guard', async () => {
  const run = setup({ hasUI: false, mode: 'print' });

  assert.equal(await run.toolCall({ workflow: 'parallel', args: { tasks: [] } }), undefined);
});

// Blocking unrelated subagent roles or management calls would break existing delegation.
test('unrelated agents and subagent management calls pass the guard', async () => {
  const run = setup();
  await run.input();

  assert.equal(await run.toolCall({ agent: 'scout', task: 'Inspect', model: 'openai-codex/gpt-6-sol' }), undefined);
  assert.equal(await run.toolCall({ action: 'status' }), undefined);
});

// Re-asserting the planner on every prompt would override a user's deliberate /model change.
test('a later manual model change is not overridden by the stored assignment', async () => {
  const run = setup();
  await run.input();
  run.setCurrentModel(CURRENT_MODEL);

  await run.input('Discuss the next step');

  assert.equal(run.calls.setModel.length, 1);
});

// Leaving in-memory consent after a branch rewind would skip confirmation on an unapproved branch.
test('rewinding the session branch requests confirmation again', async () => {
  const run = setup();
  await run.input();

  run.sessionTree();

  const result = await run.input('Work on the rewind target');
  assert.notEqual(result?.action, 'handled');
  assert.equal(run.dialogs.length, 2);
});

// Splitting at the last slash would corrupt provider ids that contain their own slash.
test('provider-qualified ids with extra slashes are parsed at the first slash', async () => {
  const slashModel = { provider: 'huggingface', id: 'owner/model' };
  const run = setup({
    config: { ...ROLE_CONFIG, worker: 'huggingface/owner/model' },
    extraModels: [slashModel],
    available: [CURRENT_MODEL, PLANNER_MODEL, slashModel, WORKER_MODEL],
  });

  await run.input();

  assert.equal(run.calls.appendEntry[0].data.worker, 'huggingface/owner/model');
  assert.equal(
    (await run.toolCall({ agent: 'worker', task: 'Implement', model: 'deepseek/deepseek-flash' }))?.block,
    true,
  );
  assert.equal(
    await run.toolCall({ agent: 'worker', task: 'Implement', model: 'huggingface/owner/model' }),
    undefined,
  );
});

// Comparing a child model against either approved model would let a role run on the other role's model.
test('worker and reviewer assignments are enforced separately', async () => {
  const run = setup({
    config: {
      planner: 'openai-codex/gpt-6-sol',
      worker: 'deepseek/deepseek-flash',
      reviewer: 'openai-codex/gpt-6-sol',
    },
  });
  await run.input();

  assert.equal(
    (await run.toolCall({ agent: 'reviewer', task: 'Review', model: 'deepseek/deepseek-flash' }))?.block,
    true,
  );
  assert.equal(
    (await run.toolCall({ agent: 'worker', task: 'Implement', model: 'openai-codex/gpt-6-sol' }))?.block,
    true,
  );
  assert.equal(
    await run.toolCall({ agent: 'reviewer', task: 'Review', model: 'openai-codex/gpt-6-sol' }),
    undefined,
  );
});

// Substituting another model when a resumed role model is gone would bypass the recorded consent.
test('a resumed assignment with an unavailable planner cancels instead of substituting', async () => {
  const run = setup({
    branch: [approvedEntry()],
    available: [CURRENT_MODEL, WORKER_MODEL],
  });

  run.sessionStart('resume');
  const result = await run.input();

  assert.equal(result?.action, 'handled');
  assert.deepEqual(run.calls.setModel, []);
  assert.ok(run.calls.notify.some((message) => message.includes('openai-codex/gpt-6-sol')));
});

for (const role of ['worker', 'reviewer']) {
  test(`/collaboration ${role} changes only that role after confirmation`, async () => {
    const answer = deferred();
    const run = setup({
      branch: [approvedEntry()],
      selectAnswers: ['openai-codex/gpt-6-luna', 'Only this session'],
      confirmAnswer: answer.promise,
    });
    run.sessionStart('resume');

    const pending = run.command(role);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(run.dialogs.length, 1);
    assert.match(run.dialogs[0].message, new RegExp(role));
    assert.match(run.dialogs[0].message, /deepseek\/deepseek-flash/);
    assert.match(run.dialogs[0].message, /openai-codex\/gpt-6-luna/);
    assert.deepEqual(run.calls.appendEntry, []);
    assert.equal(await run.toolCall({ agent: role, model: ROLE_CONFIG[role] }), undefined);

    answer.resolve(true);
    await pending;
    const updated = { ...ROLE_CONFIG, [role]: 'openai-codex/gpt-6-luna' };
    assert.deepEqual(run.calls.appendEntry, [{ customType: 'model-collaboration', data: updated }]);
    assert.deepEqual(run.calls.setModel, [], 'the command must not switch the parent model');
    assert.equal(await run.toolCall({ agent: role, model: 'openai-codex/gpt-6-luna:high' }), undefined);
    assert.equal((await run.toolCall({ agent: role, model: ROLE_CONFIG[role] }))?.block, true);
    const input = { agent: role, task: 'Next task' };
    await run.toolCall(input);
    assert.equal(input.model, 'openai-codex/gpt-6-luna');
    const otherRole = role === 'worker' ? 'reviewer' : 'worker';
    assert.equal(await run.toolCall({ agent: otherRole, model: 'deepseek/deepseek-flash' }), undefined);
    const routing = run.userRun().message.content;
    assert.ok(routing.includes(`agent "${role}" and model "openai-codex/gpt-6-luna"`));
    assert.match(routing, /supersedes earlier/i);
    assert.deepEqual(ROLE_CONFIG, {
      planner: 'openai-codex/gpt-6-sol', worker: 'deepseek/deepseek-flash', reviewer: 'deepseek/deepseek-flash',
    }, 'stored history must not be mutated');
  });
}

test('/collaboration first offers enable/disable, then keeps or modifies the current roles', async () => {
  const run = setup({ selectAnswers: ['Enable collaboration', 'Keep this assignment'] });
  await run.input();
  const before = run.calls.appendEntry.length;
  await run.command();

  assert.deepEqual(run.selections[0].options, [
    'Enable collaboration',
    'Disable collaboration',
    'Save current assignment as global defaults',
  ]);
  assert.match(run.selections[0].title, /enabled/i);
  assert.match(run.selections[1].title, /planner/i);
  for (const model of Object.values(ROLE_CONFIG)) assert.ok(run.selections[1].title.includes(model));
  assert.deepEqual(run.selections[1].options, ['Keep this assignment', 'Modify roles']);
  assert.equal(run.calls.appendEntry.length, before, 'keeping an active assignment changes nothing');
});

test('the command can enable collaboration before any prompt is sent', async () => {
  const run = setup({ selectAnswers: ['Enable collaboration', 'Keep this assignment'] });

  await run.command();

  assert.deepEqual(run.calls.appendEntry, [{ customType: 'model-collaboration', data: ROLE_CONFIG }]);
  assert.deepEqual(
    run.calls.setModel.map((model) => `${model.provider}/${model.id}`),
    ['openai-codex/gpt-6-sol'],
  );
  assert.match(run.userRun().message.content, /agent "worker" and model "deepseek\/deepseek-flash"/);
  assert.equal(await run.input('Implement now'), undefined);
  assert.equal(run.dialogs.length, 0, 'an enabled session must not ask for consent again');
});

test('/collaboration on enables directly without the enable/disable menu', async () => {
  const run = setup({ selectAnswers: ['Keep this assignment'] });

  await run.command('on');

  assert.equal(run.selections.length, 1);
  assert.match(run.selections[0].title, /planner/i);
  assert.deepEqual(run.calls.appendEntry, [{ customType: 'model-collaboration', data: ROLE_CONFIG }]);
});

test('declining the initial prompt can be reversed by the command', async () => {
  const run = setup({
    confirmAnswer: false,
    selectAnswers: ['Enable collaboration', 'Keep this assignment'],
  });
  await run.input('Discuss the release branch');
  assert.equal(run.userRun(), undefined);

  await run.command();

  assert.deepEqual(run.calls.appendEntry.at(-1), { customType: 'model-collaboration', data: ROLE_CONFIG });
  assert.match(run.userRun().message.content, /approved planner model for this session is openai-codex\/gpt-6-sol/);
  assert.equal(await run.input('Continue the discussion'), undefined);
  assert.equal(run.dialogs.length, 1, 'only the original declined prompt used a confirmation dialog');
});

test('off can be followed by a command re-enable that keeps the session role changes', async () => {
  const run = setup({
    selectAnswers: [
      'openai-codex/gpt-6-luna',
      'Only this session',
      'Enable collaboration',
      'Keep this assignment',
    ],
  });
  await run.input();
  await run.command('worker');
  const updated = { ...ROLE_CONFIG, worker: 'openai-codex/gpt-6-luna' };
  assert.deepEqual(run.calls.appendEntry.at(-1).data, updated);

  await run.command('off');
  const beforeEnable = run.calls.appendEntry.length;
  await run.command();

  assert.deepEqual(run.calls.appendEntry.slice(beforeEnable), [
    { customType: 'model-collaboration', data: updated },
  ]);
  assert.equal(await run.toolCall({ agent: 'worker', model: 'openai-codex/gpt-6-luna' }), undefined);
  assert.equal((await run.toolCall({ agent: 'worker', model: 'deepseek/deepseek-flash' }))?.block, true);
  assert.match(run.userRun().message.content, /openai-codex\/gpt-6-luna/);
});

test('a restored disabled session can be enabled by the command', async () => {
  const updated = { ...ROLE_CONFIG, reviewer: 'openai-codex/gpt-6-luna' };
  const run = setup({
    branch: [approvedEntry(updated), disabledEntry()],
    selectAnswers: ['Enable collaboration', 'Keep this assignment'],
  });
  run.sessionStart('resume');
  assert.equal(run.userRun(), undefined);

  await run.command();

  assert.deepEqual(run.calls.appendEntry.at(-1), { customType: 'model-collaboration', data: updated });
  assert.match(run.userRun().message.content, /agent "reviewer" and model "openai-codex\/gpt-6-luna"/);
  assert.equal(await run.input('Review the change'), undefined);
  assert.deepEqual(run.dialogs, [], 'the restored session must not prompt for consent again');
});

test('modify lists every role with its current model and commits a changed worker', async () => {
  const run = setup({
    selectAnswers: [
      'Enable collaboration',
      'Modify roles',
      'worker — deepseek/deepseek-flash',
      'openai-codex/gpt-6-luna',
      'Done — enable with these role models',
      'Only this session',
    ],
  });

  await run.command();

  assert.deepEqual(run.selections[2].options, [
    'planner — openai-codex/gpt-6-sol',
    'worker — deepseek/deepseek-flash',
    'reviewer — deepseek/deepseek-flash',
    'Done — enable with these role models',
  ]);
  assert.match(run.selections[2].title, /openai-codex\/gpt-6-sol/);
  assert.match(run.selections[2].title, /deepseek\/deepseek-flash/);
  assert.deepEqual(run.selections[3].options, [
    'deepseek/deepseek-flash',
    'openai-codex/gpt-6-luna',
    'openai-codex/gpt-6-sol',
  ]);
  const updated = { ...ROLE_CONFIG, worker: 'openai-codex/gpt-6-luna' };
  assert.deepEqual(run.calls.appendEntry, [{ customType: 'model-collaboration', data: updated }]);
  assert.deepEqual(
    run.calls.setModel.map((model) => `${model.provider}/${model.id}`),
    ['openai-codex/gpt-6-sol'],
    'enabling switches to the selected planner',
  );
  assert.equal(await run.toolCall({ agent: 'worker', model: 'openai-codex/gpt-6-luna' }), undefined);
  assert.equal((await run.toolCall({ agent: 'worker', model: 'deepseek/deepseek-flash' }))?.block, true);
});

test('modify can select the planner and applies it only after confirmation, before the commit', async () => {
  const run = setup({
    currentModel: WORKER_MODEL,
    selectAnswers: [
      'Enable collaboration',
      'Modify roles',
      'planner — openai-codex/gpt-6-sol',
      'openai-codex/gpt-6-luna',
      'Done — enable with these role models',
      'Only this session',
    ],
    confirmAnswer: () => {
      assert.deepEqual(
        run.calls.events.filter((event) => event.type !== 'confirm'),
        [],
        'no planner switch or assignment commit before confirmation',
      );
      return true;
    },
  });

  await run.command();

  assert.equal(run.calls.appendEntry.at(-1).data.planner, 'openai-codex/gpt-6-luna');
  const eventTypes = run.calls.events.map((event) => event.type);
  assert.ok(eventTypes.indexOf('setModel') < eventTypes.indexOf('appendEntry'));
  assert.deepEqual(run.calls.setModel.map((model) => `${model.provider}/${model.id}`), ['openai-codex/gpt-6-luna']);
  assert.match(run.userRun().message.content, /planner model for this session is openai-codex\/gpt-6-luna/);
});

test('/collaboration planner changes the planner after confirmation and switches the parent model', async () => {
  const answer = deferred();
  const run = setup({
    branch: [approvedEntry()],
    currentModel: WORKER_MODEL,
    selectAnswers: ['openai-codex/gpt-6-luna', 'Only this session'],
    confirmAnswer: answer.promise,
  });
  run.sessionStart('resume');

  const pending = run.command('planner');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.dialogs.length, 1);
  assert.match(run.dialogs[0].message, /planner/);
  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);

  answer.resolve(true);
  await pending;
  const updated = { ...ROLE_CONFIG, planner: 'openai-codex/gpt-6-luna' };
  assert.deepEqual(run.calls.appendEntry, [{ customType: 'model-collaboration', data: updated }]);
  assert.deepEqual(
    run.calls.setModel.map((model) => `${model.provider}/${model.id}`),
    ['openai-codex/gpt-6-luna'],
  );
  const routing = run.userRun().message.content;
  assert.match(routing, /planner model for this session is openai-codex\/gpt-6-luna/);
  assert.equal(await run.toolCall({ agent: 'worker', model: 'deepseek/deepseek-flash' }), undefined);
});

test('a refused planner switch during enable leaves the session unconfigured', async () => {
  const run = setup({
    setModelResult: false,
    selectAnswers: ['Enable collaboration', 'Keep this assignment'],
  });

  await run.command();

  assert.deepEqual(run.calls.appendEntry, []);
  assert.equal(run.calls.setModel.length, 1);
  assert.equal(run.userRun(), undefined);
  assert.equal((await run.input())?.action, 'handled');
  assert.deepEqual(run.calls.appendEntry, [], 'the later prompt also fails without recording consent');
});

test('a refused planner switch during the planner shortcut leaves the assignment unchanged', async () => {
  const run = setup({
    branch: [approvedEntry()],
    currentModel: WORKER_MODEL,
    setModelResult: false,
    selectAnswers: ['openai-codex/gpt-6-luna', 'Only this session'],
    confirmAnswer: true,
  });
  run.sessionStart('resume');

  await run.command('planner');

  assert.deepEqual(run.calls.appendEntry, []);
  assert.equal(run.calls.setModel.length, 1);
  assert.match(run.userRun().message.content, /planner model for this session is openai-codex\/gpt-6-sol/);
});

test('the searchable picker matches provider, model, and role keywords case-insensitively', () => {
  const roles = [
    { value: 'planner', label: 'planner', description: 'openai-codex/gpt-6-sol' },
    { value: 'worker', label: 'worker', description: 'deepseek/deepseek-flash' },
    { value: 'reviewer', label: 'reviewer', description: 'openai-codex/gpt-6-review' },
  ];
  assert.deepEqual(filterChoices(roles, 'FLASH').map((choice) => choice.value), ['worker']);
  assert.deepEqual(filterChoices(roles, 'openai').map((choice) => choice.value), ['planner', 'reviewer']);
  assert.deepEqual(filterChoices(roles, 'plan').map((choice) => choice.value), ['planner']);
  assert.deepEqual(filterChoices(roles, '').map((choice) => choice.value), ['planner', 'worker', 'reviewer']);
  assert.deepEqual(filterChoices(roles, 'missing'), []);

  const models = [
    { value: 'deepseek/deepseek-flash', label: 'deepseek/deepseek-flash' },
    { value: 'huggingface/owner/model', label: 'huggingface/owner/model' },
  ];
  assert.deepEqual(filterChoices(models, 'owner/model').map((choice) => choice.value), ['huggingface/owner/model']);
  assert.deepEqual(filterChoices(models, 'DEEPSEEK').map((choice) => choice.value), ['deepseek/deepseek-flash']);
});

test('the role model picker excludes unavailable catalog models', async () => {
  const run = setup({
    available: [WORKER_MODEL], branch: [approvedEntry()], selectAnswers: [undefined],
  });
  run.sessionStart('resume');
  await run.command('worker');

  assert.deepEqual(run.selections[0].options, ['deepseek/deepseek-flash']);
});

for (const [stage, args, selectAnswers, confirmAnswer] of [
  ['action menu', '', [undefined], true],
  ['model selection', 'worker', [undefined], true],
  ['confirmation', 'worker', ['openai-codex/gpt-6-luna'], false],
  ['unchanged model', 'worker', ['deepseek/deepseek-flash'], true],
]) {
  test(`cancelling ${stage} leaves the assignment unchanged`, async () => {
    const run = setup({ branch: [approvedEntry()], selectAnswers, confirmAnswer });
    run.sessionStart('resume');
    await run.command(args);

    assert.deepEqual(run.calls.appendEntry, []);
    assert.deepEqual(run.calls.setModel, []);
    assert.equal(await run.toolCall({ agent: 'worker', model: 'deepseek/deepseek-flash' }), undefined);
    assert.equal((await run.toolCall({ agent: 'worker', model: 'openai-codex/gpt-6-luna' }))?.block, true);
  });
}

for (const [stage, selectAnswers] of [
  ['the action menu', [undefined]],
  ['the keep/modify choice', ['Enable collaboration', undefined]],
  ['role selection during modify', ['Enable collaboration', 'Modify roles', undefined]],
  ['model selection during modify', [
    'Enable collaboration',
    'Modify roles',
    'worker — deepseek/deepseek-flash',
    undefined,
  ]],
]) {
  test(`cancelling ${stage} leaves an active assignment unchanged`, async () => {
    const run = setup({ branch: [approvedEntry()], selectAnswers });
    run.sessionStart('resume');
    await run.command();

    assert.deepEqual(run.calls.appendEntry, []);
    assert.deepEqual(run.calls.setModel, []);
    assert.equal(await run.toolCall({ agent: 'worker', model: 'deepseek/deepseek-flash' }), undefined);
    assert.equal((await run.toolCall({ agent: 'worker', model: 'openai-codex/gpt-6-luna' }))?.block, true);
  });
}

for (const [stage, selectAnswers] of [
  ['the action menu', [undefined]],
  ['the keep/modify choice', ['Enable collaboration', undefined]],
  ['role selection during modify', ['Enable collaboration', 'Modify roles', undefined]],
  ['model selection during modify', [
    'Enable collaboration',
    'Modify roles',
    'worker — deepseek/deepseek-flash',
    undefined,
  ]],
]) {
  test(`cancelling ${stage} leaves a disabled session disabled`, async () => {
    const run = setup({ branch: [disabledEntry()], selectAnswers });
    run.sessionStart('resume');
    await run.command();

    assert.deepEqual(run.calls.appendEntry, []);
    assert.deepEqual(run.calls.setModel, []);
    assert.equal(run.userRun(), undefined);
    assert.equal(await run.input(), undefined);
    assert.deepEqual(run.dialogs, []);
  });
}

test('cancelling after changing a working role discards the modified selection', async () => {
  const run = setup({
    branch: [approvedEntry()],
    selectAnswers: [
      'Enable collaboration',
      'Modify roles',
      'worker — deepseek/deepseek-flash',
      'openai-codex/gpt-6-luna',
      undefined,
    ],
  });
  run.sessionStart('resume');

  await run.command();

  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
  assert.equal(await run.toolCall({ agent: 'worker', model: 'deepseek/deepseek-flash' }), undefined);
  assert.equal((await run.toolCall({ agent: 'worker', model: 'openai-codex/gpt-6-luna' }))?.block, true);
});

test('declining a modified enable leaves an active assignment unchanged', async () => {
  const run = setup({
    branch: [approvedEntry()],
    selectAnswers: [
      'Enable collaboration',
      'Modify roles',
      'worker — deepseek/deepseek-flash',
      'openai-codex/gpt-6-luna',
      'Done — enable with these role models',
    ],
    confirmAnswer: false,
  });
  run.sessionStart('resume');

  await run.command();

  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
  assert.equal(await run.toolCall({ agent: 'worker', model: 'deepseek/deepseek-flash' }), undefined);
  assert.equal((await run.toolCall({ agent: 'worker', model: 'openai-codex/gpt-6-luna' }))?.block, true);
});

test('declining a modified enable leaves an unconfigured session unconfigured', async () => {
  const run = setup({
    selectAnswers: [
      'Enable collaboration',
      'Modify roles',
      'worker — deepseek/deepseek-flash',
      'openai-codex/gpt-6-luna',
      'Done — enable with these role models',
    ],
    confirmAnswer: false,
  });

  await run.command();

  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
  const dialogsBeforePrompt = run.dialogs.length;
  await run.input('Implement after all');
  assert.equal(run.dialogs.length, dialogsBeforePrompt + 1, 'the initial prompt still asks for consent');
  assert.equal(run.userRun(), undefined);
});

test('declining a modified enable leaves a disabled session disabled', async () => {
  const run = setup({
    branch: [disabledEntry()],
    selectAnswers: [
      'Enable collaboration',
      'Modify roles',
      'worker — deepseek/deepseek-flash',
      'openai-codex/gpt-6-luna',
      'Done — enable with these role models',
    ],
    confirmAnswer: false,
  });
  run.sessionStart('resume');

  await run.command();

  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
  assert.equal(run.userRun(), undefined);
  assert.equal(await run.input(), undefined);
});

test('changed models persist on resume and branch navigation without changing global defaults', async () => {
  const configPath = configFile(ROLE_CONFIG);
  const run = setup({
    configPath,
    selectAnswers: [
      'openai-codex/gpt-6-luna',
      'Only this session',
      'openai-codex/gpt-6-sol',
      'Only this session',
    ],
  });
  await run.input();
  await run.command('worker');
  await run.command('reviewer');
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), ROLE_CONFIG);

  const history = run.calls.appendEntry.map((entry) => ({ type: 'custom', ...entry }));
  const resumed = setup({ branch: history });
  resumed.sessionStart('resume');
  await resumed.input();
  assert.equal(resumed.dialogs.length, 0);
  const input = { agent: 'worker' };
  await resumed.toolCall(input);
  assert.equal(input.model, 'openai-codex/gpt-6-luna');
  assert.equal(await resumed.toolCall({ agent: 'reviewer', model: 'openai-codex/gpt-6-sol' }), undefined);

  resumed.setBranch(history.slice(0, 1));
  resumed.sessionTree();
  assert.equal((await resumed.toolCall({ agent: 'worker', model: 'openai-codex/gpt-6-luna' }))?.block, true);
  assert.equal(await resumed.toolCall({ agent: 'reviewer', model: 'deepseek/deepseek-flash' }), undefined);
  resumed.setBranch([]);
  resumed.sessionStart('new');
  await resumed.input();
  assert.deepEqual(resumed.calls.appendEntry.at(-1).data, ROLE_CONFIG);
});

for (const [name, options, args] of [
  ['before initial consent', {}, 'worker'],
  ['without dialogs', { hasUI: false, branch: [approvedEntry()] }, 'worker'],
  ['while the parent is busy', { idle: false, branch: [approvedEntry()] }, 'worker'],
  ['with extra arguments', { branch: [approvedEntry()] }, 'worker extra'],
]) {
  test(`the command refuses changes ${name}`, async () => {
    const run = setup(options);
    run.sessionStart();
    await run.command(args);

    assert.deepEqual(run.selections, []);
    assert.deepEqual(run.calls.appendEntry, []);
    assert.deepEqual(run.calls.setModel, []);
    assert.ok(run.calls.notify.length > 0);
  });
}

test('an empty available-model list leaves the assignment intact', async () => {
  const run = setup({ branch: [approvedEntry()], available: [] });
  run.sessionStart();
  await run.command('worker');
  assert.deepEqual(run.selections, []);
  assert.deepEqual(run.calls.appendEntry, []);
  assert.ok(run.calls.notify.length > 0);
});

for (const stage of ['selection', 'confirmation']) {
  test(`a model becoming unavailable during ${stage} cannot be approved`, async () => {
    const available = [CURRENT_MODEL, PLANNER_MODEL, WORKER_MODEL];
    const removeModel = () => { available.splice(0, 1); };
    const run = setup({
      branch: [approvedEntry()], available,
      selectAnswers: [() => {
        if (stage === 'selection') removeModel();
        return 'openai-codex/gpt-6-luna';
      }],
      confirmAnswer: () => { removeModel(); return true; },
    });
    run.sessionStart();
    await run.command('worker');
    assert.deepEqual(run.calls.appendEntry, []);
    assert.equal((await run.toolCall({ agent: 'worker', model: 'openai-codex/gpt-6-luna' }))?.block, true);
    assert.ok(run.calls.notify.length > 0);
  });
}

for (const stage of ['selection', 'confirmation']) {
  test(`a failed ${stage} dialog leaves the assignment unchanged`, async () => {
    const fail = () => { throw new Error('dialog unavailable'); };
    const run = setup({
      branch: [approvedEntry()],
      selectAnswers: [stage === 'selection' ? fail : 'openai-codex/gpt-6-luna'],
      confirmAnswer: fail,
    });
    run.sessionStart();
    await run.command('worker');
    assert.deepEqual(run.calls.appendEntry, []);
    assert.equal(await run.toolCall({ agent: 'worker', model: 'deepseek/deepseek-flash' }), undefined);
    assert.ok(run.calls.notify.length > 0);
  });
}

test('a pending model change cannot overwrite a restored branch assignment', async () => {
  const answer = deferred();
  const run = setup({
    branch: [approvedEntry()], selectAnswers: ['openai-codex/gpt-6-luna'], confirmAnswer: answer.promise,
  });
  run.sessionStart();
  const pending = run.command('worker');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.dialogs.length, 1);
  run.sessionTree();
  answer.resolve(true);
  await pending;
  assert.deepEqual(run.calls.appendEntry, []);
  assert.equal(await run.toolCall({ agent: 'worker', model: 'deepseek/deepseek-flash' }), undefined);
});

test('a model change cannot commit if the parent starts running during confirmation', async () => {
  const run = setup({
    branch: [approvedEntry()], selectAnswers: ['openai-codex/gpt-6-luna'],
    confirmAnswer: () => { run.setIdle(false); return true; },
  });
  run.sessionStart();
  await run.command('worker');
  assert.deepEqual(run.calls.appendEntry, []);
  assert.equal(await run.toolCall({ agent: 'worker', model: 'deepseek/deepseek-flash' }), undefined);
});

test('an unreadable configuration cannot enable a disabled session', async () => {
  const run = setup({
    branch: [disabledEntry()],
    config: '{ this is not json',
    selectAnswers: ['Enable collaboration'],
  });
  run.sessionStart('resume');

  await run.command();

  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
  assert.ok(run.calls.notify.some((message) => /unreadable|invalid/i.test(message)));
  assert.equal(run.userRun(), undefined);
  assert.equal(await run.input(), undefined);
});

test('an unavailable configured role cannot be enabled with keep', async () => {
  const run = setup({
    branch: [disabledEntry()],
    config: { ...ROLE_CONFIG, worker: 'missing/model' },
    available: [CURRENT_MODEL, PLANNER_MODEL, WORKER_MODEL],
    selectAnswers: ['Enable collaboration', 'Keep this assignment'],
  });
  run.sessionStart('resume');

  await run.command();

  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
  assert.ok(run.calls.notify.some((message) => message.includes('missing/model')));
  assert.equal(run.userRun(), undefined);
});

test('a model becoming unavailable during enable confirmation does not commit', async () => {
  const available = [CURRENT_MODEL, PLANNER_MODEL, WORKER_MODEL];
  const run = setup({
    available,
    selectAnswers: [
      'Enable collaboration',
      'Modify roles',
      'worker — deepseek/deepseek-flash',
      'openai-codex/gpt-6-luna',
      'Done — enable with these role models',
    ],
    confirmAnswer: () => {
      available.splice(available.findIndex((model) => model.id === 'gpt-6-luna'), 1);
      return true;
    },
  });

  await run.command();

  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
  assert.ok(run.calls.notify.some((message) => message.includes('openai-codex/gpt-6-luna')));
  assert.equal(run.userRun(), undefined);
});

test('the command configures through dialogs in RPC mode', async () => {
  const run = setup({ mode: 'rpc', hasUI: true, selectAnswers: ['Enable collaboration', 'Keep this assignment'] });

  await run.command();

  assert.deepEqual(run.calls.appendEntry, [{ customType: 'model-collaboration', data: ROLE_CONFIG }]);
});

test('off wins over a pending enable confirmation', async () => {
  const answer = deferred();
  const run = setup({
    selectAnswers: [
      'Enable collaboration',
      'Modify roles',
      'worker — deepseek/deepseek-flash',
      'openai-codex/gpt-6-luna',
      'Done — enable with these role models',
    ],
    confirmAnswer: answer.promise,
  });
  const pending = run.command();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.dialogs.length, 1);

  await run.command('off');
  answer.resolve(true);
  await pending;

  assert.deepEqual(run.calls.appendEntry, [{ customType: 'model-collaboration', data: { disabled: true } }]);
  assert.deepEqual(run.calls.setModel, []);
  assert.equal(run.userRun(), undefined);
});

test('a branch change wins over a pending enable confirmation', async () => {
  const answer = deferred();
  const run = setup({
    selectAnswers: [
      'Enable collaboration',
      'Modify roles',
      'worker — deepseek/deepseek-flash',
      'openai-codex/gpt-6-luna',
      'Done — enable with these role models',
    ],
    confirmAnswer: answer.promise,
  });
  const pending = run.command();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.dialogs.length, 1);

  run.sessionTree();
  answer.resolve(true);
  await pending;

  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
  assert.equal(run.userRun(), undefined);
});

test('the parent becoming busy during enable confirmation cancels the commit', async () => {
  const run = setup({
    selectAnswers: [
      'Enable collaboration',
      'Modify roles',
      'worker — deepseek/deepseek-flash',
      'openai-codex/gpt-6-luna',
      'Done — enable with these role models',
    ],
    confirmAnswer: () => { run.setIdle(false); return true; },
  });

  await run.command();

  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
  assert.equal(run.userRun(), undefined);
});

test('/collaboration off after changing a role stops routing and model enforcement', async () => {
  const run = setup({ selectAnswers: ['openai-codex/gpt-6-luna', 'Only this session'] });
  await run.input();
  await run.command('worker');
  assert.equal(run.calls.appendEntry.at(-1).data.worker, 'openai-codex/gpt-6-luna');
  const switchesBeforeOff = run.calls.setModel.length;

  await run.command('off');
  assert.deepEqual(run.calls.appendEntry.at(-1), { customType: 'model-collaboration', data: { disabled: true } });
  assert.equal(run.calls.sendMessage.length, 1);
  const { message, options } = run.calls.sendMessage[0];
  assert.equal(message.customType, 'model-collaboration-revocation');
  assert.equal(message.display, false);
  assert.match(message.content, /disabled.*session/i);
  assert.match(message.content, /superseded/i);
  assert.deepEqual(options, { triggerTurn: false });
  assert.equal(await run.input('Continue without collaboration'), undefined);
  assert.equal(run.userRun(), undefined);
  assert.equal(run.calls.setModel.length, switchesBeforeOff);
  assert.equal(run.dialogs.length, 2, 'off and later prompts must not ask for consent');
  for (const input of [
    { agent: 'worker', model: 'deepseek/deepseek-flash' },
    { agent: 'reviewer', model: 'openai-codex/gpt-6-luna' },
    { workflow: 'parallel', args: { tasks: [] } },
    { action: 'resume', id: 'existing-run' },
  ]) assert.equal(await run.toolCall(input), undefined);
  const input = { agent: 'worker' };
  await run.toolCall(input);
  assert.equal(input.model, undefined, 'disabled collaboration must not fill in a role model');

  await run.command('off');
  assert.equal(run.calls.appendEntry.length, 3, 'repeated off is idempotent');
  assert.equal(run.calls.sendMessage.length, 1);
});

for (const options of [{}, { hasUI: false, idle: false, mode: 'print' }]) {
  test(`off works before initial consent (hasUI=${options.hasUI ?? true})`, async () => {
    const run = setup(options);
    await run.command('off');
    await run.input();
    assert.deepEqual(run.calls.appendEntry, [{ customType: 'model-collaboration', data: { disabled: true } }]);
    assert.deepEqual(run.dialogs, []);
    assert.deepEqual(run.calls.setModel, []);
    assert.equal(run.calls.sendMessage.length, 1);
  });
}

test('the enable/disable menu disables immediately without a confirmation', async () => {
  const run = setup({ selectAnswers: ['Disable collaboration'] });
  await run.input();
  const dialogsBefore = run.dialogs.length;

  await run.command();

  assert.deepEqual(run.calls.appendEntry.at(-1), { customType: 'model-collaboration', data: { disabled: true } });
  assert.equal(run.calls.sendMessage.length, 1);
  assert.equal(run.dialogs.length, dialogsBefore, 'disabling must not ask for confirmation');
  assert.equal(run.userRun(), undefined);
  assert.equal(await run.input(), undefined);
});

for (const args of ['worker', 'reviewer', 'planner']) {
  test(`role shortcuts cannot re-enable a disabled session (${args})`, async () => {
    const run = setup({ branch: [disabledEntry()] });
    run.sessionStart('resume');
    await run.command(args);
    assert.deepEqual(run.selections, []);
    assert.deepEqual(run.calls.appendEntry, []);
    assert.deepEqual(run.calls.setModel, []);
    assert.ok(run.calls.notify.some((message) => /disabled/i.test(message)));
    assert.equal(await run.input(), undefined);
    assert.deepEqual(run.dialogs, []);
  });
}

test('restoring off after a role change keeps collaboration disabled without another dialog', async () => {
  const run = setup({
    branch: [approvedEntry(), approvedEntry({ ...ROLE_CONFIG, worker: 'openai-codex/gpt-6-luna' }), disabledEntry()],
  });
  run.sessionStart('resume');
  assert.equal(await run.input(), undefined);
  assert.equal(run.userRun(), undefined);
  assert.deepEqual(run.dialogs, []);
  assert.deepEqual(run.calls.setModel, []);
  assert.equal(await run.toolCall({ agent: 'worker', model: 'deepseek/deepseek-flash' }), undefined);
  assert.equal(run.calls.sendMessage.length, 1, 'a missing revocation is restored');
});

for (const [name, branch, expectedMessages] of [
  ['present after disabled state', [disabledEntry(), revocationEntry()], 0],
  ['absent', [disabledEntry()], 1],
  ['before disabled state', [revocationEntry(), disabledEntry()], 1],
  ['before compaction', [disabledEntry(), revocationEntry(), { type: 'compaction' }], 1],
  ['after compaction', [disabledEntry(), { type: 'compaction' }, revocationEntry()], 0],
]) {
  test(`restoring a branch reasserts revocation only when needed: ${name}`, () => {
    const run = setup({ branch });
    run.sessionStart('resume');
    assert.equal(run.calls.sendMessage.length, expectedMessages);
    assert.equal(run.userRun(), undefined);
  });
}

test('compaction reasserts the revocation only in disabled sessions', async () => {
  const run = setup();
  run.emit('session_compact', { type: 'session_compact' });
  assert.deepEqual(run.calls.sendMessage, []);
  await run.input();
  run.emit('session_compact', { type: 'session_compact' });
  assert.deepEqual(run.calls.sendMessage, []);
  await run.command('off');
  run.emit('session_compact', { type: 'session_compact' });
  assert.equal(run.calls.sendMessage.length, 2);
  assert.match(run.calls.sendMessage.at(-1).message.content, /superseded/i);
});

test('rewinding off restores the updated role and a new session uses global defaults', async () => {
  const updated = { ...ROLE_CONFIG, worker: 'openai-codex/gpt-6-luna' };
  const run = setup({ branch: [approvedEntry(updated), disabledEntry()] });
  run.sessionStart('resume');
  assert.equal(run.userRun(), undefined);
  run.setBranch([approvedEntry(updated)]);
  run.sessionTree();
  assert.equal(await run.toolCall({ agent: 'worker', model: 'openai-codex/gpt-6-luna' }), undefined);
  assert.equal((await run.toolCall({ agent: 'worker', model: 'deepseek/deepseek-flash' }))?.block, true);
  assert.match(run.userRun().message.content, /openai-codex\/gpt-6-luna/);

  await run.command('off');
  run.setBranch([]);
  run.sessionStart('new');
  await run.input();
  assert.equal(run.dialogs.length, 1);
  assert.deepEqual(run.calls.appendEntry.at(-1).data, ROLE_CONFIG);
});

for (const stage of ['initial consent', 'model change']) {
  test(`off wins over pending ${stage} confirmation`, async () => {
    const answer = deferred();
    const run = setup({
      branch: stage === 'model change' ? [approvedEntry()] : [],
      selectAnswers: ['openai-codex/gpt-6-luna'], confirmAnswer: answer.promise,
    });
    run.sessionStart();
    const pending = stage === 'initial consent' ? run.input() : run.command('worker');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(run.dialogs.length, 1);
    await run.command('off');
    answer.resolve(true);
    await pending;
    assert.deepEqual(run.calls.appendEntry, [{ customType: 'model-collaboration', data: { disabled: true } }]);
    assert.deepEqual(run.calls.setModel, []);
    assert.equal(run.userRun(), undefined);
    assert.equal(await run.toolCall({ agent: 'worker', model: 'deepseek/deepseek-flash' }), undefined);
  });
}

// A repeated off while disabled must cancel an in-flight re-enable without recording another
// disabled state or sending a second revocation.
for (const stage of ['keep', 'modify']) {
  test(`a repeated off invalidates a pending ${stage} re-enable from a disabled session`, async () => {
    const run = setup({
      branch: [disabledEntry()],
      selectAnswers: stage === 'keep'
        ? [
            'Enable collaboration',
            async () => { await run.command('off'); return 'Keep this assignment'; },
          ]
        : [
            'Enable collaboration',
            'Modify roles',
            async () => { await run.command('off'); return 'Done — enable with these role models'; },
          ],
    });
    run.sessionStart('resume');
    const revocations = run.calls.sendMessage.length;

    await run.command();

    assert.deepEqual(run.calls.appendEntry, []);
    assert.deepEqual(run.calls.setModel, []);
    assert.equal(run.calls.sendMessage.length, revocations, 'no duplicate revocation');
    assert.ok(run.calls.notify.some((message) => /changed; change cancelled/i.test(message)));
  });
}

test('a repeated off invalidates a pending re-enable confirmation from a disabled session', async () => {
  const answer = deferred();
  const run = setup({
    branch: [disabledEntry()],
    selectAnswers: [
      'Enable collaboration',
      'Modify roles',
      'worker — deepseek/deepseek-flash',
      'openai-codex/gpt-6-luna',
      'Done — enable with these role models',
    ],
    confirmAnswer: answer.promise,
  });
  run.sessionStart('resume');
  const revocations = run.calls.sendMessage.length;

  const pending = run.command();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.dialogs.length, 1);
  await run.command('off');
  answer.resolve(true);
  await pending;

  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
  assert.equal(run.calls.sendMessage.length, revocations, 'no duplicate revocation');
});

test('the menu disable invalidates a pending re-enable without a duplicate disabled state', async () => {
  const run = setup({
    branch: [disabledEntry()],
    selectAnswers: [
      'Enable collaboration',
      async () => { await run.command(); return 'Keep this assignment'; },
      'Disable collaboration',
    ],
  });
  run.sessionStart('resume');
  const revocations = run.calls.sendMessage.length;

  await run.command();

  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
  assert.equal(run.calls.sendMessage.length, revocations, 'no duplicate revocation');
  assert.ok(run.calls.notify.some((message) => /already disabled/i.test(message)));
});

test('the enable/disable menu cancels a disable when the session changed while its dialog was open', async () => {
  const run = setup({
    selectAnswers: [async () => { run.sessionTree(); return 'Disable collaboration'; }],
  });

  await run.command();

  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.sendMessage, []);
  assert.ok(run.calls.notify.some((message) => /changed; change cancelled/i.test(message)));
});

test('the enable/disable menu disables while the parent is busy', async () => {
  const run = setup({ idle: false, selectAnswers: ['Disable collaboration'] });

  await run.command();

  assert.deepEqual(run.calls.appendEntry, [{ customType: 'model-collaboration', data: { disabled: true } }]);
});

test('the enable/disable menu cancels an enable when the session changed while its dialog was open', async () => {
  const run = setup({
    selectAnswers: [async () => { run.sessionTree(); return 'Enable collaboration'; }, 'Keep this assignment'],
  });

  await run.command();

  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
  assert.equal(run.selections.length, 1, 'the keep/modify dialog must not open on the new session');
  assert.ok(run.calls.notify.some((message) => /changed; change cancelled/i.test(message)));
});

test('a branch change during the planner switch restores the previous parent model', async () => {
  const gate = deferred();
  const run = setup({
    branch: [approvedEntry()],
    selectAnswers: ['deepseek/deepseek-flash', 'Only this session'],
    setModelGate: gate.promise,
  });
  run.sessionStart('resume');

  const pending = run.command('planner');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(run.calls.setModel.map((model) => `${model.provider}/${model.id}`), ['deepseek/deepseek-flash']);
  run.sessionTree();
  gate.resolve();
  await pending;

  assert.deepEqual(
    run.calls.setModel.map((model) => `${model.provider}/${model.id}`),
    ['deepseek/deepseek-flash', 'openai-codex/gpt-6-luna'],
  );
  assert.deepEqual(run.calls.appendEntry, []);
  assert.ok(run.calls.notify.some((message) => /changed; change cancelled/i.test(message)));
});

test('a busy parent during the planner switch restores the previous parent model', async () => {
  const gate = deferred();
  const run = setup({
    branch: [approvedEntry()],
    selectAnswers: ['deepseek/deepseek-flash', 'Only this session'],
    setModelGate: gate.promise,
  });
  run.sessionStart('resume');

  const pending = run.command('planner');
  await new Promise((resolve) => setImmediate(resolve));
  run.setIdle(false);
  gate.resolve();
  await pending;

  assert.deepEqual(
    run.calls.setModel.map((model) => `${model.provider}/${model.id}`),
    ['deepseek/deepseek-flash', 'openai-codex/gpt-6-luna'],
  );
  assert.deepEqual(run.calls.appendEntry, []);
});

test('a failed rollback reports that the parent model remains switched', async () => {
  const gate = deferred();
  const run = setup({
    branch: [approvedEntry()],
    selectAnswers: ['deepseek/deepseek-flash', 'Only this session'],
    setModelGate: gate.promise,
    setModelOutcomes: [true, false],
  });
  run.sessionStart('resume');

  const pending = run.command('planner');
  await new Promise((resolve) => setImmediate(resolve));
  run.sessionTree();
  gate.resolve();
  await pending;

  assert.deepEqual(
    run.calls.setModel.map((model) => `${model.provider}/${model.id}`),
    ['deepseek/deepseek-flash', 'openai-codex/gpt-6-luna'],
  );
  assert.ok(run.calls.notify.some((message) => /restoring the previous parent model .* failed/i.test(message)));
  assert.deepEqual(run.calls.appendEntry, []);
});

test('a planner switch cancelled after a newer model choice is not rolled back', async () => {
  const gate = deferred();
  const run = setup({
    branch: [approvedEntry()],
    selectAnswers: ['deepseek/deepseek-flash', 'Only this session'],
    setModelGate: gate.promise,
  });
  run.sessionStart('resume');

  const pending = run.command('planner');
  await new Promise((resolve) => setImmediate(resolve));
  run.setCurrentModel(PLANNER_MODEL);
  run.sessionTree();
  gate.resolve();
  await pending;

  assert.deepEqual(
    run.calls.setModel.map((model) => `${model.provider}/${model.id}`),
    ['deepseek/deepseek-flash'],
    'a newer parent model choice must win over the rollback',
  );
  assert.deepEqual(run.calls.appendEntry, []);
});

test('a role shortcut keeps the session-only default and never writes global defaults', async () => {
  const configPath = configFile({ ...ROLE_CONFIG, projectNote: 'keep' });
  const before = readFileSync(configPath, 'utf8');
  const run = setup({
    configPath,
    branch: [approvedEntry()],
    selectAnswers: ['openai-codex/gpt-6-luna', 'Only this session'],
  });
  run.sessionStart('resume');

  await run.command('worker');

  assert.deepEqual(run.selections.at(-1).options, ['Only this session', 'Also save as global defaults']);
  assert.equal(readFileSync(configPath, 'utf8'), before, 'session-only changes never write global defaults');
  assert.deepEqual(run.calls.appendEntry, [{
    customType: 'model-collaboration',
    data: { ...ROLE_CONFIG, worker: 'openai-codex/gpt-6-luna' },
  }]);
});

test('a role shortcut can save all three roles as global defaults and preserve unrelated keys', async () => {
  const configPath = configFile({ ...ROLE_CONFIG, projectNote: 'keep' });
  const run = setup({
    configPath,
    branch: [approvedEntry()],
    selectAnswers: ['openai-codex/gpt-6-luna', 'Also save as global defaults'],
    confirmAnswers: [true, true],
  });
  run.sessionStart('resume');

  await run.command('worker');

  const updated = { ...ROLE_CONFIG, worker: 'openai-codex/gpt-6-luna' };
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), { ...updated, projectNote: 'keep' });
  assert.deepEqual(run.calls.appendEntry, [{ customType: 'model-collaboration', data: updated }]);
  const confirmation = run.dialogs.at(-1);
  assert.match(confirmation.title, /global/i);
  assert.ok(confirmation.message.includes(configPath));
  for (const model of Object.values(updated)) assert.ok(confirmation.message.includes(model));
  assert.match(confirmation.message, /new sessions/i);
  assert.match(confirmation.message, /not enabled globally/i);
  assert.match(confirmation.message, /session role change is applied only if this save succeeds/i);
});

test('the planner shortcut can save the new parent model as a global default', async () => {
  const configPath = configFile(ROLE_CONFIG);
  const run = setup({
    configPath,
    branch: [approvedEntry()],
    selectAnswers: ['deepseek/deepseek-flash', 'Also save as global defaults'],
    confirmAnswers: [true, true],
  });
  run.sessionStart('resume');

  await run.command('planner');

  const updated = { ...ROLE_CONFIG, planner: 'deepseek/deepseek-flash' };
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), updated);
  assert.deepEqual(run.calls.appendEntry, [{ customType: 'model-collaboration', data: updated }]);
  assert.deepEqual(
    run.calls.setModel.map((model) => `${model.provider}/${model.id}`),
    ['deepseek/deepseek-flash'],
  );
});

test('the full modify flow can save the changed assignment as global defaults', async () => {
  const configPath = configFile({ worker: 'deepseek/deepseek-flash', projectNote: 'keep' });
  const run = setup({
    configPath,
    selectAnswers: [
      'Enable collaboration',
      'Modify roles',
      'worker — deepseek/deepseek-flash',
      'openai-codex/gpt-6-sol',
      'Done — enable with these role models',
      'Also save as global defaults',
    ],
    confirmAnswers: [true, true],
  });

  await run.command();

  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    planner: 'openai-codex/gpt-6-luna',
    worker: 'openai-codex/gpt-6-sol',
    reviewer: 'deepseek/deepseek-flash',
    projectNote: 'keep',
  });
  assert.deepEqual(run.calls.appendEntry, [{
    customType: 'model-collaboration',
    data: {
      planner: 'openai-codex/gpt-6-luna',
      worker: 'openai-codex/gpt-6-sol',
      reviewer: 'deepseek/deepseek-flash',
    },
  }]);
});

test('a failed global save during the full modify flow leaves collaboration disabled', async () => {
  const configPath = configFile(ROLE_CONFIG);
  const malformed = '{ this is not json';
  const run = setup({
    configPath,
    selectAnswers: [
      'Enable collaboration',
      'Modify roles',
      'worker — deepseek/deepseek-flash',
      'openai-codex/gpt-6-sol',
      'Done — enable with these role models',
      'Also save as global defaults',
    ],
    confirmAnswers: [() => {
      writeFileSync(configPath, malformed);
      return true;
    }],
  });

  await run.command();

  assert.equal(readFileSync(configPath, 'utf8'), malformed);
  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
  assert.ok(run.calls.notify.some((message) => /unreadable or invalid/i.test(message)));
  assert.equal((await run.toolCall({ agent: 'worker', model: ROLE_CONFIG.worker }))?.block, true);
});

test('the collaboration menu saves the active assignment without changing the session', async () => {
  const updated = { ...ROLE_CONFIG, reviewer: 'openai-codex/gpt-6-luna' };
  const configPath = configFile({ ...ROLE_CONFIG, projectNote: 'keep' });
  const run = setup({
    configPath,
    branch: [approvedEntry(updated)],
    selectAnswers: ['Save current assignment as global defaults'],
  });
  run.sessionStart('resume');
  const entriesBefore = run.calls.appendEntry.length;

  await run.command();

  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), { ...updated, projectNote: 'keep' });
  assert.equal(run.calls.appendEntry.length, entriesBefore);
  assert.deepEqual(run.calls.setModel, []);
  assert.match(run.dialogs.at(-1).message, /keeps its current assignment/i);
  assert.match(run.userRun().message.content, /openai-codex\/gpt-6-luna/);
  assert.deepEqual(run.selections[0].options.slice(0, 2), ['Enable collaboration', 'Disable collaboration']);
  assert.equal(run.selections[0].options[2], 'Save current assignment as global defaults');
});

test('the collaboration menu omits the global save option before an assignment is active', async () => {
  const run = setup({ selectAnswers: [undefined] });
  await run.command();
  assert.deepEqual(run.selections[0].options, ['Enable collaboration', 'Disable collaboration']);

  const disabled = setup({ branch: [disabledEntry()], selectAnswers: [undefined] });
  disabled.sessionStart('resume');
  await disabled.command();
  assert.deepEqual(disabled.selections[0].options, ['Enable collaboration', 'Disable collaboration']);
});

test('saved global defaults apply to a new session without enabling collaboration', async () => {
  const updated = { ...ROLE_CONFIG, worker: 'openai-codex/gpt-6-sol' };
  const configPath = configFile(ROLE_CONFIG);
  const active = setup({
    configPath,
    branch: [approvedEntry(updated)],
    selectAnswers: ['Save current assignment as global defaults'],
  });
  active.sessionStart('resume');
  await active.command();
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), updated);

  const fresh = setup({ configPath });
  assert.equal(await fresh.userRun(), undefined, 'saved defaults are not global consent');
  assert.equal((await fresh.toolCall({ agent: 'worker', model: updated.worker }))?.block, true);
  const result = await fresh.input('Implement the task');
  assert.notEqual(result?.action, 'handled');
  assert.equal(fresh.dialogs.length, 1);
  assert.ok(fresh.dialogs[0].message.includes(updated.worker));
  assert.deepEqual(fresh.calls.appendEntry, [{ customType: 'model-collaboration', data: updated }]);
});

test('saving global defaults does not change an existing approved session', async () => {
  const configPath = configFile(ROLE_CONFIG);
  const saved = { ...ROLE_CONFIG, worker: 'openai-codex/gpt-6-sol' };
  const existing = setup({ configPath, branch: [approvedEntry()] });
  existing.sessionStart('resume');
  const other = setup({
    configPath,
    branch: [approvedEntry(saved)],
    selectAnswers: ['Save current assignment as global defaults'],
  });
  other.sessionStart('resume');

  await other.command();

  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), saved);
  assert.equal(await existing.toolCall({ agent: 'worker', model: 'deepseek/deepseek-flash' }), undefined);
  assert.equal((await existing.toolCall({ agent: 'worker', model: 'openai-codex/gpt-6-sol' }))?.block, true);
  assert.match(existing.userRun().message.content, /deepseek\/deepseek-flash/);
  assert.deepEqual(existing.calls.appendEntry, []);
  assert.deepEqual(existing.calls.setModel, []);
});

test('cancelling the save scope leaves the session and global defaults unchanged', async () => {
  const configPath = configFile(ROLE_CONFIG);
  const before = readFileSync(configPath, 'utf8');
  const run = setup({
    configPath,
    branch: [approvedEntry()],
    selectAnswers: ['openai-codex/gpt-6-luna', undefined],
  });
  run.sessionStart('resume');

  await run.command('worker');

  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
  assert.equal(readFileSync(configPath, 'utf8'), before);
});

test('cancelling the global defaults confirmation leaves the session and file unchanged', async () => {
  const configPath = configFile(ROLE_CONFIG);
  const before = readFileSync(configPath, 'utf8');
  const run = setup({
    configPath,
    branch: [approvedEntry()],
    selectAnswers: ['openai-codex/gpt-6-luna', 'Also save as global defaults'],
    confirmAnswers: [true, false],
  });
  run.sessionStart('resume');

  await run.command('worker');

  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
  assert.equal(readFileSync(configPath, 'utf8'), before);
});

for (const [name, directories] of [
  ['a missing directory and file', ['nested', 'agent']],
  ['a missing file in an existing directory', []],
]) {
  test(`a global save creates ${name}`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'model-collaboration-missing-'));
    tempDirs.push(root);
    const configPath = join(root, ...directories, 'model-collaboration.json');
    const run = setup({
      configPath,
      branch: [approvedEntry()],
      selectAnswers: ['Save current assignment as global defaults'],
    });
    run.sessionStart('resume');

    await run.command();

    assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), ROLE_CONFIG);
    assert.equal(statSync(configPath).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(configPath)).mode & 0o777, 0o700);
    assert.deepEqual(readdirSync(dirname(configPath)), ['model-collaboration.json']);
  });
}

test('a global save preserves an existing file mode and leaves no temporary file', async () => {
  const configPath = configFile(ROLE_CONFIG);
  chmodSync(configPath, 0o640);
  const run = setup({
    configPath,
    branch: [approvedEntry()],
    selectAnswers: ['Save current assignment as global defaults'],
  });
  run.sessionStart('resume');

  await run.command();

  assert.equal(statSync(configPath).mode & 0o777, 0o640);
  assert.deepEqual(readdirSync(dirname(configPath)), ['roles.json']);
});

test('a global save refuses a malformed existing configuration without changing it', async () => {
  const configPath = configFile('{ this is not json');
  const before = readFileSync(configPath, 'utf8');
  const run = setup({
    configPath,
    branch: [approvedEntry()],
    selectAnswers: ['openai-codex/gpt-6-luna', 'Also save as global defaults'],
    confirmAnswers: [true],
  });
  run.sessionStart('resume');

  await run.command('worker');

  assert.equal(readFileSync(configPath, 'utf8'), before);
  assert.deepEqual(run.calls.appendEntry, []);
  assert.equal(await run.toolCall({ agent: 'worker', model: 'deepseek/deepseek-flash' }), undefined);
  assert.ok(run.calls.notify.some((message) => /unreadable or invalid/i.test(message)));
  assert.equal(run.dialogs.length, 1, 'the global save is refused before its confirmation');
});

test('a global save refuses an unreadable configuration path without changing it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'model-collaboration-unreadable-'));
  tempDirs.push(root);
  const run = setup({
    configPath: root,
    branch: [approvedEntry()],
    selectAnswers: ['Save current assignment as global defaults'],
  });
  run.sessionStart('resume');

  await run.command();

  assert.ok(statSync(root).isDirectory());
  assert.deepEqual(readdirSync(root), []);
  assert.ok(run.calls.notify.some((message) => /unreadable or invalid/i.test(message)));
});

test('a failed global write leaves the session assignment and old configuration intact', async (t) => {
  if (process.getuid?.() === 0) {
    t.skip('root bypasses directory permissions');
    return;
  }
  const root = mkdtempSync(join(tmpdir(), 'model-collaboration-readonly-'));
  tempDirs.push(root);
  const configPath = join(root, 'roles.json');
  writeFileSync(configPath, JSON.stringify(ROLE_CONFIG));
  chmodSync(root, 0o500);
  try {
    const run = setup({
      configPath,
      branch: [approvedEntry()],
      selectAnswers: ['openai-codex/gpt-6-luna', 'Also save as global defaults'],
      confirmAnswers: [true, true],
    });
    run.sessionStart('resume');

    await run.command('worker');

    assert.equal(readFileSync(configPath, 'utf8'), JSON.stringify(ROLE_CONFIG));
    assert.deepEqual(run.calls.appendEntry, []);
    assert.deepEqual(run.calls.setModel, []);
    assert.ok(run.calls.notify.some((message) => /could not save/i.test(message)));
    assert.equal(await run.toolCall({ agent: 'worker', model: 'deepseek/deepseek-flash' }), undefined);
    assert.equal((await run.toolCall({ agent: 'worker', model: 'openai-codex/gpt-6-luna' }))?.block, true);
  } finally {
    chmodSync(root, 0o700);
  }
});

test('a global save merges an unrelated configuration edit made during confirmation', async () => {
  const updated = { ...ROLE_CONFIG, worker: 'openai-codex/gpt-6-luna' };
  const configPath = configFile(ROLE_CONFIG);
  const run = setup({
    configPath,
    branch: [approvedEntry(updated)],
    selectAnswers: ['Save current assignment as global defaults'],
    confirmAnswer: () => {
      const current = JSON.parse(readFileSync(configPath, 'utf8'));
      writeFileSync(configPath, JSON.stringify({ ...current, addedDuringConfirmation: true }));
      return true;
    },
  });
  run.sessionStart('resume');

  await run.command();

  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    ...updated,
    addedDuringConfirmation: true,
  });
});

test('a global save refuses to overwrite a role changed during confirmation', async () => {
  const updated = { ...ROLE_CONFIG, worker: 'openai-codex/gpt-6-luna' };
  const externallyChanged = { ...ROLE_CONFIG, worker: 'openai-codex/gpt-6-sol' };
  const configPath = configFile(ROLE_CONFIG);
  const run = setup({
    configPath,
    branch: [approvedEntry(updated)],
    selectAnswers: ['Save current assignment as global defaults'],
    confirmAnswer: () => {
      writeFileSync(configPath, JSON.stringify(externallyChanged));
      return true;
    },
  });
  run.sessionStart('resume');

  await run.command();

  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), externallyChanged);
  assert.ok(run.calls.notify.some((message) => /changed while the confirmation was open/i.test(message)));
  assert.deepEqual(run.calls.appendEntry, []);
});

for (const [name, race] of [
  ['a branch change', (run) => run.sessionTree()],
  ['off', async (run) => { await run.command('off'); }],
  ['a busy parent', (run) => run.setIdle(false)],
]) {
  test(`a pending global save is cancelled by ${name}`, async () => {
    const updated = { ...ROLE_CONFIG, worker: 'openai-codex/gpt-6-luna' };
    const configPath = configFile(ROLE_CONFIG);
    const before = readFileSync(configPath, 'utf8');
    const answer = deferred();
    const run = setup({
      configPath,
      branch: [approvedEntry(updated)],
      selectAnswers: ['Save current assignment as global defaults'],
      confirmAnswer: answer.promise,
    });
    run.sessionStart('resume');

    const pending = run.command();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(run.dialogs.length, 1);
    await race(run);
    answer.resolve(true);
    await pending;

    assert.equal(readFileSync(configPath, 'utf8'), before);
    assert.ok(run.calls.notify.some((message) => /changed; change cancelled/i.test(message)));
  });
}

test('a branch change during the global confirmation prevents the role change and the save', async () => {
  const configPath = configFile(ROLE_CONFIG);
  const before = readFileSync(configPath, 'utf8');
  const answer = deferred();
  const run = setup({
    configPath,
    branch: [approvedEntry()],
    selectAnswers: ['openai-codex/gpt-6-luna', 'Also save as global defaults'],
    confirmAnswers: [true, answer.promise],
  });
  run.sessionStart('resume');

  const pending = run.command('worker');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.dialogs.length, 2);
  run.sessionTree();
  answer.resolve(true);
  await pending;

  assert.equal(readFileSync(configPath, 'utf8'), before);
  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
});

test('enabling and disabling collaboration never write global defaults', async () => {
  const configPath = configFile(ROLE_CONFIG);
  const before = readFileSync(configPath, 'utf8');
  const run = setup({ configPath });
  await run.input();
  await run.command('off');
  assert.equal(readFileSync(configPath, 'utf8'), before);

  const enabled = setup({ configPath, selectAnswers: ['Enable collaboration', 'Keep this assignment'] });
  await enabled.command();
  assert.equal(readFileSync(configPath, 'utf8'), before);
});

test('a global save refuses to replace a symlinked configuration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'model-collaboration-symlink-'));
  tempDirs.push(root);
  const target = join(root, 'target.json');
  writeFileSync(target, JSON.stringify(ROLE_CONFIG));
  const configPath = join(root, 'roles.json');
  symlinkSync(target, configPath);
  const run = setup({
    configPath,
    branch: [approvedEntry()],
    selectAnswers: ['Save current assignment as global defaults'],
  });
  run.sessionStart('resume');

  await run.command();

  assert.ok(lstatSync(configPath).isSymbolicLink(), 'the path must remain a symlink');
  assert.equal(readFileSync(target, 'utf8'), JSON.stringify(ROLE_CONFIG));
  assert.ok(run.calls.notify.some((message) => /could not save/i.test(message)));
});

// The global file must never run ahead of the session change: the planner switch happens between
// preparing the save and committing it, so every failure below has to leave the file byte-identical.
test('a planner shortcut global save leaves the file untouched when the planner switch fails', async () => {
  const configPath = configFile({ ...ROLE_CONFIG, projectNote: 'keep' });
  const before = readFileSync(configPath, 'utf8');
  const run = setup({
    configPath,
    branch: [approvedEntry()],
    selectAnswers: ['deepseek/deepseek-flash', 'Also save as global defaults'],
    confirmAnswers: [true, true],
    setModelResult: false,
  });
  run.sessionStart('resume');

  await run.command('planner');

  assert.equal(readFileSync(configPath, 'utf8'), before, 'a cancelled change must not rewrite global defaults');
  assert.deepEqual(run.calls.appendEntry, []);
  assert.ok(run.calls.notify.some((message) => /could not switch/i.test(message)));
  assert.ok(!run.calls.notify.some((message) => /saved global defaults/i.test(message)), 'no success toast');
});

test('a failed planner switch during the full modify flow leaves global defaults unchanged', async () => {
  const configPath = configFile({ ...ROLE_CONFIG, projectNote: 'keep' });
  const before = readFileSync(configPath, 'utf8');
  const run = setup({
    configPath,
    selectAnswers: [
      'Enable collaboration',
      'Modify roles',
      'worker — deepseek/deepseek-flash',
      'openai-codex/gpt-6-sol',
      'Done — enable with these role models',
      'Also save as global defaults',
    ],
    confirmAnswers: [true, true],
    setModelResult: false,
  });

  await run.command();

  assert.equal(readFileSync(configPath, 'utf8'), before, 'a cancelled change must not rewrite global defaults');
  assert.deepEqual(run.calls.appendEntry, []);
  assert.ok(run.calls.notify.some((message) => /could not switch/i.test(message)));
  assert.ok(!run.calls.notify.some((message) => /saved global defaults/i.test(message)), 'no success toast');
});

for (const [name, race] of [
  ['off', async (run) => { await run.command('off'); }],
  ['a branch change', (run) => run.sessionTree()],
  ['a busy parent', (run) => run.setIdle(false)],
]) {
  test(`a pending global planner save is cancelled by ${name} during the model switch`, async () => {
    const configPath = configFile(ROLE_CONFIG);
    const before = readFileSync(configPath, 'utf8');
    const gate = deferred();
    const run = setup({
      configPath,
      branch: [approvedEntry()],
      selectAnswers: ['deepseek/deepseek-flash', 'Also save as global defaults'],
      confirmAnswers: [true, true],
      setModelGate: gate.promise,
    });
    run.sessionStart('resume');

    const pending = run.command('planner');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(run.calls.setModel.length, 1, 'the planner switch must be pending');
    await race(run);
    gate.resolve();
    await pending;

    assert.equal(readFileSync(configPath, 'utf8'), before, 'no global save after a cancelled switch');
    assert.ok(
      !run.calls.appendEntry.some((entry) => entry.data?.planner !== undefined),
      'the session assignment is unchanged',
    );
    assert.ok(!run.calls.notify.some((message) => /saved global defaults/i.test(message)), 'no success toast');
  });
}

test('a failed global write after the planner switch restores the original model and configuration', async (t) => {
  if (process.getuid?.() === 0) {
    t.skip('root bypasses directory permissions');
    return;
  }
  const root = mkdtempSync(join(tmpdir(), 'model-collaboration-switch-write-'));
  tempDirs.push(root);
  const configPath = join(root, 'roles.json');
  writeFileSync(configPath, JSON.stringify(ROLE_CONFIG));
  const before = readFileSync(configPath, 'utf8');
  const gate = deferred();
  try {
    const run = setup({
      configPath,
      branch: [approvedEntry()],
      selectAnswers: ['deepseek/deepseek-flash', 'Also save as global defaults'],
      confirmAnswers: [true, true],
      setModelGate: gate.promise,
    });
    run.sessionStart('resume');

    const pending = run.command('planner');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(run.calls.setModel.length, 1);
    chmodSync(root, 0o500);
    gate.resolve();
    await pending;

    assert.equal(readFileSync(configPath, 'utf8'), before, 'the old configuration stays intact');
    assert.deepEqual(run.calls.appendEntry, []);
    assert.ok(run.calls.notify.some((message) => /could not save/i.test(message)));
    assert.deepEqual(
      run.calls.setModel.map((model) => `${model.provider}/${model.id}`),
      ['deepseek/deepseek-flash', 'openai-codex/gpt-6-luna'],
      'the cancelled planner switch is rolled back',
    );
  } finally {
    chmodSync(root, 0o700);
  }
});

test('a role changed by another process during the planner switch aborts and rolls back', async () => {
  const configPath = configFile(ROLE_CONFIG);
  const external = { ...ROLE_CONFIG, worker: 'deepseek/deepseek-chat' };
  const gate = deferred();
  const run = setup({
    configPath,
    branch: [approvedEntry()],
    selectAnswers: ['deepseek/deepseek-flash', 'Also save as global defaults'],
    confirmAnswers: [true, true],
    setModelGate: gate.promise,
  });
  run.sessionStart('resume');

  const pending = run.command('planner');
  await new Promise((resolve) => setImmediate(resolve));
  writeFileSync(configPath, JSON.stringify(external));
  gate.resolve();
  await pending;

  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), external, 'the external role edit wins');
  assert.deepEqual(run.calls.appendEntry, []);
  assert.ok(run.calls.notify.some((message) => /global role defaults changed/i.test(message)));
  assert.deepEqual(
    run.calls.setModel.map((model) => `${model.provider}/${model.id}`),
    ['deepseek/deepseek-flash', 'openai-codex/gpt-6-luna'],
    'the cancelled planner switch is rolled back',
  );
});

test('a configuration path change during the planner switch aborts the save', async () => {
  const configPath = configFile(ROLE_CONFIG);
  const before = readFileSync(configPath, 'utf8');
  const otherPath = configFile(ROLE_CONFIG);
  const otherBefore = readFileSync(otherPath, 'utf8');
  const gate = deferred();
  const run = setup({
    configPath,
    branch: [approvedEntry()],
    selectAnswers: ['deepseek/deepseek-flash', 'Also save as global defaults'],
    confirmAnswers: [true, true],
    setModelGate: gate.promise,
  });
  run.sessionStart('resume');

  const pending = run.command('planner');
  await new Promise((resolve) => setImmediate(resolve));
  process.env.PI_MODEL_COLLABORATION_CONFIG = otherPath;
  gate.resolve();
  await pending;

  assert.equal(readFileSync(configPath, 'utf8'), before, 'the confirmed target is unchanged');
  assert.equal(readFileSync(otherPath, 'utf8'), otherBefore, 'the new target is unchanged');
  assert.deepEqual(run.calls.appendEntry, []);
  assert.ok(run.calls.notify.some((message) => /configuration path changed/i.test(message)));
  assert.deepEqual(
    run.calls.setModel.map((model) => `${model.provider}/${model.id}`),
    ['deepseek/deepseek-flash', 'openai-codex/gpt-6-luna'],
    'the cancelled planner switch is rolled back',
  );
});

test('an unrelated configuration edit during the planner switch is merged', async () => {
  const configPath = configFile({ ...ROLE_CONFIG, projectNote: 'keep' });
  const gate = deferred();
  const run = setup({
    configPath,
    branch: [approvedEntry()],
    selectAnswers: ['deepseek/deepseek-flash', 'Also save as global defaults'],
    confirmAnswers: [true, true],
    setModelGate: gate.promise,
  });
  run.sessionStart('resume');

  const pending = run.command('planner');
  await new Promise((resolve) => setImmediate(resolve));
  const current = JSON.parse(readFileSync(configPath, 'utf8'));
  writeFileSync(configPath, JSON.stringify({ ...current, addedDuringSwitch: true }));
  gate.resolve();
  await pending;

  const updated = { ...ROLE_CONFIG, planner: 'deepseek/deepseek-flash' };
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    ...updated,
    projectNote: 'keep',
    addedDuringSwitch: true,
  });
  assert.deepEqual(run.calls.appendEntry, [{ customType: 'model-collaboration', data: updated }]);
});

// Model availability can change while the save-scope or global confirmation dialogs are open.
test('a model removed while the session scope dialog is open is not applied', async () => {
  const available = [CURRENT_MODEL, PLANNER_MODEL, WORKER_MODEL];
  const configPath = configFile(ROLE_CONFIG);
  const before = readFileSync(configPath, 'utf8');
  const run = setup({
    configPath,
    available,
    branch: [approvedEntry()],
    selectAnswers: [
      'openai-codex/gpt-6-sol',
      () => { available.splice(available.indexOf(PLANNER_MODEL), 1); return 'Only this session'; },
    ],
  });
  run.sessionStart('resume');

  await run.command('worker');

  assert.equal(readFileSync(configPath, 'utf8'), before);
  assert.deepEqual(run.calls.appendEntry, []);
  assert.ok(run.calls.notify.some((message) => /unavailable worker model/i.test(message)));
});

test('a model removed while the global scope dialog is open is not saved', async () => {
  const available = [CURRENT_MODEL, PLANNER_MODEL, WORKER_MODEL, DEEPSEEK_CHAT];
  const configPath = configFile(ROLE_CONFIG);
  const before = readFileSync(configPath, 'utf8');
  const run = setup({
    configPath,
    available,
    extraModels: [DEEPSEEK_CHAT],
    branch: [approvedEntry()],
    selectAnswers: [
      'deepseek/deepseek-chat',
      () => { available.splice(available.indexOf(DEEPSEEK_CHAT), 1); return 'Also save as global defaults'; },
    ],
    confirmAnswers: [true, true],
  });
  run.sessionStart('resume');

  await run.command('worker');

  assert.equal(readFileSync(configPath, 'utf8'), before, 'nothing is saved globally');
  assert.deepEqual(run.calls.appendEntry, []);
  assert.ok(run.calls.notify.some((message) => /unavailable role model \(worker=deepseek\/deepseek-chat\)/i.test(message)));
});

test('a model removed while the global confirmation is open is not saved', async () => {
  const available = [CURRENT_MODEL, PLANNER_MODEL, WORKER_MODEL, DEEPSEEK_CHAT];
  const configPath = configFile(ROLE_CONFIG);
  const before = readFileSync(configPath, 'utf8');
  const run = setup({
    configPath,
    available,
    extraModels: [DEEPSEEK_CHAT],
    branch: [approvedEntry()],
    selectAnswers: ['deepseek/deepseek-chat', 'Also save as global defaults'],
    confirmAnswers: [true, () => { available.splice(available.indexOf(DEEPSEEK_CHAT), 1); return true; }],
  });
  run.sessionStart('resume');

  await run.command('worker');

  assert.equal(readFileSync(configPath, 'utf8'), before, 'nothing is saved globally');
  assert.deepEqual(run.calls.appendEntry, []);
  assert.ok(run.calls.notify.some((message) => /unavailable role model \(worker=deepseek\/deepseek-chat\)/i.test(message)));
});

test('the menu refuses to save an assignment whose model became unavailable', async () => {
  const available = [CURRENT_MODEL, PLANNER_MODEL, WORKER_MODEL, DEEPSEEK_CHAT];
  const stale = { ...ROLE_CONFIG, reviewer: 'deepseek/deepseek-chat' };
  const configPath = configFile(ROLE_CONFIG);
  const before = readFileSync(configPath, 'utf8');
  const run = setup({
    configPath,
    available,
    extraModels: [DEEPSEEK_CHAT],
    branch: [approvedEntry(stale)],
    selectAnswers: [
      () => { available.splice(available.indexOf(DEEPSEEK_CHAT), 1); return 'Save current assignment as global defaults'; },
    ],
    confirmAnswer: true,
  });
  run.sessionStart('resume');

  await run.command();

  assert.equal(readFileSync(configPath, 'utf8'), before, 'a stale assignment is never persisted');
  assert.deepEqual(run.calls.appendEntry, []);
  assert.ok(run.calls.notify.some((message) => /unavailable role model \(reviewer=deepseek\/deepseek-chat\)/i.test(message)));
  assert.ok(!run.calls.notify.some((message) => /saved global defaults/i.test(message)), 'no success toast');
});

test('the real TUI picker enables all three roles through search, modify, and Done', async (t) => {
  const environment = await tuiEnvironmentOrSkip(t);
  if (!environment) return;
  const drive = (...keys) => (component) => {
    component.focused = true;
    for (const key of keys) component.handleInput(key);
  };
  const run = setup({
    extension: environment.modelCollaboration,
    custom: true,
    customKeybindings: environment.keybindings,
    selectAnswers: ['Only this session'],
    customScripts: [
      drive(TUI_KEYS.enter),
      drive(TUI_KEYS.down, TUI_KEYS.enter),
      drive('worker', TUI_KEYS.enter),
      drive('SOL', TUI_KEYS.enter),
      drive('reviewer', TUI_KEYS.enter),
      drive('luna', TUI_KEYS.enter),
      drive('planner', TUI_KEYS.enter),
      drive('flash', TUI_KEYS.enter),
      drive('Done', TUI_KEYS.enter),
    ],
  });

  await run.command();

  assert.equal(run.customs.length, 9);
  assert.deepEqual(run.calls.appendEntry, [{
    customType: 'model-collaboration',
    data: {
      planner: 'deepseek/deepseek-flash',
      worker: 'openai-codex/gpt-6-sol',
      reviewer: 'openai-codex/gpt-6-luna',
    },
  }]);
  assert.deepEqual(
    run.calls.setModel.map((model) => `${model.provider}/${model.id}`),
    ['deepseek/deepseek-flash'],
    'the planner role switches the parent model',
  );
  for (const dialog of run.customs) {
    for (const width of [12, 40, 100]) {
      for (const line of dialog.component.render(width)) {
        assert.ok(
          environment.tui.visibleWidth(line) <= width,
          `rendered line ${JSON.stringify(line)} exceeds width ${width}`,
        );
      }
    }
  }
});

test('the real TUI picker preserves the highlighted row on cursor movement', async (t) => {
  const environment = await tuiEnvironmentOrSkip(t);
  if (!environment) return;
  const run = setup({
    extension: environment.modelCollaboration,
    custom: true,
    customKeybindings: environment.keybindings,
    branch: [approvedEntry()],
    available: [CURRENT_MODEL, PLANNER_MODEL, WORKER_MODEL, DEEPSEEK_CHAT, DEEPSEEK_REASONER],
    extraModels: [DEEPSEEK_CHAT, DEEPSEEK_REASONER],
  });
  run.sessionStart('resume');

  const pending = run.command('planner');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.customs.length, 1);
  const dialog = run.customs[0];
  const { component } = dialog;
  const selectedRow = () => component.render(100).find((line) => line.startsWith('→ '));

  component.focused = true;
  assert.ok(component.render(40).some((line) => line.includes(environment.tui.CURSOR_MARKER)));
  component.focused = false;
  assert.ok(!component.render(40).some((line) => line.includes(environment.tui.CURSOR_MARKER)));
  component.focused = true;

  component.handleInput('deep');
  component.handleInput(TUI_KEYS.down);
  component.handleInput(TUI_KEYS.down);
  assert.equal(selectedRow(), '→ deepseek/deepseek-reasoner');

  const renders = dialog.renders;
  component.handleInput(TUI_KEYS.left);
  assert.ok(dialog.renders > renders, 'cursor movement still requests a render');
  assert.equal(selectedRow(), '→ deepseek/deepseek-reasoner');

  component.handleInput(TUI_KEYS.right);
  assert.equal(selectedRow(), '→ deepseek/deepseek-reasoner');
  component.handleInput(TUI_KEYS.backspace);
  assert.equal(selectedRow(), '→ deepseek/deepseek-chat', 'a filter change rebuilds and resets the highlight');

  component.handleInput(TUI_KEYS.escape);
  await pending;
  assert.deepEqual(run.calls.appendEntry, []);
  assert.deepEqual(run.calls.setModel, []);
});

test('the real TUI picker keeps the dialog open on Enter with no match and cancels on Escape', async (t) => {
  const environment = await tuiEnvironmentOrSkip(t);
  if (!environment) return;
  const run = setup({
    extension: environment.modelCollaboration,
    custom: true,
    customKeybindings: environment.keybindings,
    branch: [approvedEntry()],
  });
  run.sessionStart('resume');

  const pending = run.command('planner');
  await new Promise((resolve) => setImmediate(resolve));
  const { component } = run.customs[0];
  component.focused = true;
  component.handleInput('zzz');
  const rendered = component.render(100);
  assert.ok(rendered.some((line) => line.includes('No matching models or roles')));
  assert.ok(!rendered.some((line) => line.includes('No matching commands')));

  component.handleInput(TUI_KEYS.enter);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.customs.length, 1, 'Enter with no match must not select or reopen a dialog');
  assert.equal(run.dialogs.length, 0);

  component.handleInput(TUI_KEYS.escape);
  assert.equal(await pending, undefined);
  assert.deepEqual(run.calls.appendEntry, []);
});
