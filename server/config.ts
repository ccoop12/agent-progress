import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
export const dataDir = resolve(
  process.env.AGENT_PROGRESS_HOME || join(homedir(), '.agent-progress'),
);
export const port = Number(process.env.AGENT_PROGRESS_PORT || 4317);
