import { readFile, cp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir, port } from '../server/config';
const token = (await readFile(join(dataDir, 'token'), 'utf8')).trim();
async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Progress-Token': token },
    body: JSON.stringify(body),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(result));
  return result;
}
const repo = join(dataDir, 'examples', randomUUID());
await mkdir(repo, { recursive: true });
await cp(resolve('examples/health-api'), repo, { recursive: true });
const scope = JSON.parse(await readFile('examples/scope.json', 'utf8'));
scope.repoPath = repo;
scope.title = 'Health check API · offline example';
const session = await post('/sessions', scope);
const events = (await readFile('examples/codex-events.jsonl', 'utf8'))
  .trim()
  .split('\n')
  .map((line, i) => ({ deliveryId: `example:${i}`, event: JSON.parse(line) }));
await post(`/sessions/${session.id}/events`, events);
await post(`/sessions/${session.id}/verify`, {});
console.log(
  `Offline example created: ${session.id}\nDashboard: http://127.0.0.1:${port}\nRepository: ${repo}\nSynthetic agent events; real independent checks. Expected progress: 80%.\nCreate API.md containing GET /health, then rerun verification to reach 100%.`,
);
