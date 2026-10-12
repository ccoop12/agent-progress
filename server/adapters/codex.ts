import type { AgentAdapter } from './types';
export const codexAdapter: AgentAdapter = {
  id: 'codex-exec-json-v1',
  parse(value) {
    if (!value || typeof value !== 'object') return { kind: 'unknown', text: 'Unsupported event' };
    const e = value as Record<string, any>;
    switch (e.type) {
      case 'thread.started':
        return typeof e.thread_id === 'string' && /^[a-f0-9-]{36}$/i.test(e.thread_id)
          ? { kind: 'thread', text: 'Codex thread connected', threadId: e.thread_id }
          : { kind: 'unknown', text: 'Invalid thread event' };
      case 'turn.started':
        return { kind: 'running', text: 'Codex is working' };
      case 'turn.completed':
        return { kind: 'idle', text: 'Codex turn ended. Acceptance checks determine completion.' };
      case 'turn.failed':
        return {
          kind: 'blocked',
          text: 'Codex turn failed; inspect the Codex terminal for details',
        };
      case 'error':
        return { kind: 'activity', text: 'Codex reported a stream error (may retry)' };
      case 'item.started':
      case 'item.updated':
      case 'item.completed': {
        const i = e.item;
        if (!i || typeof i.type !== 'string')
          return { kind: 'unknown', text: 'Invalid item event' };
        const names: Record<string, string> = {
          command_execution: 'Command execution',
          file_change: 'Repository edit',
          agent_message: 'Agent message (unverified)',
          reasoning: 'Reasoning',
          mcp_tool_call: 'Tool call',
          web_search: 'Web search',
          todo_list: 'Agent plan (unverified)',
          plan: 'Agent plan (unverified)',
          error: 'Agent item error',
        };
        if (!names[i.type]) return { kind: 'unknown', text: 'Unsupported Codex item' };
        // No agent-authored payload is needed for progress. Do not retain messages, commands, paths, or output.
        return { kind: 'activity', text: `${names[i.type]} · ${e.type.split('.')[1]}` };
      }
      default:
        return { kind: 'unknown', text: 'Unsupported Codex event' };
    }
  },
};
