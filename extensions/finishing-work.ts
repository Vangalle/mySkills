import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const skillPath = fileURLToPath(new URL('../skills/finishing-work/SKILL.md', import.meta.url));

// A backstop for runs that attempted file changes but did not load the exit-decision skill.
// The agent, not this extension, decides whether any further action is warranted.
export default function finishingWork(pi: ExtensionAPI) {
  let eligible = false;
  let writeAttempted = false;
  let skillRead = false;
  let checked = false;

  pi.on('before_agent_start', (event) => {
    eligible = event.messageType === 'user' &&
      !/^(?:stop\b|cancel\b|停止|停下|不要继续|别做了)/i.test(event.prompt.trim());
    writeAttempted = false;
    skillRead = false;
    checked = false;
  });

  pi.on('tool_call', (event) => {
    if (!eligible) return;
    if (event.toolName === 'read' &&
        typeof event.input.path === 'string' &&
        /(?:^|\/)finishing-work\/SKILL\.md$/.test(event.input.path)) {
      skillRead = true;
    }
    if (event.toolName === 'edit' || event.toolName === 'write') writeAttempted = true;
  });

  pi.on('agent_before_settle', (event) => {
    if (!eligible || checked || !writeAttempted || skillRead || event.outcome !== 'completed') return;
    checked = true;
    return {
      entries: [{
        type: 'custom_message',
        customType: 'finishing-work-exit-check',
        content: `Before finishing this execution task, read ${skillPath} and apply its brief exit decision once. Only take a specific, safe, authorized next action if worthwhile; otherwise stop and report verified limits. Do not repeat this check or expand scope.`,
        display: false,
      }],
      continue: true,
    };
  });
}
