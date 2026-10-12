import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type { Session, Manifest } from '../shared/model';
import { manifestSchema } from '../shared/model';
import { codexAdapter } from './adapters/codex';
import type { AgentAdapter } from './adapters/types';
import { fileHash, fingerprint, inside, sha } from './repository';
import { redact } from './redact';
import { Store } from './store';
import { verifyRequirement } from './verifier';
export class Engine {
  private busy = new Set<string>();
  onChange: () => void = () => {};
  constructor(
    public store: Store,
    public adapter: AgentAdapter = codexAdapter,
  ) {}
  snapshot(s: Session) {
    return fingerprint(
      s.repoPath,
      s.criteria.flatMap((r) =>
        r.check.kind === 'file'
          ? [r.check.path]
          : r.check.kind === 'command'
            ? r.check.trustedFiles
            : [],
      ),
    );
  }
  save(s: Session) {
    s.updatedAt = new Date().toISOString();
    this.store.save(s);
    this.onChange();
  }
  note(s: Session, kind: string, text: string) {
    s.events = [...s.events, { at: new Date().toISOString(), kind, text: redact(text) }].slice(
      -100,
    );
  }
  async create(input: unknown) {
    const m: Manifest = manifestSchema.parse(input);
    // Reject secret-bearing contracts instead of silently changing test expectations or scope.
    if (redact(JSON.stringify(m)) !== JSON.stringify(m))
      throw new Error('Possible secret in scope. Remove secrets before creating a session.');
    const repoPath = await realpath(m.repoPath);
    if (!(await stat(repoPath)).isDirectory())
      throw new Error('Repository path must be a directory');
    const criteria: Session['criteria'] = [];
    for (const c of m.criteria) {
      const trustedHashes: Record<string, string> = {};
      if (c.check.kind === 'file') await inside(repoPath, c.check.path);
      if (c.check.kind === 'command')
        for (const path of c.check.trustedFiles)
          trustedHashes[path] = await fileHash(repoPath, path);
      criteria.push({
        ...c,
        status: c.check.kind === 'manual' ? 'manual' : 'pending',
        trustedHashes,
      });
    }
    const s: Session = {
      id: randomUUID(),
      title: m.title,
      prompt: m.prompt,
      repoPath,
      adapter: this.adapter.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scopeHash: sha(JSON.stringify({ prompt: m.prompt, criteria })),
      criteria,
      allowCommands: m.allowCommands,
      autoVerify: m.autoVerify,
      status: 'waiting',
      activity: 'Waiting for a Codex event stream',
      checking: false,
      events: [],
      eventCount: 0,
      ignoredEvents: 0,
    };
    this.note(
      s,
      'scope',
      'Acceptance scope reviewed and locked. Weights cannot change in this session.',
    );
    this.save(s);
    return s;
  }
  ingest(id: string, deliveryId: string, value: unknown) {
    const s = this.store.get(id),
      event = this.adapter.parse(value);
    if (event.kind === 'thread' && s.threadId && s.threadId !== event.threadId)
      throw new Error('Different Codex thread: create a new tracking session for a new prompt');
    if (event.kind === 'thread') s.threadId = event.threadId;
    else if (event.kind === 'running') s.status = 'running';
    else if (event.kind === 'idle') s.status = 'idle';
    else if (event.kind === 'blocked') s.status = 'blocked';
    if (event.kind === 'unknown') s.ignoredEvents++;
    else {
      s.activity = event.text;
      this.note(s, event.kind, event.text);
    }
    s.eventCount++;
    s.updatedAt = new Date().toISOString();
    if (this.store.deliver(s, deliveryId)) this.onChange();
    return this.store.get(id);
  }
  interrupt(id: string, reason = 'Event stream disconnected. Reattach to continue observing.') {
    const s = this.store.get(id);
    s.streamLeaseAt = undefined;
    if (s.status !== 'running') {
      this.save(s);
      return;
    }
    s.status = 'interrupted';
    s.activity = reason;
    this.note(s, 'interrupted', reason);
    this.save(s);
  }
  heartbeat(id: string) {
    const s = this.store.get(id);
    s.streamLeaseAt = Date.now();
    this.store.save(s);
  }
  expireLease(id: string) {
    const s = this.store.get(id);
    if (s.streamLeaseAt && Date.now() - s.streamLeaseAt > 20000)
      this.interrupt(
        id,
        'Ingest process stopped responding. Progress is saved; reconnect the stream.',
      );
  }
  async recover() {
    for (const s of this.store.list()) {
      s.checking = false;
      s.streamLeaseAt = undefined;
      if (s.status === 'running') {
        s.status = 'interrupted';
        s.activity = 'Observer restarted. Reattach the event stream.';
      }
      this.save(s);
      await this.refresh(s.id);
    }
  }
  async refresh(id: string) {
    if (this.busy.has(id)) return;
    const s = this.store.get(id);
    try {
      const current = await this.snapshot(s);
      // Fetch fresh state after asynchronous I/O so events are not overwritten.
      const latest = this.store.get(id);
      if (this.busy.has(id)) return;
      if (latest.fingerprint !== current) {
        for (const r of latest.criteria)
          if (r.status === 'verified') {
            r.status = 'stale';
            r.evidence = {
              at: new Date().toISOString(),
              status: 'stale',
              summary: 'Repository changed. Previous verification is no longer current.',
            };
          }
        latest.fingerprint = current;
        latest.error = undefined;
        this.note(latest, 'repository', 'Repository snapshot changed; checks need fresh evidence.');
        this.save(latest);
        if (latest.autoVerify) await this.verify(id);
      } else if (latest.error) {
        latest.error = undefined;
        this.save(latest);
      }
    } catch {
      const latest = this.store.get(id);
      for (const r of latest.criteria) if (r.status === 'verified') r.status = 'stale';
      latest.error =
        'Repository cannot be fingerprinted. Progress is unverified; check path, symlinks, and size limits.';
      this.save(latest);
    }
  }
  async verify(id: string) {
    if (this.busy.has(id)) throw new Error('Verification is already running');
    this.busy.add(id);
    const s = this.store.get(id);
    s.checking = true;
    for (const r of s.criteria) if (r.status === 'verified') r.status = 'stale';
    this.save(s);
    try {
      const before = await this.snapshot(s);
      const results = [];
      for (const r of s.criteria)
        results.push(await verifyRequirement(s.repoPath, r, s.allowCommands));
      const after = await this.snapshot(s),
        latest = this.store.get(id);
      for (let i = 0; i < latest.criteria.length; i++) {
        const evidence =
          before === after
            ? { ...results[i], fingerprint: after }
            : {
                at: new Date().toISOString(),
                status: 'stale' as const,
                summary: 'Repository changed during verification. Rerun against a stable snapshot.',
              };
        latest.criteria[i].status = evidence.status;
        latest.criteria[i].evidence = evidence;
      }
      latest.fingerprint = after;
      latest.error = undefined;
      this.note(
        latest,
        'verification',
        before === after
          ? 'Independent verification finished.'
          : 'Verification invalidated by concurrent repository changes.',
      );
      this.save(latest);
    } catch {
      const latest = this.store.get(id);
      latest.error = 'Verification unavailable: repository could not be fingerprinted.';
      for (const r of latest.criteria) if (r.status === 'verified') r.status = 'stale';
      this.save(latest);
    } finally {
      const latest = this.store.get(id);
      latest.checking = false;
      this.save(latest);
      this.busy.delete(id);
    }
    return this.store.get(id);
  }
}
