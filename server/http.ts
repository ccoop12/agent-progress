import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { draftCriteria } from '../shared/model';
import { Engine } from './engine';
import { Tailer } from './tailer';
export function createApp(engine: Engine, token: string, staticDir = resolve('dist')) {
  const clients = new Set<ServerResponse>(),
    tailer = new Tailer(engine);
  engine.onChange = () => {
    for (const c of clients)
      if (c.writableLength > 1024 * 1024) {
        c.destroy();
        clients.delete(c);
      } else c.write('data: changed\n\n');
  };
  const server = createServer(async (req, res) => {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
    );
    const address = server.address(),
      actualPort = typeof address === 'object' && address ? address.port : 4317;
    const hosts = new Set([
      `127.0.0.1:${actualPort}`,
      `localhost:${actualPort}`,
      '127.0.0.1:5173',
      'localhost:5173',
    ]);
    if (!hosts.has(req.headers.host || '')) return json(403, { error: 'Untrusted Host' });
    if (req.headers.origin && ![...hosts].some((h) => req.headers.origin === `http://${h}`))
      return json(403, { error: 'Cross-origin requests are not allowed' });
    if (req.headers['sec-fetch-site'] === 'cross-site')
      return json(403, { error: 'Cross-site requests are not allowed' });
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    try {
      let body: any;
      if (req.method === 'POST') {
        const incoming = Buffer.from(String(req.headers['x-agent-progress-token'] || '')),
          expected = Buffer.from(token);
        if (incoming.length !== expected.length || !timingSafeEqual(incoming, expected))
          return json(403, { error: 'Missing local access token' });
        if (!req.headers['content-type']?.startsWith('application/json'))
          return json(415, { error: 'JSON required' });
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) {
            json(413, { error: 'Body exceeds 1 MB' });
            return;
          }
          chunks.push(chunk);
        }
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      }
      if (req.method === 'GET' && url.pathname === '/api/bootstrap') return json(200, { token });
      if (req.method === 'GET' && url.pathname === '/api/sessions')
        return json(200, engine.store.list());
      if (req.method === 'GET' && url.pathname === '/api/live') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('data: connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/draft')
        return json(200, draftCriteria(z.string().min(1).max(12000).parse(body.prompt)));
      if (req.method === 'POST' && url.pathname === '/api/sessions')
        return json(201, await engine.create(body));
      const match = url.pathname.match(
        /^\/api\/sessions\/([a-f0-9-]{36})(?:\/(verify|events|disconnect|heartbeat|source))?$/,
      );
      if (match) {
        const [, id, action] = match;
        if (req.method === 'GET' && !action) return json(200, engine.store.get(id));
        if (req.method === 'POST') {
          if (action === 'verify') return json(200, await engine.verify(id));
          if (action === 'events') {
            const batch = z
              .array(z.object({ deliveryId: z.string().min(1).max(200), event: z.unknown() }))
              .max(100)
              .parse(body);
            for (const e of batch) engine.ingest(id, e.deliveryId, e.event);
            return json(200, { ok: true });
          }
          if (action === 'disconnect') {
            engine.interrupt(id);
            return json(200, { ok: true });
          }
          if (action === 'heartbeat') {
            engine.heartbeat(id);
            return json(200, { ok: true });
          }
          if (action === 'source')
            return json(200, await tailer.attach(id, z.string().min(1).max(4000).parse(body.path)));
        }
      }
      if (url.pathname.startsWith('/api/')) return json(404, { error: 'Not found' });
      if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });
      const file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const path = resolve(staticDir, file);
      if (!path.startsWith(resolve(staticDir) + sep)) return json(403, { error: 'Invalid path' });
      const contents = await readFile(path);
      const mime: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
      };
      res.writeHead(200, {
        'Content-Type': mime[extname(path)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(contents);
    } catch (error: any) {
      if (error?.code === 'ENOENT')
        return json(404, { error: 'File not found. Run npm run build before npm start.' });
      // Do not echo submitted data, paths, command output, or stack traces to clients.
      const message =
        error instanceof z.ZodError
          ? 'Invalid scope or request. Check required fields, prompt quotes, unique IDs, and positive weights.'
          : String(error.message || 'Request failed');
      json(message === 'Session not found' ? 404 : 400, {
        error: message.startsWith('E') ? 'Local operation failed' : message,
      });
    }
  });
  let ticking = false;
  const poll = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      for (const s of engine.store.list()) {
        engine.expireLease(s.id);
        await tailer.poll(s.id);
        await engine.refresh(s.id);
      }
    } finally {
      ticking = false;
    }
  }, 2000);
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(': heartbeat\n\n');
  }, 15000);
  server.on('close', () => {
    clearInterval(poll);
    clearInterval(heartbeat);
    for (const c of clients) c.end();
  });
  return {
    server,
    tailer,
    dispose: () => {
      clearInterval(poll);
      clearInterval(heartbeat);
      for (const c of clients) c.end();
    },
  };
}
