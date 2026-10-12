/** Real Codex binary -> loopback fixture provider -> JSONL -> observer -> real checks.
 * No model, account, API key, network provider, or paid call. The response is scripted.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Store } from '../server/store';
import { Engine } from '../server/engine';
import { progress } from '../shared/model';
const dir = await mkdtemp(join(tmpdir(), 'agent-progress-codex-smoke-'));
const repo = join(dir, 'repo');
await mkdir(repo);
await mkdir(join(dir, 'codex-home'));
await writeFile(join(repo, 'hello.txt'), 'Hello');
const fixture = createServer(async (req, res) => {
  for await (const _chunk of req) {
    /* discard synthetic request; never log it */
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const message = {
    id: 'msg_fixture',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [
      {
        type: 'output_text',
        text: 'Fixture reply. No coding work was performed.',
        annotations: [],
      },
    ],
  };
  const response = {
    id: 'resp_fixture',
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    output: [message],
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
  for (const event of [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...message, status: 'in_progress', content: [] },
    },
    {
      type: 'response.output_text.delta',
      item_id: message.id,
      output_index: 0,
      content_index: 0,
      delta: message.content[0].text,
    },
    { type: 'response.output_item.done', output_index: 0, item: message },
    { type: 'response.completed', response },
  ])
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
});
await new Promise<void>((r) => fixture.listen(0, '127.0.0.1', r));
const providerPort = (fixture.address() as any).port;
let executable = process.env.CODEX_BIN || 'codex',
  prefix: string[] = [];
if (!process.env.CODEX_BIN && process.platform === 'win32') {
  for (const path of (process.env.PATH || '').split(delimiter)) {
    const script = join(path, 'node_modules/@openai/codex/bin/codex.js');
    try {
      await access(script);
      executable = process.execPath;
      prefix = [script];
      break;
    } catch {
      /* search next PATH entry */
    }
  }
}
const store = new Store(join(dir, 'observer.sqlite')),
  engine = new Engine(store);
const session = await engine.create({
  title: 'Real Codex CLI / local fixture smoke',
  prompt: 'Observe the fixture greeting.',
  repoPath: repo,
  scopeReviewed: true,
  criteria: [
    {
      id: 'file',
      title: 'Fixture greeting exists',
      promptQuote: 'Observe the fixture greeting.',
      weight: 1,
      check: { kind: 'file', path: 'hello.txt', contains: 'Hello' },
    },
  ],
});
const args = [
  ...prefix,
  'exec',
  '--json',
  '--ephemeral',
  '--ignore-user-config',
  '--ignore-rules',
  '--skip-git-repo-check',
  '--sandbox',
  'read-only',
  '-C',
  repo,
  '-m',
  'fixture',
  '-c',
  'model_provider="local_fixture"',
  '-c',
  'model_providers.local_fixture.name="Local fixture"',
  '-c',
  `model_providers.local_fixture.base_url="http://127.0.0.1:${providerPort}/v1"`,
  '-c',
  'model_providers.local_fixture.wire_api="responses"',
  '-c',
  'model_providers.local_fixture.requires_openai_auth=false',
  '-c',
  'model_providers.local_fixture.supports_websockets=false',
  '-',
];
const child = spawn(executable, args, {
  windowsHide: true,
  env: { ...process.env, CODEX_HOME: join(dir, 'codex-home'), OTEL_SDK_DISABLED: 'true' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.stdin.end('Observe the fixture greeting.');
let stderr = '';
child.stderr.on('data', (b) => {
  stderr = (stderr + b.toString()).slice(-4000);
});
const outcome = new Promise<number | null>((r, reject) => {
  child.on('close', r);
  child.on('error', reject);
});
const timeout = setTimeout(() => child.kill(), 30000);
let records = 0;
const types: string[] = [];
try {
  for await (const line of createInterface({ input: child.stdout })) {
    const event = JSON.parse(line);
    types.push(event.type);
    engine.ingest(session.id, `real-cli:${records++}`, event);
  }
  const code = await outcome;
  if (code !== 0 || !types.includes('turn.completed'))
    throw new Error(
      `Codex fixture failed (exit ${code}); event types: ${types.join(', ')}. ${stderr}`,
    );
  const before = progress(store.get(session.id)).percent;
  await engine.verify(session.id);
  const after = progress(store.get(session.id)).percent;
  if (before !== 0 || after !== 100) throw new Error('Unexpected verification result');
  const report = {
    testedAt: new Date().toISOString(),
    provider: 'scripted loopback fixture, no real model',
    types,
    records,
    percentBeforeVerification: before,
    percentAfterVerification: after,
    statePath: dir,
  };
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/codex-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearTimeout(timeout);
  fixture.close();
  store.close();
}
