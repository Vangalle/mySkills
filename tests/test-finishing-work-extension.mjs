import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import finishingWork from '../extensions/finishing-work.ts';

function setup() {
  const handlers = new Map();
  finishingWork({ on(event, handler) { handlers.set(event, handler); } });
  const emit = (event, payload = {}) => handlers.get(event)?.(payload);
  const start = (messageType = 'user', prompt = 'Implement the change') => emit('before_agent_start', { messageType, prompt });
  const settle = (outcome = 'completed') => emit('agent_before_settle', { outcome });
  return { emit, start, settle };
}

// Removing the write/skill-read guards must make these cases fail.
test('a write without a prior skill read requests one bounded exit decision', () => {
  const run = setup();
  run.start();
  run.emit('tool_call', { toolName: 'edit', input: { path: '/tmp/a' } });
  const result = run.settle();
  assert.equal(result.continue, true);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].type, 'custom_message');
  const bundledSkill = resolve('skills/finishing-work/SKILL.md');
  assert.equal(existsSync(bundledSkill), true);
  assert.ok(result.entries[0].content.includes(bundledSkill));
  assert.match(result.entries[0].content, /authorized|授权/i);
});

test('the continuation cannot trigger another exit check in the same run', () => {
  const run = setup();
  run.start();
  run.emit('tool_call', { toolName: 'write', input: { path: '/tmp/a' } });
  assert.equal(run.settle().continue, true);
  run.emit('tool_call', { toolName: 'edit', input: { path: '/tmp/a' } });
  assert.equal(run.settle(), undefined);
});

test('a fresh user run can get its own check', () => {
  const run = setup();
  run.start();
  run.emit('tool_call', { toolName: 'edit', input: { path: '/tmp/a' } });
  run.settle();
  run.start();
  run.emit('tool_call', { toolName: 'write', input: { path: '/tmp/b' } });
  assert.equal(run.settle().continue, true);
});

test('reading the skill earlier in the run avoids a redundant continuation', () => {
  const run = setup();
  run.start();
  run.emit('tool_call', { toolName: 'read', input: { path: '/tmp/agent/skills/finishing-work/SKILL.md' } });
  run.emit('tool_call', { toolName: 'edit', input: { path: '/tmp/a' } });
  assert.equal(run.settle(), undefined);
});

test('read-only runs, custom-message runs, and aborted runs do not continue', () => {
  const readOnly = setup();
  readOnly.start();
  readOnly.emit('tool_call', { toolName: 'read', input: { path: '/tmp/a' } });
  assert.equal(readOnly.settle(), undefined);
  const custom = setup();
  custom.start('custom');
  custom.emit('tool_call', { toolName: 'edit', input: { path: '/tmp/a' } });
  assert.equal(custom.settle(), undefined);
  const aborted = setup();
  aborted.start();
  aborted.emit('tool_call', { toolName: 'write', input: { path: '/tmp/a' } });
  assert.equal(aborted.settle('aborted'), undefined);
  const failed = setup();
  failed.start();
  failed.emit('tool_call', { toolName: 'write', input: { path: '/tmp/a' } });
  assert.equal(failed.settle('error'), undefined);
});

test('an explicit stop request never adds a continuation', () => {
  const run = setup();
  run.start('user', 'Stop now; report current state only.');
  run.emit('tool_call', { toolName: 'edit', input: { path: '/tmp/a' } });
  assert.equal(run.settle(), undefined);
});
