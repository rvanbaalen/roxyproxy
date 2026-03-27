import BetterSqlite3 from 'better-sqlite3';
import type { RequestRecord, RequestFilter, PaginatedResponse } from '../shared/types.js';
import fs from 'node:fs';

export class Database {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    const dir = dbPath.substring(0, dbPath.lastIndexOf('/'));
    if (dir) fs.mkdirSync(dir, { recursive: true });

    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');

    // auto_vacuum can only be set on a fresh DB; convert existing ones with a one-time VACUUM
    const currentMode = this.db.pragma('auto_vacuum', { simple: true }) as number;
    if (currentMode !== 2) {
      this.db.pragma('auto_vacuum = INCREMENTAL');
      this.db.exec('VACUUM');
    }

    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        method TEXT NOT NULL,
        url TEXT NOT NULL,
        host TEXT NOT NULL,
        path TEXT NOT NULL,
        protocol TEXT NOT NULL,
        request_headers TEXT,
        request_body BLOB,
        request_size INTEGER,
        status INTEGER,
        response_headers TEXT,
        response_body BLOB,
        response_size INTEGER,
        duration INTEGER,
        content_type TEXT,
        truncated INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_timestamp ON requests(timestamp);
      CREATE INDEX IF NOT EXISTS idx_host ON requests(host);
      CREATE INDEX IF NOT EXISTS idx_status ON requests(status);
      CREATE INDEX IF NOT EXISTS idx_path ON requests(path);
      CREATE INDEX IF NOT EXISTS idx_content_type ON requests(content_type);
      CREATE INDEX IF NOT EXISTS idx_duration ON requests(duration);
    `);
  }

  insert(record: RequestRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO requests (
        id, timestamp, method, url, host, path, protocol,
        request_headers, request_body, request_size,
        status, response_headers, response_body, response_size,
        duration, content_type, truncated
      ) VALUES (
        @id, @timestamp, @method, @url, @host, @path, @protocol,
        @request_headers, @request_body, @request_size,
        @status, @response_headers, @response_body, @response_size,
        @duration, @content_type, @truncated
      )
    `);
    stmt.run(record);
  }

  insertBatch(records: RequestRecord[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO requests (
        id, timestamp, method, url, host, path, protocol,
        request_headers, request_body, request_size,
        status, response_headers, response_body, response_size,
        duration, content_type, truncated
      ) VALUES (
        @id, @timestamp, @method, @url, @host, @path, @protocol,
        @request_headers, @request_body, @request_size,
        @status, @response_headers, @response_body, @response_size,
        @duration, @content_type, @truncated
      )
    `);
    const insertMany = this.db.transaction((records: RequestRecord[]) => {
      for (const record of records) {
        stmt.run(record);
      }
    });
    insertMany(records);
  }

  getById(id: string): RequestRecord | null {
    const stmt = this.db.prepare('SELECT * FROM requests WHERE id = ?');
    return (stmt.get(id) as RequestRecord) ?? null;
  }

  query(filter: RequestFilter): PaginatedResponse<RequestRecord> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.host) {
      conditions.push('host LIKE @host');
      params.host = `%${filter.host}%`;
    }
    if (filter.status !== undefined) {
      conditions.push('status = @status');
      params.status = filter.status;
    }
    if (filter.statusMin !== undefined) {
      conditions.push('status >= @statusMin');
      params.statusMin = filter.statusMin;
    }
    if (filter.statusMax !== undefined) {
      conditions.push('status <= @statusMax');
      params.statusMax = filter.statusMax;
    }
    if (filter.durationMin !== undefined) {
      conditions.push('duration > @durationMin');
      params.durationMin = filter.durationMin;
    }
    if (filter.method) {
      conditions.push('method = @method');
      params.method = filter.method.toUpperCase();
    }
    if (filter.content_type) {
      conditions.push('content_type LIKE @content_type');
      params.content_type = `%${filter.content_type}%`;
    }
    if (filter.search) {
      conditions.push('url LIKE @search');
      params.search = `%${filter.search}%`;
    }
    if (filter.since) {
      conditions.push('timestamp >= @since');
      params.since = filter.since;
    }
    if (filter.until) {
      conditions.push('timestamp <= @until');
      params.until = filter.until;
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM requests ${where}`);
    const total = (countStmt.get(params) as { count: number }).count;

    const dataStmt = this.db.prepare(
      `SELECT * FROM requests ${where} ORDER BY timestamp DESC LIMIT @limit OFFSET @offset`
    );
    const data = dataStmt.all({ ...params, limit, offset }) as RequestRecord[];

    return { data, total, limit, offset };
  }

  deleteAll(): void {
    this.db.exec('DELETE FROM requests');
    this.db.exec('VACUUM');
  }

  deleteOlderThan(timestampMs: number): number {
    const stmt = this.db.prepare('DELETE FROM requests WHERE timestamp < ?');
    return stmt.run(timestampMs).changes;
  }

  deleteOldest(limit: number): number {
    const stmt = this.db.prepare(
      'DELETE FROM requests WHERE id IN (SELECT id FROM requests ORDER BY timestamp ASC LIMIT ?)'
    );
    return stmt.run(limit).changes;
  }

  incrementalVacuum(): void {
    this.db.pragma('incremental_vacuum');
  }

  getRequestCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM requests');
    return (stmt.get() as { count: number }).count;
  }

  getDbSize(): number {
    const pageCount = this.db.pragma('page_count', { simple: true }) as number;
    const pageSize = this.db.pragma('page_size', { simple: true }) as number;
    return pageCount * pageSize;
  }

  close(): void {
    this.db.close();
  }
}
