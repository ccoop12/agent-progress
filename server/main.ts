import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { dataDir, port } from './config';
import { Store } from './store';
import { Engine } from './engine';
import { createApp } from './http';
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const tokenPath = join(dataDir, 'token');
let token: string;
try {
  token = (await readFile(tokenPath, 'utf8')).trim();
} catch {
  token = randomBytes(32).toString('hex');
  await writeFile(tokenPath, token, { mode: 0o600, flag: 'wx' });
}
const store = new Store(join(dataDir, 'progress.sqlite'));
await chmod(join(dataDir, 'progress.sqlite'), 0o600);
const engine = new Engine(store);
await engine.recover();
const app = createApp(engine, token);
app.server.on('error', () => {
  console.error('Could not bind the local server. Check AGENT_PROGRESS_PORT.');
  app.dispose();
  store.close();
  process.exitCode = 1;
});
app.server.listen(port, '127.0.0.1', () =>
  console.log(`Agent Progress: http://127.0.0.1:${port}\nLocal state: ${dataDir}`),
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  app.dispose();
  app.server.close(() => process.exit(0));
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
