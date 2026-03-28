import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import net from 'node:net';
import { createApiRouter } from './api.js';
import { Database } from '../storage/db.js';
import { EventManager } from './events.js';
import type { RequestRecord } from '../shared/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

function makeRequest(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id: randomUUID(),
    timestamp: Date.now(),
    method: 'GET',
    url: 'http://example.com/test',
    host: 'example.com',
    path: '/test',
    protocol: 'http' as const,
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

function httpReq(port: number, reqPath: string, method = 'GET'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: reqPath, method }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('REST API', () => {
  let db: Database;
  let dbPath: string;
  let events: EventManager;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `laurel-proxy-api-test-${randomUUID()}.db`);
    db = new Database(dbPath);
    events = new EventManager();
    const app = express();
    app.use(express.json());
    const router = createApiRouter(db, events, {
      getProxyRunning: () => true,
      getProxyPort: () => 8080,
      startProxy: async () => {},
      stopProxy: async () => {},
    });
    app.use('/api', router);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        port = (server.address() as net.AddressInfo).port;
        resolve();
      });
    });
  });

  afterEach(() => {
    server.close();
    events.stop();
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('GET /api/requests returns paginated list', async () => {
    db.insert(makeRequest());
    db.insert(makeRequest());
    const res = await httpReq(port, '/api/requests');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.limit).toBe(100);
    expect(body.offset).toBe(0);
  });

  it('GET /api/requests filters by host', async () => {
    db.insert(makeRequest({ host: 'api.example.com' }));
    db.insert(makeRequest({ host: 'cdn.other.com' }));
    const res = await httpReq(port, '/api/requests?host=example');
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].host).toBe('api.example.com');
  });

  it('GET /api/requests/:id returns single request', async () => {
    const req = makeRequest();
    db.insert(req);
    const res = await httpReq(port, `/api/requests/${req.id}`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(req.id);
  });

  it('GET /api/requests/:id returns 404 for unknown id', async () => {
    const res = await httpReq(port, '/api/requests/nonexistent');
    expect(res.status).toBe(404);
  });

  it('DELETE /api/requests clears all', async () => {
    db.insert(makeRequest());
    const res = await httpReq(port, '/api/requests', 'DELETE');
    expect(res.status).toBe(200);
    expect(db.getRequestCount()).toBe(0);
  });

  it('GET /api/status returns proxy status', async () => {
    const res = await httpReq(port, '/api/status');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.running).toBe(true);
    expect(body.proxyPort).toBe(8080);
  });
});
