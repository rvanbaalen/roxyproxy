import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from './db.js';
import { randomUUID } from 'node:crypto';
import type { RequestRecord } from '../shared/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function makeRequest(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id: randomUUID(),
    timestamp: Date.now(),
    method: 'GET',
    url: 'http://example.com/test',
    host: 'example.com',
    path: '/test',
    protocol: 'http',
    request_headers: '{"host":"example.com"}',
    request_body: null,
    request_size: 0,
    status: 200,
    response_headers: '{"content-type":"text/html"}',
    response_body: Buffer.from('hello'),
    response_size: 5,
    duration: 100,
    content_type: 'text/html',
    truncated: 0,
    ...overrides,
  };
}

describe('Database', () => {
  let db: Database;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `roxyproxy-test-${randomUUID()}.db`);
    db = new Database(dbPath);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('inserts and retrieves a request', () => {
    const req = makeRequest();
    db.insert(req);
    const result = db.getById(req.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(req.id);
    expect(result!.host).toBe('example.com');
    expect(result!.status).toBe(200);
  });

  it('queries with host filter', () => {
    db.insert(makeRequest({ host: 'api.example.com' }));
    db.insert(makeRequest({ host: 'cdn.other.com' }));
    const result = db.query({ host: 'example' });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].host).toBe('api.example.com');
    expect(result.total).toBe(1);
  });

  it('queries with status filter', () => {
    db.insert(makeRequest({ status: 200 }));
    db.insert(makeRequest({ status: 500 }));
    const result = db.query({ status: 500 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].status).toBe(500);
  });

  it('queries with method filter', () => {
    db.insert(makeRequest({ method: 'GET' }));
    db.insert(makeRequest({ method: 'POST' }));
    const result = db.query({ method: 'POST' });
    expect(result.data).toHaveLength(1);
  });

  it('queries with search filter on URL', () => {
    db.insert(makeRequest({ url: 'http://example.com/api/v2/users' }));
    db.insert(makeRequest({ url: 'http://example.com/index.html' }));
    const result = db.query({ search: '/api/v2' });
    expect(result.data).toHaveLength(1);
  });

  it('queries with time range', () => {
    const now = Date.now();
    db.insert(makeRequest({ timestamp: now - 10000 }));
    db.insert(makeRequest({ timestamp: now }));
    const result = db.query({ since: now - 5000 });
    expect(result.data).toHaveLength(1);
  });

  it('paginates results', () => {
    for (let i = 0; i < 5; i++) {
      db.insert(makeRequest({ timestamp: Date.now() + i }));
    }
    const page1 = db.query({ limit: 2, offset: 0 });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.limit).toBe(2);
    expect(page1.offset).toBe(0);
  });

  it('deletes all requests', () => {
    db.insert(makeRequest());
    db.insert(makeRequest());
    db.deleteAll();
    const result = db.query({});
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('returns request count and db size', () => {
    db.insert(makeRequest());
    expect(db.getRequestCount()).toBe(1);
    expect(db.getDbSize()).toBeGreaterThan(0);
  });

  it('batch inserts multiple requests', () => {
    const requests = [makeRequest(), makeRequest(), makeRequest()];
    db.insertBatch(requests);
    expect(db.getRequestCount()).toBe(3);
  });
});
