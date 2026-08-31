import { DatabaseSync } from 'node:sqlite';

/**
 * A tiny on-disk cache so the same shopfront is only ever asked about once.
 *
 * node:sqlite is built into Node 22, so the proxy has no dependencies at all. It
 * prints an experimental warning, which is noted rather than silenced.
 */
export class PlaceCache {
  private readonly db: DatabaseSync;

  constructor(path: string, private readonly ttlMs: number) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS lookup (
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        payload TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (kind, key)
      );
    `);
  }

  get<T>(kind: string, key: string): T | null {
    const row = this.db
      .prepare('SELECT payload, fetched_at FROM lookup WHERE kind = ? AND key = ?')
      .get(kind, key) as { payload?: string; fetched_at?: number } | undefined;
    if (!row?.payload || typeof row.fetched_at !== 'number') return null;
    if (Date.now() - row.fetched_at > this.ttlMs) return null;
    try {
      return JSON.parse(row.payload) as T;
    } catch {
      return null;
    }
  }

  set(kind: string, key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO lookup (kind, key, payload, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(kind, key) DO UPDATE SET payload = excluded.payload,
                                              fetched_at = excluded.fetched_at`,
      )
      .run(kind, key, JSON.stringify(value), Date.now());
  }

  close(): void {
    this.db.close();
  }
}
