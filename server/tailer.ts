import { open, realpath, stat } from 'node:fs/promises';
import type { Engine } from './engine';
import { sha } from './repository';
export class Tailer {
  private busy = new Set<string>();
  constructor(private engine: Engine) {}
  async attach(id: string, path: string) {
    const resolved = await realpath(path);
    if (!(await stat(resolved)).isFile())
      throw new Error('Event source must be a regular JSONL file');
    const s = this.engine.store.get(id);
    if (s.source?.path === resolved) return s;
    s.source = {
      path: resolved,
      offset: 0,
      generation: (s.source?.generation ?? 0) + 1,
      prefix: '',
      prefixBytes: 0,
    };
    this.engine.note(
      s,
      'source',
      'Attached a local JSONL file. Cursor survives observer restarts.',
    );
    this.engine.save(s);
    return s;
  }
  async poll(id: string) {
    if (this.busy.has(id)) return;
    this.busy.add(id);
    try {
      let s = this.engine.store.get(id);
      if (!s.source) return;
      const source = { ...s.source };
      const file = await open(source.path, 'r');
      try {
        const size = (await file.stat()).size;
        const recovered = this.engine.store.get(id);
        if (recovered.sourceError) {
          recovered.sourceError = undefined;
          this.engine.save(recovered);
        }
        const prefix = Buffer.alloc(source.prefixBytes || Math.min(128, size));
        await file.read(prefix, 0, prefix.length, 0);
        if (size < source.offset || (source.prefix && sha(prefix) !== source.prefix)) {
          source.offset = 0;
          source.generation++;
          source.prefix = '';
          source.prefixBytes = 0;
          this.engine.interrupt(
            id,
            'Event file was replaced or truncated. Reading a new stream generation.',
          );
        }
        const buffer = Buffer.alloc(1024 * 1024);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, source.offset);
        const data = buffer.subarray(0, bytesRead),
          end = data.lastIndexOf(10);
        if (end < 0) {
          if (bytesRead === buffer.length) throw new Error('Event line exceeds 1 MB');
          return; // Never consume an incomplete JSONL record.
        }
        let consumed = 0;
        for (const line of data
          .subarray(0, end + 1)
          .toString('utf8')
          .split('\n')
          .slice(0, -1)) {
          const delivery = `file:${source.generation}:${source.offset + consumed}`;
          let value: unknown;
          try {
            value = JSON.parse(line.replace(/^\uFEFF/, ''));
          } catch {
            value = null;
          }
          this.engine.ingest(id, delivery, value);
          consumed += Buffer.byteLength(line, 'utf8') + 1;
        }
        source.offset += end + 1;
        if (!source.prefix) {
          const p = Buffer.alloc(Math.min(128, source.offset));
          await file.read(p, 0, p.length, 0);
          source.prefix = sha(p);
          source.prefixBytes = p.length;
        }
        s = this.engine.store.get(id);
        s.source = source;
        this.engine.save(s);
      } finally {
        await file.close();
      }
    } catch {
      const s = this.engine.store.get(id);
      s.sourceError =
        'Could not follow event file. Check the file and thread identity, then reattach.';
      this.engine.interrupt(id);
      this.engine.save({ ...this.engine.store.get(id), sourceError: s.sourceError });
    } finally {
      this.busy.delete(id);
    }
  }
}
