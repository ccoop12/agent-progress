import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { dataDir, port } from './config';
import { draftCriteria } from '../shared/model';
const args = process.argv.slice(2),
  command = args[0];
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
async function request(path: string, body?: unknown) {
  const token = (await readFile(join(dataDir, 'token'), 'utf8')).trim();
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Progress-Token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as any;
  if (!response.ok) throw new Error(result.error);
  return result;
}
try {
  if (command === 'plan') {
    const prompt = await readFile(resolve(option('--prompt-file') || 'prompt.txt'), 'utf8');
    console.log(
      JSON.stringify(
        {
          title: 'New coding task',
          prompt,
          repoPath: resolve(option('--repo') || '.'),
          criteria: draftCriteria(prompt),
          scopeReviewed: false,
          allowCommands: false,
          autoVerify: false,
        },
        null,
        2,
      ),
    );
  } else if (command === 'create') {
    const path = resolve(args[1]);
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    console.log(JSON.stringify(await request('/sessions', manifest), null, 2));
  } else if (command === 'list') console.log(JSON.stringify(await request('/sessions'), null, 2));
  else if (command === 'verify' && args[1])
    console.log(JSON.stringify(await request(`/sessions/${args[1]}/verify`, {}), null, 2));
  else if (command === 'attach' && args[1] && option('--file'))
    console.log(
      JSON.stringify(
        await request(`/sessions/${args[1]}/source`, { path: resolve(option('--file')!) }),
        null,
        2,
      ),
    );
  else if (command === 'ingest' && args[1]) {
    const id = args[1],
      streamId = randomUUID();
    let sequence = 0;
    await request(`/sessions/${id}/heartbeat`, {});
    const heartbeat = setInterval(() => {
      void request(`/sessions/${id}/heartbeat`, {}).catch(() => {});
    }, 5000);
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    // Backpressure: wait for durable acknowledgement before accepting the next record.
    try {
      for await (const line of lines) {
        if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('Event line exceeds 1 MB');
        let event: unknown;
        try {
          event = JSON.parse(line.replace(/^\uFEFF/, ''));
        } catch {
          event = null;
        }
        await request(`/sessions/${id}/events`, [
          { deliveryId: `${streamId}:${sequence++}`, event },
        ]);
      }
    } finally {
      clearInterval(heartbeat);
      await request(`/sessions/${id}/disconnect`, {});
    }
    console.error(`Persisted ${sequence} records. Tracking session: ${id}`);
  } else
    console.log(
      'Agent Progress\n  plan --prompt-file prompt.txt --repo /path\n  create scope.json\n  list\n  verify SESSION_ID\n  attach SESSION_ID --file events.jsonl\n  ingest SESSION_ID  (pipe codex exec --json stdout)',
    );
} catch (error: any) {
  console.error(`Agent Progress: ${error.message}`);
  process.exitCode = 1;
}
