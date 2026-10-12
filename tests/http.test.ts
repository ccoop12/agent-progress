import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { Store } from '../server/store';
import { Engine } from '../server/engine';
import { createApp } from '../server/http';
let dir: string, store: Store, app: ReturnType<typeof createApp>, url: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-progress-http-'));
  store = new Store(join(dir, 'db'));
  app = createApp(new Engine(store), 'test-token');
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(app.server.address() as any).port}`;
});
afterEach(async () => {
  app.dispose();
  await new Promise<void>((r) => app.server.close(() => r()));
  store.close();
  await rm(dir, { recursive: true, force: true });
});
it('rejects DNS rebinding and cross-origin reads', async () => {
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(
      url + '/api/sessions',
      { headers: { Host: 'evil.example' } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    req.on('error', reject);
    req.end();
  });
  expect(status).toBe(403);
  expect(
    (await fetch(url + '/api/bootstrap', { headers: { Origin: 'https://evil.example' } })).status,
  ).toBe(403);
});
it('requires local token and JSON for mutations', async () => {
  expect((await fetch(url + '/api/sessions', { method: 'POST', body: '{}' })).status).toBe(403);
  expect(
    (
      await fetch(url + '/api/sessions', {
        method: 'POST',
        headers: { 'X-Agent-Progress-Token': 'test-token' },
        body: '{}',
      })
    ).status,
  ).toBe(415);
});
it('streams real server-sent updates', async () => {
  const controller = new AbortController();
  const response = await fetch(url + '/api/live', { signal: controller.signal });
  const reader = response.body!.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain('connected');
  controller.abort();
});
it('rejects invalid scopes and leaves the database unchanged', async () => {
  const response = await fetch(url + '/api/sessions', {
    method: 'POST',
    headers: { 'X-Agent-Progress-Token': 'test-token', 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(response.status).toBe(400);
  expect(store.list()).toEqual([]);
});
it('ingests actual stdin through the CLI process and persists interruption on EOF', async () => {
  await writeFile(join(dir, 'token'), 'test-token');
  const s = await new Engine(store).create({
    title: 'CLI test',
    prompt: 'Review',
    repoPath: dir,
    scopeReviewed: true,
    criteria: [
      {
        id: 'r1',
        title: 'Review',
        promptQuote: 'Review',
        weight: 1,
        check: { kind: 'manual', instructions: 'Review' },
      },
    ],
  });
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/cli.ts', 'ingest', s.id], {
    env: {
      ...process.env,
      AGENT_PROGRESS_HOME: dir,
      AGENT_PROGRESS_PORT: String((app.server.address() as any).port),
    },
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  child.stdin.end(
    '{"type":"turn.started"}\n{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}\n',
  );
  expect(
    await new Promise((resolve, reject) => {
      child.on('close', resolve);
      child.on('error', reject);
    }),
  ).toBe(0);
  expect(store.get(s.id).eventCount).toBe(2);
  expect(store.get(s.id).status).toBe('interrupted');
});
