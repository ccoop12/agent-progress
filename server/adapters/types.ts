export interface ObserverEvent {
  kind: 'thread' | 'running' | 'idle' | 'blocked' | 'activity' | 'unknown';
  text: string;
  threadId?: string;
}
// Adapters can describe activity; they cannot change requirements or write evidence.
export interface AgentAdapter {
  id: string;
  parse(value: unknown): ObserverEvent;
}
