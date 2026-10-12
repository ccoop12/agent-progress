import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store';
import { Engine } from '../server/engine';
import { Tailer } from '../server/tailer';
import { progress, manifestSchema, draftCriteria, type Manifest } from '../shared/model';
import { redact } from '../server/redact';
import { inside } from '../server/repository';
let dir: string, repo: string, store: Store, engine: Engine;
const thread = '00000000-0000-4000-8000-000000000001';
const scope = (): Manifest => ({
  title: 'Test task',
  prompt: 'Create a greeting. Test its behavior.',
  repoPath: repo,
  scopeReviewed: true,
  allowCommands: false,
  autoVerify: false,
  criteria: [
    {
      id: 'greeting',
      title: 'Greeting exists',
      promptQuote: 'Create a greeting.',
      weight: 3,
      check: { kind: 'file', path: 'hello.txt', contains: 'Hello' },
    },
    {
      id: 'review',
      title: 'Review behavior',
      promptQuote: 'Test its behavior.',
      weight: 1,
      check: { kind: 'manual', instructions: 'Review required' },
    },
  ],
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-progress-test-'));
  repo = join(dir, 'repo');
  await mkdir(repo);
  store = new Store(join(dir, 'state.sqlite'));
  engine = new Engine(store);
});
afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});
describe('honest progress', () => {
  it('never credits claims, command completion, plans, tokens or turn completion', async () => {
    const s = await engine.create(scope());
    for (const event of [
      { type: 'turn.started' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'All done' } },
      { type: 'item.completed', item: { type: 'command_execution', exit_code: 0 } },
      { type: 'item.completed', item: { type: 'todo_list', items: [{ completed: true }] } },
      { type: 'turn.completed', usage: { output_tokens: 99999 } },
    ])
      engine.ingest(s.id, JSON.stringify(event), event);
    expect(progress(store.get(s.id)).percent).toBe(0);
    expect(store.get(s.id).status).toBe('idle');
  });
  it('credits weighted independent evidence and keeps manual criteria outstanding', async () => {
    await writeFile(join(repo, 'hello.txt'), 'Hello');
    const s = await engine.create(scope());
    expect(progress(await engine.verify(s.id))).toMatchObject({
      percent: 75,
      verified: 3,
      total: 4,
    });
  });
  it('decreases progress on edits and detects deletion after restart', async () => {
    await writeFile(join(repo, 'hello.txt'), 'Hello');
    const s = await engine.create(scope());
    await engine.verify(s.id);
    await writeFile(join(repo, 'hello.txt'), 'Broken');
    await engine.refresh(s.id);
    expect(progress(store.get(s.id)).percent).toBe(0);
    expect(store.get(s.id).criteria[0].status).toBe('stale');
    expect((await engine.verify(s.id)).criteria[0].status).toBe('failed');
  });
  it('observes explicit evidence in excluded build directories', async () => {
    await mkdir(join(repo, 'dist'));
    await writeFile(join(repo, 'dist/result'), 'Hello');
    const m = scope();
    m.criteria[0].check = { kind: 'file', path: 'dist/result' };
    const s = await engine.create(m);
    await engine.verify(s.id);
    await rm(join(repo, 'dist/result'));
    await engine.refresh(s.id);
    expect(progress(store.get(s.id)).percent).toBe(0);
  });
  it('keeps scope fixed and never rounds incomplete scope to 100', () => {
    const criteria = [
      { status: 'verified', weight: 1000 },
      { status: 'pending', weight: 1 },
    ] as any;
    expect(progress({ criteria }).percent).toBe(99.9);
  });
  it('rejects duplicate IDs, zero weights, unreviewed scopes and unrelated quotes', () => {
    const m = scope();
    for (const bad of [
      { ...m, scopeReviewed: false },
      { ...m, criteria: [m.criteria[0], m.criteria[0]] },
      { ...m, criteria: [{ ...m.criteria[0], weight: 0 }] },
      { ...m, criteria: [{ ...m.criteria[0], promptQuote: 'Invented requirement' }] },
    ])
      expect(manifestSchema.safeParse(bad).success).toBe(false);
  });
  it('drafts explicit unverified criteria without claiming semantic analysis', () => {
    const c = draftCriteria('1. Build API\n2. Add docs');
    expect(c).toHaveLength(2);
    expect(c.every((r) => r.check.kind === 'manual')).toBe(true);
  });
});
describe('trusted commands', () => {
  async function command(code: string, approved = true, timeoutMs = 1000) {
    await writeFile(join(repo, 'check.mjs'), code);
    const m = scope();
    m.allowCommands = approved;
    m.criteria[0].check = {
      kind: 'command',
      executable: process.execPath,
      args: ['check.mjs'],
      trustedFiles: ['check.mjs'],
      timeoutMs,
    };
    return engine.create(m);
  }
  it('runs a real local process and requires exit zero', async () => {
    const s = await command('process.exit(0)');
    expect((await engine.verify(s.id)).criteria[0].evidence?.exitCode).toBe(0);
  });
  it('records nonzero exits as failed', async () => {
    const s = await command('process.exit(2)');
    expect((await engine.verify(s.id)).criteria[0].status).toBe('failed');
  });
  it('does not execute commands without authorization', async () => {
    const s = await command('throw Error("must not run")', false);
    expect((await engine.verify(s.id)).criteria[0].status).toBe('blocked');
  });
  it('blocks changed trusted checks', async () => {
    const s = await command('process.exit(1)');
    await writeFile(join(repo, 'check.mjs'), 'process.exit(0)');
    expect((await engine.verify(s.id)).criteria[0].status).toBe('blocked');
  });
  it('invalidates results when a verifier changes repository state', async () => {
    const s = await command(
      "import {writeFileSync} from 'node:fs'; writeFileSync('changed.txt','change');",
    );
    expect((await engine.verify(s.id)).criteria[0].status).toBe('stale');
  });
  it('times out hanging commands', async () => {
    const s = await command('setInterval(()=>{}, 1000)', true, 100);
    expect((await engine.verify(s.id)).criteria[0].evidence?.summary).toContain('timed out');
  });
  it('does not overwrite events arriving during verification', async () => {
    const s = await command('setTimeout(()=>{}, 250)');
    const pending = engine.verify(s.id);
    engine.ingest(s.id, 'start', { type: 'turn.started' });
    engine.ingest(s.id, 'failed', { type: 'turn.failed' });
    await pending;
    expect(store.get(s.id).status).toBe('blocked');
    expect(store.get(s.id).eventCount).toBe(2);
  });
  it('prevents concurrent verification', async () => {
    const s = await command('setTimeout(()=>{},100)');
    const pending = engine.verify(s.id);
    await expect(engine.verify(s.id)).rejects.toThrow('already running');
    await pending;
  });
});
describe('streams and recovery', () => {
  it('preserves source errors across repository scans and clears them on recovery', async () => {
    const s = await engine.create(scope()),
      path = join(dir, 'lost-events.jsonl');
    await writeFile(path, '{"type":"turn.started"}\n');
    const tailer = new Tailer(engine);
    await tailer.attach(s.id, path);
    await tailer.poll(s.id);
    await rm(path);
    await tailer.poll(s.id);
    await engine.refresh(s.id);
    expect(store.get(s.id).sourceError).toContain('Could not follow');
    expect(store.get(s.id).status).toBe('interrupted');
    await writeFile(path, '{"type":"turn.started"}\n');
    await tailer.poll(s.id);
    expect(store.get(s.id).sourceError).toBeUndefined();
  });
  it('expires an abandoned ingest lease without guessing based on agent event frequency', async () => {
    const s = await engine.create(scope());
    engine.ingest(s.id, '1', { type: 'turn.started' });
    engine.heartbeat(s.id);
    engine.expireLease(s.id);
    expect(store.get(s.id).status).toBe('running');
    const stale = store.get(s.id);
    stale.streamLeaseAt = Date.now() - 21000;
    store.save(stale);
    engine.expireLease(s.id);
    expect(store.get(s.id).status).toBe('interrupted');
  });
  it('automatically verifies only when the user opted in and the snapshot changes', async () => {
    await writeFile(join(repo, 'hello.txt'), 'Hello');
    const s = await engine.create({ ...scope(), autoVerify: true });
    await engine.refresh(s.id);
    expect(progress(store.get(s.id)).percent).toBe(75);
    await writeFile(join(repo, 'hello.txt'), 'broken');
    await engine.refresh(s.id);
    expect(progress(store.get(s.id)).percent).toBe(0);
    expect(store.get(s.id).criteria[0].status).toBe('failed');
  });
  it('deduplicates deliveries durably and recovers interrupted state', async () => {
    const s = await engine.create(scope());
    engine.ingest(s.id, 'one', { type: 'turn.started' });
    store.close();
    store = new Store(join(dir, 'state.sqlite'));
    engine = new Engine(store);
    await engine.recover();
    expect(store.get(s.id).status).toBe('interrupted');
    engine.ingest(s.id, 'one', { type: 'turn.started' });
    expect(store.get(s.id).eventCount).toBe(1);
    expect(store.get(s.id).status).toBe('interrupted');
  });
  it('persists verified state but rechecks repository fingerprint on recovery', async () => {
    await writeFile(join(repo, 'hello.txt'), 'Hello');
    const s = await engine.create(scope());
    await engine.verify(s.id);
    await engine.recover();
    expect(progress(store.get(s.id)).percent).toBe(75);
    await rm(join(repo, 'hello.txt'));
    await engine.recover();
    expect(progress(store.get(s.id)).percent).toBe(0);
  });
  it('rejects another thread and permits same-thread continuation', async () => {
    const s = await engine.create(scope());
    engine.ingest(s.id, '1', { type: 'thread.started', thread_id: thread });
    engine.ingest(s.id, '2', { type: 'thread.started', thread_id: thread });
    expect(() =>
      engine.ingest(s.id, '3', {
        type: 'thread.started',
        thread_id: '00000000-0000-4000-8000-000000000002',
      }),
    ).toThrow('Different Codex thread');
  });
  it('counts malformed and future events without granting credit', async () => {
    const s = await engine.create(scope());
    engine.ingest(s.id, '1', null);
    engine.ingest(s.id, '2', { type: 'future' });
    expect(store.get(s.id).ignoredEvents).toBe(2);
  });
  it('tails split UTF-8 records, restores byte cursors and handles truncation', async () => {
    const s = await engine.create(scope()),
      path = join(dir, 'events.jsonl'),
      tailer = new Tailer(engine);
    await writeFile(path, '{"type":"turn.star');
    await tailer.attach(s.id, path);
    await tailer.poll(s.id);
    expect(store.get(s.id).eventCount).toBe(0);
    await appendFile(
      path,
      'ted"}\n{"type":"item.completed","item":{"type":"agent_message","text":"你好"}}\n',
    );
    await tailer.poll(s.id);
    expect(store.get(s.id).eventCount).toBe(2);
    const cursor = store.get(s.id).source!.offset;
    expect(cursor).toBe((await readFile(path)).length);
    await new Tailer(engine).poll(s.id);
    expect(store.get(s.id).eventCount).toBe(2);
    await writeFile(path, '{"type":"turn.completed"}\n');
    await tailer.poll(s.id);
    expect(store.get(s.id).status).toBe('idle');
    expect(store.get(s.id).source!.generation).toBe(2);
  });
});
describe('privacy and boundaries', () => {
  it('redacts recognized keys, credentials, bearer tokens, and private keys', () => {
    for (const secret of [
      'sk-abcdefghijklmnopqrst',
      'ghp_abcdefghijklmnop',
      'password=hunter2',
      'Authorization: Bearer abc.def.xyz',
      'https://user:pass@example.com',
      '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
    ])
      expect(redact(secret)).toContain('[REDACTED');
  });
  it('rejects secrets in scope rather than altering expectations', async () => {
    const m = scope();
    m.prompt += ' api_key=superprivate';
    await expect(engine.create(m)).rejects.toThrow('Possible secret');
  });
  it('stores no agent text, output, or raw event prefix', async () => {
    const s = await engine.create(scope()),
      secret = 'SECRET_SENTINEL_123456';
    engine.ingest(s.id, '1', {
      type: 'item.completed',
      item: { type: 'agent_message', text: secret },
    });
    const path = join(dir, 'events.jsonl');
    await writeFile(
      path,
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'command_execution', aggregated_output: secret },
      }) + '\n',
    );
    const tailer = new Tailer(engine);
    await tailer.attach(s.id, path);
    await tailer.poll(s.id);
    expect(JSON.stringify(store.get(s.id))).not.toContain(secret);
    expect(store.get(s.id).source?.prefix).toMatch(/^[a-f0-9]{64}$/);
  });
  it('rejects absolute and traversing evidence paths', async () => {
    await expect(inside(repo, '../outside')).rejects.toThrow();
    await expect(inside(repo, dir)).rejects.toThrow();
  });
});
