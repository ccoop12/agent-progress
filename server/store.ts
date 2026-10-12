import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Session } from '../shared/model';
export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS deliveries(session_id TEXT NOT NULL, delivery_id TEXT NOT NULL, PRIMARY KEY(session_id,delivery_id));',
    );
  }
  list(): Session[] {
    return (
      this.db.prepare('SELECT body FROM sessions ORDER BY rowid DESC').all() as { body: string }[]
    ).map((r) => JSON.parse(r.body));
  }
  get(id: string): Session {
    const row = this.db.prepare('SELECT body FROM sessions WHERE id=?').get(id) as
      { body: string } | undefined;
    if (!row) throw new Error('Session not found');
    return JSON.parse(row.body);
  }
  save(s: Session) {
    this.db
      .prepare(
        'INSERT INTO sessions(id,body) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
      )
      .run(s.id, JSON.stringify(s));
  }
  deliver(s: Session, deliveryId: string): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db
        .prepare('INSERT OR IGNORE INTO deliveries VALUES (?,?)')
        .run(s.id, deliveryId);
      if (result.changes) this.save(s);
      this.db.exec('COMMIT');
      return Boolean(result.changes);
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
