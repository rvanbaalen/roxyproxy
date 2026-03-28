# Laurel Proxy Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an HTTP/HTTPS intercepting proxy with SQLite storage, CLI querying, and a React web UI.

**Architecture:** Single Node.js/TypeScript monolith. Proxy engine captures HTTP/HTTPS traffic via MITM, stores in SQLite with batched writes, exposes a REST API + SSE for live updates, serves a React 19 SPA, and provides a CLI for querying captured data.

**Tech Stack:** Node.js 22, TypeScript, better-sqlite3, node-forge, Express, Commander, React 19, Vite, Tailwind CSS v4

**Spec:** `docs/superpowers/specs/2026-03-17-laurel-proxy-design.md`

---

## File Structure

```
laurel-proxy/
├── package.json              # Monorepo root, workspaces for server + ui
├── tsconfig.json             # Base TS config
├── tsconfig.server.json      # Server TS config (Node target)
├── src/
│   ├── shared/
│   │   └── types.ts          # Shared types (RequestRecord, Config, etc.)
│   ├── storage/
│   │   ├── db.ts             # Database class: init, insert, query, delete
│   │   ├── cleanup.ts        # Auto-cleanup timer logic
│   │   └── db.test.ts        # Storage tests
│   ├── server/
│   │   ├── ssl.ts            # CA generation, per-domain cert generation, LRU cache
│   │   ├── ssl.test.ts       # SSL tests
│   │   ├── proxy.ts          # HTTP + HTTPS proxy engine
│   │   ├── proxy.test.ts     # Proxy tests
│   │   ├── api.ts            # Express REST API routes
│   │   ├── api.test.ts       # API tests
│   │   ├── events.ts         # SSE event manager (batching, Last-Event-ID)
│   │   ├── events.test.ts    # SSE tests
│   │   ├── config.ts         # Config loading (defaults, file, CLI flags)
│   │   └── index.ts          # Server entry: wires proxy + api + storage
│   ├── cli/
│   │   ├── index.ts          # CLI entry point (commander setup)
│   │   ├── commands/
│   │   │   ├── start.ts      # start command (launches server)
│   │   │   ├── stop.ts       # stop command (API + PID fallback)
│   │   │   ├── status.ts     # status command
│   │   │   ├── requests.ts   # requests query command
│   │   │   ├── request.ts    # single request detail command
│   │   │   ├── clear.ts      # clear command
│   │   │   └── trust-ca.ts   # trust-ca command
│   │   └── format.ts         # JSON and table output formatters
│   └── ui/                   # React 19 SPA (Vite project)
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── api.ts            # API client + SSE hook
│       └── components/
│           ├── TrafficList.tsx
│           ├── RequestDetail.tsx
│           ├── FilterBar.tsx
│           └── Controls.tsx
├── vite.config.ts            # Vite config for UI build
└── tests/
    └── integration/
        └── proxy.integration.test.ts  # End-to-end proxy test
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.server.json`
- Create: `src/shared/types.ts`
- Create: `.gitignore`

- [ ] **Step 1: Initialize package.json**

```bash
cd /Users/robin/Sites/projects/laurel-proxy
npm init -y
```

Then edit `package.json`:

```json
{
  "name": "laurel-proxy",
  "version": "0.1.0",
  "description": "HTTP/HTTPS intercepting proxy with CLI and web UI",
  "type": "module",
  "bin": {
    "laurel-proxy": "./dist/cli/index.js"
  },
  "scripts": {
    "build:server": "tsc -p tsconfig.server.json",
    "build:ui": "vite build",
    "build": "npm run build:server && npm run build:ui",
    "dev:ui": "vite",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Install runtime dependencies**

```bash
npm install better-sqlite3 node-forge commander express uuid
```

- [ ] **Step 3: Install dev dependencies**

```bash
npm install -D typescript vite vitest react react-dom tailwindcss @tailwindcss/vite @types/node @types/express @types/better-sqlite3 @types/uuid @types/node-forge @types/react @types/react-dom
```

- [ ] **Step 4: Create tsconfig.json (base)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "baseUrl": "."
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/ui/**", "node_modules", "dist"]
}
```

- [ ] **Step 5: Create tsconfig.server.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist"
  },
  "include": ["src/shared/**/*.ts", "src/storage/**/*.ts", "src/server/**/*.ts", "src/cli/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "node_modules", "dist"]
}
```

- [ ] **Step 6: Create .gitignore**

```
node_modules/
dist/
*.db
*.db-wal
*.db-shm
```

- [ ] **Step 7: Create shared types**

Create `src/shared/types.ts`:

```typescript
export interface RequestRecord {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  host: string;
  path: string;
  protocol: 'http' | 'https';
  request_headers: string; // JSON
  request_body: Buffer | null;
  request_size: number;
  status: number | null;
  response_headers: string | null; // JSON
  response_body: Buffer | null;
  response_size: number;
  duration: number | null;
  content_type: string | null;
  truncated: number;
}

export interface Config {
  proxyPort: number;
  uiPort: number;
  dbPath: string;
  maxAge: number;       // ms
  maxDbSize: number;    // bytes
  maxBodySize: number;  // bytes
  certCacheSize: number;
}

export const DEFAULT_CONFIG: Config = {
  proxyPort: 8080,
  uiPort: 8081,
  dbPath: '~/.laurel-proxy/data.db',
  maxAge: 7 * 24 * 60 * 60 * 1000,       // 7 days
  maxDbSize: 500 * 1024 * 1024,           // 500MB
  maxBodySize: 1 * 1024 * 1024,           // 1MB
  certCacheSize: 500,
};

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProxyStatus {
  running: boolean;
  proxyPort: number;
  uiPort: number;
  requestCount: number;
  dbSizeBytes: number;
}

export interface RequestFilter {
  host?: string;
  status?: number;
  method?: string;
  content_type?: string;
  search?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.server.json .gitignore src/shared/types.ts
git commit -m "feat: scaffold project with TypeScript config and shared types"
```

---

## Task 2: SQLite Storage Layer

**Files:**
- Create: `src/storage/db.ts`
- Create: `src/storage/cleanup.ts`
- Create: `src/storage/db.test.ts`

- [ ] **Step 1: Write storage tests**

Create `src/storage/db.test.ts`:

```typescript
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
    dbPath = path.join(os.tmpdir(), `laurel-proxy-test-${randomUUID()}.db`);
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
```

- [ ] **Step 2: Configure vitest**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run src/storage/db.test.ts
```

Expected: FAIL — `./db.js` module not found.

- [ ] **Step 4: Implement Database class**

Create `src/storage/db.ts`:

```typescript
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
    this.db.pragma('auto_vacuum = INCREMENTAL');
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
  }

  deleteOlderThan(timestampMs: number): number {
    const stmt = this.db.prepare('DELETE FROM requests WHERE timestamp < ?');
    return stmt.run(timestampMs).changes;
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
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/storage/db.test.ts
```

Expected: All 10 tests PASS.

- [ ] **Step 6: Implement cleanup**

Create `src/storage/cleanup.ts`:

```typescript
import type { Database } from './db.js';
import type { Config } from '../shared/types.js';

export class Cleanup {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: Database,
    private config: Config,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.run(), 5 * 60 * 1000); // 5 minutes
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  run(): void {
    // Delete by age
    const cutoff = Date.now() - this.config.maxAge;
    this.db.deleteOlderThan(cutoff);

    // Delete by size — keep removing oldest until under limit
    while (this.db.getDbSize() > this.config.maxDbSize) {
      const deleted = this.db.deleteOlderThan(Date.now());
      if (deleted === 0) break; // safety valve
    }
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts src/storage/ src/shared/
git commit -m "feat: add SQLite storage layer with query filtering and auto-cleanup"
```

---

## Task 3: SSL Certificate Management

**Files:**
- Create: `src/server/ssl.ts`
- Create: `src/server/ssl.test.ts`

- [ ] **Step 1: Write SSL tests**

Create `src/server/ssl.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CertificateAuthority } from './ssl.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

describe('CertificateAuthority', () => {
  let caDir: string;
  let ca: CertificateAuthority;

  beforeEach(() => {
    caDir = path.join(os.tmpdir(), `laurel-proxy-ca-test-${randomUUID()}`);
    ca = new CertificateAuthority(caDir, 10);
  });

  afterEach(() => {
    fs.rmSync(caDir, { recursive: true, force: true });
  });

  it('generates CA cert and key on init', () => {
    ca.init();
    expect(fs.existsSync(path.join(caDir, 'ca.crt'))).toBe(true);
    expect(fs.existsSync(path.join(caDir, 'ca.key'))).toBe(true);
  });

  it('reuses existing CA cert on subsequent init', () => {
    ca.init();
    const certBefore = fs.readFileSync(path.join(caDir, 'ca.crt'), 'utf-8');
    ca.init();
    const certAfter = fs.readFileSync(path.join(caDir, 'ca.crt'), 'utf-8');
    expect(certBefore).toBe(certAfter);
  });

  it('generates a domain certificate', () => {
    ca.init();
    const { cert, key } = ca.getCertForHost('example.com');
    expect(cert).toContain('-----BEGIN CERTIFICATE-----');
    expect(key).toContain('-----BEGIN RSA PRIVATE KEY-----');
  });

  it('caches domain certificates', () => {
    ca.init();
    const first = ca.getCertForHost('example.com');
    const second = ca.getCertForHost('example.com');
    expect(first.cert).toBe(second.cert);
  });

  it('evicts least-recently-used certs when cache is full', () => {
    ca = new CertificateAuthority(caDir, 2); // cache size 2
    ca.init();
    ca.getCertForHost('a.com');
    ca.getCertForHost('b.com');
    ca.getCertForHost('c.com'); // should evict a.com
    // Getting a.com again should produce a different cert (regenerated)
    const freshA = ca.getCertForHost('a.com');
    expect(freshA.cert).toContain('-----BEGIN CERTIFICATE-----');
  });

  it('returns CA cert path', () => {
    ca.init();
    expect(ca.getCaCertPath()).toBe(path.join(caDir, 'ca.crt'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/server/ssl.test.ts
```

Expected: FAIL — `./ssl.js` module not found.

- [ ] **Step 3: Implement CertificateAuthority**

Create `src/server/ssl.ts`:

```typescript
import forge from 'node-forge';
import fs from 'node:fs';
import path from 'node:path';

interface CertKeyPair {
  cert: string;
  key: string;
}

export class CertificateAuthority {
  private caCert: forge.pki.Certificate | null = null;
  private caKey: forge.pki.rsa.PrivateKey | null = null;
  private cache: Map<string, CertKeyPair> = new Map();
  private cacheOrder: string[] = [];

  constructor(
    private caDir: string,
    private cacheSize: number = 500,
  ) {}

  init(): void {
    fs.mkdirSync(this.caDir, { recursive: true });

    const certPath = path.join(this.caDir, 'ca.crt');
    const keyPath = path.join(this.caDir, 'ca.key');

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      const certPem = fs.readFileSync(certPath, 'utf-8');
      const keyPem = fs.readFileSync(keyPath, 'utf-8');
      this.caCert = forge.pki.certificateFromPem(certPem);
      this.caKey = forge.pki.privateKeyFromPem(keyPem);
      return;
    }

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

    const attrs = [
      { name: 'commonName', value: 'Laurel Proxy CA' },
      { name: 'organizationName', value: 'Laurel Proxy' },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true },
    ]);

    cert.sign(keys.privateKey, forge.md.sha256.create());

    fs.writeFileSync(certPath, forge.pki.certificateToPem(cert));
    fs.writeFileSync(keyPath, forge.pki.privateKeyToPem(keys.privateKey));

    this.caCert = cert;
    this.caKey = keys.privateKey;
  }

  getCertForHost(hostname: string): CertKeyPair {
    if (!this.caCert || !this.caKey) {
      throw new Error('CA not initialized. Call init() first.');
    }

    const cached = this.cache.get(hostname);
    if (cached) {
      // Move to end (most recently used)
      this.cacheOrder = this.cacheOrder.filter(h => h !== hostname);
      this.cacheOrder.push(hostname);
      return cached;
    }

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = Date.now().toString(16);
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

    cert.setSubject([{ name: 'commonName', value: hostname }]);
    cert.setIssuer(this.caCert.subject.attributes);
    cert.setExtensions([
      { name: 'subjectAltName', altNames: [{ type: 2, value: hostname }] },
    ]);

    cert.sign(this.caKey, forge.md.sha256.create());

    const pair: CertKeyPair = {
      cert: forge.pki.certificateToPem(cert),
      key: forge.pki.privateKeyToPem(keys.privateKey),
    };

    // Evict LRU if cache full
    if (this.cacheOrder.length >= this.cacheSize) {
      const evicted = this.cacheOrder.shift()!;
      this.cache.delete(evicted);
    }

    this.cache.set(hostname, pair);
    this.cacheOrder.push(hostname);
    return pair;
  }

  getCaCertPath(): string {
    return path.join(this.caDir, 'ca.crt');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/server/ssl.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ssl.ts src/server/ssl.test.ts
git commit -m "feat: add CA certificate generation with LRU-cached per-domain certs"
```

---

## Task 4: Configuration

**Files:**
- Create: `src/server/config.ts`

- [ ] **Step 1: Implement config loader**

Create `src/server/config.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Config } from '../shared/types.js';
import { DEFAULT_CONFIG } from '../shared/types.js';

function expandHome(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

function parseSize(value: string): number {
  const match = value.match(/^(\d+)\s*(MB|GB|KB|B)?$/i);
  if (!match) return parseInt(value, 10);
  const num = parseInt(match[1], 10);
  const unit = (match[2] || 'B').toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024,
  };
  return num * (multipliers[unit] || 1);
}

function parseDuration(value: string): number {
  const match = value.match(/^(\d+)\s*(ms|s|m|h|d)?$/i);
  if (!match) return parseInt(value, 10);
  const num = parseInt(match[1], 10);
  const unit = (match[2] || 'ms').toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000,
  };
  return num * (multipliers[unit] || 1);
}

export function loadConfig(cliFlags: Partial<Config> = {}): Config {
  let fileConfig: Partial<Config> = {};

  const configPath = expandHome('~/.laurel-proxy/config.json');
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      fileConfig = {
        proxyPort: raw.proxyPort,
        uiPort: raw.uiPort,
        dbPath: raw.dbPath,
        maxAge: typeof raw.maxAge === 'string' ? parseDuration(raw.maxAge) : raw.maxAge,
        maxDbSize: typeof raw.maxDbSize === 'string' ? parseSize(raw.maxDbSize) : raw.maxDbSize,
        maxBodySize: typeof raw.maxBodySize === 'string' ? parseSize(raw.maxBodySize) : raw.maxBodySize,
        certCacheSize: raw.certCacheSize,
      };
      // Remove undefined entries
      for (const key of Object.keys(fileConfig) as (keyof Config)[]) {
        if (fileConfig[key] === undefined) delete fileConfig[key];
      }
    } catch {
      // Ignore invalid config file
    }
  }

  const merged: Config = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...cliFlags,
  };

  // Expand ~ in dbPath
  merged.dbPath = expandHome(merged.dbPath);

  return merged;
}

export { expandHome, parseSize, parseDuration };
```

- [ ] **Step 2: Commit**

```bash
git add src/server/config.ts
git commit -m "feat: add config loading with defaults, file, and CLI flag merging"
```

---

## Task 5: SSE Event Manager

**Files:**
- Create: `src/server/events.ts`
- Create: `src/server/events.test.ts`

- [ ] **Step 1: Write SSE tests**

Create `src/server/events.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventManager } from './events.js';
import type { RequestRecord } from '../shared/types.js';

function makeRequest(id: string): RequestRecord {
  return {
    id,
    timestamp: Date.now(),
    method: 'GET',
    url: 'http://example.com',
    host: 'example.com',
    path: '/',
    protocol: 'http',
    request_headers: '{}',
    request_body: null,
    request_size: 0,
    status: 200,
    response_headers: '{}',
    response_body: null,
    response_size: 0,
    duration: 50,
    content_type: 'text/html',
    truncated: 0,
  };
}

describe('EventManager', () => {
  let em: EventManager;

  beforeEach(() => {
    vi.useFakeTimers();
    em = new EventManager();
  });

  afterEach(() => {
    em.stop();
    vi.useRealTimers();
  });

  it('emits events to subscribers', () => {
    const received: RequestRecord[] = [];
    em.subscribe((events) => received.push(...events));
    em.push(makeRequest('r1'));
    vi.advanceTimersByTime(150);
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe('r1');
  });

  it('batches events within 100ms window', () => {
    let callCount = 0;
    em.subscribe(() => { callCount++; });
    em.push(makeRequest('r1'));
    em.push(makeRequest('r2'));
    em.push(makeRequest('r3'));
    vi.advanceTimersByTime(150);
    expect(callCount).toBe(1); // single batched call
  });

  it('removes subscriber on unsubscribe', () => {
    const received: RequestRecord[] = [];
    const unsub = em.subscribe((events) => received.push(...events));
    unsub();
    em.push(makeRequest('r1'));
    vi.advanceTimersByTime(150);
    expect(received).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/server/events.test.ts
```

Expected: FAIL — `./events.js` not found.

- [ ] **Step 3: Implement EventManager**

Create `src/server/events.ts`:

```typescript
import type { RequestRecord } from '../shared/types.js';

type Subscriber = (events: RequestRecord[]) => void;

export class EventManager {
  private subscribers: Set<Subscriber> = new Set();
  private buffer: RequestRecord[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  push(record: RequestRecord): void {
    this.buffer.push(record);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), 100);
    }
  }

  private flush(): void {
    this.timer = null;
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    for (const sub of this.subscribers) {
      try { sub(batch); } catch {}
    }
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.buffer = [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/server/events.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/events.ts src/server/events.test.ts
git commit -m "feat: add SSE event manager with 100ms batching"
```

---

## Task 6: Proxy Engine

**Files:**
- Create: `src/server/proxy.ts`
- Create: `src/server/proxy.test.ts`

- [ ] **Step 1: Write proxy tests**

Create `src/server/proxy.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { ProxyServer } from './proxy.js';
import { Database } from '../storage/db.js';
import { CertificateAuthority } from './ssl.js';
import { EventManager } from './events.js';
import { DEFAULT_CONFIG } from '../shared/types.js';
import type { Config } from '../shared/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

// Simple target HTTP server for testing
function createTargetServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'hello' }));
      } else if (req.url === '/echo') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(body);
        });
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function httpGet(url: string, proxyPort: number): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const proxyUrl = new URL(url);
    const req = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'GET',
      path: url,
      headers: { Host: proxyUrl.hostname },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('ProxyServer - HTTP', () => {
  let targetServer: http.Server;
  let targetPort: number;
  let proxy: ProxyServer;
  let db: Database;
  let events: EventManager;
  let dbPath: string;
  let caDir: string;
  let proxyPort: number;

  beforeAll(async () => {
    targetServer = await createTargetServer();
    targetPort = (targetServer.address() as net.AddressInfo).port;
  });

  afterAll(() => {
    targetServer.close();
  });

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `laurel-proxy-test-${randomUUID()}.db`);
    caDir = path.join(os.tmpdir(), `laurel-proxy-ca-test-${randomUUID()}`);
    db = new Database(dbPath);
    events = new EventManager();
    const ca = new CertificateAuthority(caDir, 10);
    ca.init();
    const config: Config = {
      ...DEFAULT_CONFIG,
      proxyPort: 0, // random available port
      dbPath,
      maxBodySize: 1024 * 1024,
    };
    proxy = new ProxyServer(db, ca, events, config);
    proxyPort = await proxy.start();
  });

  afterEach(async () => {
    await proxy.stop();
    events.stop();
    db.close();
    fs.rmSync(caDir, { recursive: true, force: true });
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('proxies HTTP GET and captures the request', async () => {
    const url = `http://127.0.0.1:${targetPort}/json`;
    const res = await httpGet(url, proxyPort);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ message: 'hello' });

    // Wait for write queue flush
    await new Promise(r => setTimeout(r, 200));
    const count = db.getRequestCount();
    expect(count).toBe(1);

    const result = db.query({});
    expect(result.data[0].method).toBe('GET');
    expect(result.data[0].status).toBe(200);
  });

  it('captures request body on POST', async () => {
    const url = `http://127.0.0.1:${targetPort}/echo`;
    const postBody = 'test body content';

    await new Promise<void>((resolve, reject) => {
      const proxyUrl = new URL(url);
      const req = http.request({
        host: '127.0.0.1',
        port: proxyPort,
        method: 'POST',
        path: url,
        headers: {
          Host: proxyUrl.hostname,
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(postBody).toString(),
        },
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          expect(res.statusCode).toBe(200);
          expect(body).toBe(postBody);
          resolve();
        });
      });
      req.on('error', reject);
      req.write(postBody);
      req.end();
    });

    await new Promise(r => setTimeout(r, 200));
    const result = db.query({});
    expect(result.data[0].method).toBe('POST');
    expect(result.data[0].request_size).toBe(Buffer.byteLength(postBody));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/server/proxy.test.ts
```

Expected: FAIL — `./proxy.js` not found.

- [ ] **Step 3: Implement ProxyServer**

Create `src/server/proxy.ts`:

```typescript
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import zlib from 'node:zlib';
import type { Database } from '../storage/db.js';
import type { CertificateAuthority } from './ssl.js';
import type { EventManager } from './events.js';
import type { Config, RequestRecord } from '../shared/types.js';

export class ProxyServer {
  private server: http.Server | null = null;
  private writeQueue: RequestRecord[] = [];
  private writeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: Database,
    private ca: CertificateAuthority,
    private events: EventManager,
    private config: Config,
  ) {}

  async start(): Promise<number> {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.on('connect', (req, clientSocket, head) => this.handleConnect(req, clientSocket, head));

    // Flush write queue every 100ms
    this.writeTimer = setInterval(() => this.flushWrites(), 100);

    return new Promise((resolve) => {
      this.server!.listen(this.config.proxyPort, () => {
        const addr = this.server!.address() as net.AddressInfo;
        resolve(addr.port);
      });
    });
  }

  async stop(): Promise<void> {
    if (this.writeTimer) {
      clearInterval(this.writeTimer);
      this.writeTimer = null;
    }
    this.flushWrites();
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  get port(): number {
    if (!this.server) return 0;
    const addr = this.server.address() as net.AddressInfo | null;
    return addr?.port ?? 0;
  }

  private flushWrites(): void {
    if (this.writeQueue.length === 0) return;
    const batch = this.writeQueue;
    this.writeQueue = [];
    this.db.insertBatch(batch);
  }

  private handleRequest(clientReq: http.IncomingMessage, clientRes: http.ServerResponse): void {
    const startTime = Date.now();
    const id = randomUUID();

    const url = clientReq.url || '/';
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      clientRes.writeHead(400);
      clientRes.end('Bad Request');
      return;
    }

    const requestBodyChunks: Buffer[] = [];

    clientReq.on('data', (chunk: Buffer) => {
      requestBodyChunks.push(chunk);
    });

    clientReq.on('end', () => {
      const requestBody = Buffer.concat(requestBodyChunks);

      const options: http.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname + parsed.search,
        method: clientReq.method,
        headers: { ...clientReq.headers },
      };
      // Remove proxy-specific headers
      delete options.headers!['proxy-connection'];

      const proxyReq = http.request(options, (proxyRes) => {
        const responseBodyChunks: Buffer[] = [];

        proxyRes.on('data', (chunk: Buffer) => {
          responseBodyChunks.push(chunk);
        });

        proxyRes.on('end', () => {
          const rawResponseBody = Buffer.concat(responseBodyChunks);
          const responseBody = this.decodeBody(rawResponseBody, proxyRes.headers['content-encoding']);

          // Forward response to client
          const headers = { ...proxyRes.headers };
          // Remove content-encoding since we decoded it
          delete headers['content-encoding'];
          headers['content-length'] = responseBody.length.toString();
          clientRes.writeHead(proxyRes.statusCode || 500, headers);
          clientRes.end(responseBody);

          const truncated = requestBody.length > this.config.maxBodySize || responseBody.length > this.config.maxBodySize;
          const contentType = (proxyRes.headers['content-type'] || '').split(';')[0].trim() || null;

          const record: RequestRecord = {
            id,
            timestamp: startTime,
            method: clientReq.method || 'GET',
            url,
            host: parsed.hostname || '',
            path: parsed.pathname || '/',
            protocol: 'http',
            request_headers: JSON.stringify(clientReq.headers),
            request_body: requestBody.length > 0 ? requestBody.slice(0, this.config.maxBodySize) : null,
            request_size: requestBody.length,
            status: proxyRes.statusCode || 0,
            response_headers: JSON.stringify(proxyRes.headers),
            response_body: responseBody.length > 0 ? responseBody.slice(0, this.config.maxBodySize) : null,
            response_size: responseBody.length,
            duration: Date.now() - startTime,
            content_type: contentType,
            truncated: truncated ? 1 : 0,
          };

          this.writeQueue.push(record);
          this.events.push(record);
        });
      });

      proxyReq.on('error', () => {
        clientRes.writeHead(502);
        clientRes.end('Bad Gateway');
      });

      if (requestBody.length > 0) {
        proxyReq.write(requestBody);
      }
      proxyReq.end();
    });
  }

  private handleConnect(req: http.IncomingMessage, clientSocket: net.Socket, _head: Buffer): void {
    const [hostname, portStr] = (req.url || '').split(':');
    const port = parseInt(portStr || '443', 10);

    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

    try {
      const { cert, key } = this.ca.getCertForHost(hostname);

      const tlsSocket = new tls.TLSSocket(clientSocket, {
        isServer: true,
        cert,
        key,
      });

      // Create a virtual HTTPS server on this TLS socket
      const virtualServer = http.createServer((clientReq, clientRes) => {
        this.handleMitmRequest(hostname, port, clientReq, clientRes);
      });

      virtualServer.emit('connection', tlsSocket);
    } catch {
      clientSocket.end();
    }
  }

  private handleMitmRequest(hostname: string, port: number, clientReq: http.IncomingMessage, clientRes: http.ServerResponse): void {
    const startTime = Date.now();
    const id = randomUUID();
    const urlPath = clientReq.url || '/';
    const fullUrl = `https://${hostname}${urlPath}`;

    const requestBodyChunks: Buffer[] = [];

    clientReq.on('data', (chunk: Buffer) => {
      requestBodyChunks.push(chunk);
    });

    clientReq.on('end', () => {
      const requestBody = Buffer.concat(requestBodyChunks);

      const options: https.RequestOptions = {
        hostname,
        port,
        path: urlPath,
        method: clientReq.method,
        headers: { ...clientReq.headers, host: hostname },
        rejectUnauthorized: false, // We're intercepting, can't verify upstream
      };

      const proxyReq = https.request(options, (proxyRes) => {
        const responseBodyChunks: Buffer[] = [];

        proxyRes.on('data', (chunk: Buffer) => {
          responseBodyChunks.push(chunk);
        });

        proxyRes.on('end', () => {
          const rawResponseBody = Buffer.concat(responseBodyChunks);
          const responseBody = this.decodeBody(rawResponseBody, proxyRes.headers['content-encoding']);

          const headers = { ...proxyRes.headers };
          delete headers['content-encoding'];
          delete headers['transfer-encoding'];
          headers['content-length'] = responseBody.length.toString();
          clientRes.writeHead(proxyRes.statusCode || 500, headers);
          clientRes.end(responseBody);

          const truncated = requestBody.length > this.config.maxBodySize || responseBody.length > this.config.maxBodySize;
          const contentType = (proxyRes.headers['content-type'] || '').split(';')[0].trim() || null;

          const record: RequestRecord = {
            id,
            timestamp: startTime,
            method: clientReq.method || 'GET',
            url: fullUrl,
            host: hostname,
            path: urlPath,
            protocol: 'https',
            request_headers: JSON.stringify(clientReq.headers),
            request_body: requestBody.length > 0 ? requestBody.slice(0, this.config.maxBodySize) : null,
            request_size: requestBody.length,
            status: proxyRes.statusCode || 0,
            response_headers: JSON.stringify(proxyRes.headers),
            response_body: responseBody.length > 0 ? responseBody.slice(0, this.config.maxBodySize) : null,
            response_size: responseBody.length,
            duration: Date.now() - startTime,
            content_type: contentType,
            truncated: truncated ? 1 : 0,
          };

          this.writeQueue.push(record);
          this.events.push(record);
        });
      });

      proxyReq.on('error', () => {
        clientRes.writeHead(502);
        clientRes.end('Bad Gateway');
      });

      if (requestBody.length > 0) {
        proxyReq.write(requestBody);
      }
      proxyReq.end();
    });
  }

  private decodeBody(body: Buffer, encoding?: string): Buffer {
    if (!encoding || !body.length) return body;
    try {
      switch (encoding) {
        case 'gzip': return zlib.gunzipSync(body);
        case 'deflate': return zlib.inflateSync(body);
        case 'br': return zlib.brotliDecompressSync(body);
        default: return body;
      }
    } catch {
      return body; // Return raw if decompression fails
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/server/proxy.test.ts
```

Expected: Both HTTP proxy tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/proxy.ts src/server/proxy.test.ts
git commit -m "feat: add HTTP/HTTPS proxy engine with MITM interception"
```

---

## Task 7: REST API

**Files:**
- Create: `src/server/api.ts`
- Create: `src/server/api.test.ts`

- [ ] **Step 1: Write API tests**

Create `src/server/api.test.ts`:

```typescript
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

function httpReq(port: number, path: string, method = 'GET'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method }, (res) => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/server/api.test.ts
```

Expected: FAIL — `./api.js` not found.

- [ ] **Step 3: Implement API router**

Create `src/server/api.ts`:

```typescript
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Database } from '../storage/db.js';
import type { EventManager } from './events.js';
import type { RequestFilter } from '../shared/types.js';

export interface ProxyControl {
  getProxyRunning: () => boolean;
  getProxyPort: () => number;
  startProxy: () => Promise<void>;
  stopProxy: () => Promise<void>;
}

export function createApiRouter(
  db: Database,
  events: EventManager,
  proxy: ProxyControl,
): Router {
  const router = Router();

  // List/filter requests
  router.get('/requests', (req: Request, res: Response) => {
    const filter: RequestFilter = {};
    if (req.query.host) filter.host = req.query.host as string;
    if (req.query.status) filter.status = parseInt(req.query.status as string, 10);
    if (req.query.method) filter.method = req.query.method as string;
    if (req.query.content_type) filter.content_type = req.query.content_type as string;
    if (req.query.search) filter.search = req.query.search as string;
    if (req.query.since) filter.since = parseInt(req.query.since as string, 10);
    if (req.query.until) filter.until = parseInt(req.query.until as string, 10);
    if (req.query.limit) filter.limit = parseInt(req.query.limit as string, 10);
    if (req.query.offset) filter.offset = parseInt(req.query.offset as string, 10);

    const result = db.query(filter);
    res.json(result);
  });

  // Get single request
  router.get('/requests/:id', (req: Request, res: Response) => {
    const record = db.getById(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(record);
  });

  // Clear all requests
  router.delete('/requests', (_req: Request, res: Response) => {
    db.deleteAll();
    res.json({ ok: true });
  });

  // Proxy status
  router.get('/status', (_req: Request, res: Response) => {
    res.json({
      running: proxy.getProxyRunning(),
      proxyPort: proxy.getProxyPort(),
      requestCount: db.getRequestCount(),
      dbSizeBytes: db.getDbSize(),
    });
  });

  // Start proxy
  router.post('/proxy/start', async (_req: Request, res: Response) => {
    try {
      await proxy.startProxy();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Stop proxy
  router.post('/proxy/stop', async (_req: Request, res: Response) => {
    try {
      await proxy.stopProxy();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // SSE events
  router.get('/events', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const unsubscribe = events.subscribe((records) => {
      for (const record of records) {
        res.write(`id: ${record.id}\n`);
        res.write(`data: ${JSON.stringify(record)}\n\n`);
      }
    });

    req.on('close', () => {
      unsubscribe();
    });
  });

  return router;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/server/api.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/api.ts src/server/api.test.ts
git commit -m "feat: add REST API with request querying, SSE events, and proxy control"
```

---

## Task 8: Server Entry Point

**Files:**
- Create: `src/server/index.ts`

- [ ] **Step 1: Implement server orchestrator**

Create `src/server/index.ts`:

```typescript
import express from 'express';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import type { Config } from '../shared/types.js';
import { Database } from '../storage/db.js';
import { CertificateAuthority } from './ssl.js';
import { ProxyServer } from './proxy.js';
import { EventManager } from './events.js';
import { Cleanup } from '../storage/cleanup.js';
import { createApiRouter } from './api.js';
import type { ProxyControl } from './api.js';

export class LaurelProxyServer {
  private db: Database;
  private ca: CertificateAuthority;
  private proxy: ProxyServer;
  private events: EventManager;
  private cleanup: Cleanup;
  private apiServer: http.Server | null = null;
  private proxyRunning = false;
  private actualProxyPort = 0;

  constructor(private config: Config) {
    const caDir = path.join(path.dirname(config.dbPath), 'ca');
    this.db = new Database(config.dbPath);
    this.ca = new CertificateAuthority(caDir, config.certCacheSize);
    this.events = new EventManager();
    this.proxy = new ProxyServer(this.db, this.ca, this.events, config);
    this.cleanup = new Cleanup(this.db, config);
  }

  async start(): Promise<{ proxyPort: number; uiPort: number }> {
    // Init CA
    this.ca.init();

    // Start proxy
    this.actualProxyPort = await this.proxy.start();
    this.proxyRunning = true;

    // Start cleanup
    this.cleanup.start();

    // Start API + UI server
    const app = express();
    app.use(express.json());

    const proxyControl: ProxyControl = {
      getProxyRunning: () => this.proxyRunning,
      getProxyPort: () => this.actualProxyPort,
      startProxy: async () => {
        if (!this.proxyRunning) {
          this.actualProxyPort = await this.proxy.start();
          this.proxyRunning = true;
        }
      },
      stopProxy: async () => {
        if (this.proxyRunning) {
          await this.proxy.stop();
          this.proxyRunning = false;
        }
      },
    };

    app.use('/api', createApiRouter(this.db, this.events, proxyControl));

    // Serve UI static files (built Vite output)
    const uiDistPath = path.join(import.meta.dirname, '..', '..', 'dist', 'ui');
    app.use(express.static(uiDistPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(uiDistPath, 'index.html'));
    });

    const uiPort = await new Promise<number>((resolve) => {
      this.apiServer = app.listen(this.config.uiPort, () => {
        const addr = this.apiServer!.address() as net.AddressInfo;
        resolve(addr.port);
      });
    });

    return { proxyPort: this.actualProxyPort, uiPort };
  }

  async stop(): Promise<void> {
    this.cleanup.stop();
    this.events.stop();
    if (this.proxyRunning) {
      await this.proxy.stop();
      this.proxyRunning = false;
    }
    if (this.apiServer) {
      await new Promise<void>((resolve) => this.apiServer!.close(() => resolve()));
    }
    this.db.close();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: add server orchestrator wiring proxy, API, and storage"
```

---

## Task 9: CLI

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/format.ts`
- Create: `src/cli/commands/start.ts`
- Create: `src/cli/commands/stop.ts`
- Create: `src/cli/commands/status.ts`
- Create: `src/cli/commands/requests.ts`
- Create: `src/cli/commands/request.ts`
- Create: `src/cli/commands/clear.ts`
- Create: `src/cli/commands/trust-ca.ts`

- [ ] **Step 1: Implement output formatters**

Create `src/cli/format.ts`:

```typescript
import type { RequestRecord, PaginatedResponse } from '../shared/types.js';

export function formatRequests(result: PaginatedResponse<RequestRecord>, format: string): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  // Table format
  if (result.data.length === 0) {
    return 'No requests found.';
  }

  const header = ['METHOD', 'STATUS', 'HOST', 'PATH', 'DURATION', 'SIZE'].map(h => h.padEnd(12)).join('');
  const rows = result.data.map((r) => {
    return [
      (r.method || '').padEnd(12),
      String(r.status ?? '-').padEnd(12),
      (r.host || '').slice(0, 30).padEnd(12),
      (r.path || '').slice(0, 30).padEnd(12),
      (r.duration ? `${r.duration}ms` : '-').padEnd(12),
      formatBytes(r.response_size || 0).padEnd(12),
    ].join('');
  });

  const footer = `\n${result.total} total (showing ${result.data.length}, offset ${result.offset})`;
  return [header, ...rows, footer].join('\n');
}

export function formatRequest(record: RequestRecord, format: string): string {
  if (format === 'json') {
    return JSON.stringify(record, null, 2);
  }

  const lines: string[] = [
    `ID:       ${record.id}`,
    `URL:      ${record.url}`,
    `Method:   ${record.method}`,
    `Status:   ${record.status}`,
    `Duration: ${record.duration}ms`,
    `Protocol: ${record.protocol}`,
    `Time:     ${new Date(record.timestamp).toISOString()}`,
    '',
    '--- Request Headers ---',
    formatHeaders(record.request_headers),
    '',
    '--- Response Headers ---',
    formatHeaders(record.response_headers),
  ];

  if (record.request_body) {
    lines.push('', '--- Request Body ---', formatBody(record.request_body, record.content_type));
  }
  if (record.response_body) {
    lines.push('', '--- Response Body ---', formatBody(record.response_body, record.content_type));
  }

  return lines.join('\n');
}

function formatHeaders(headersJson: string | null): string {
  if (!headersJson) return '(none)';
  try {
    const headers = JSON.parse(headersJson);
    return Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`).join('\n');
  } catch {
    return headersJson;
  }
}

function formatBody(body: Buffer | null, contentType: string | null): string {
  if (!body) return '(empty)';
  const str = Buffer.isBuffer(body) ? body.toString('utf-8') : String(body);
  if (contentType?.includes('json')) {
    try { return JSON.stringify(JSON.parse(str), null, 2); } catch {}
  }
  return str;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
```

- [ ] **Step 2: Implement CLI commands**

Create `src/cli/commands/start.ts`:

```typescript
import type { Command } from 'commander';
import { loadConfig } from '../../server/config.js';
import { LaurelProxyServer } from '../../server/index.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function registerStart(program: Command): void {
  program
    .command('start')
    .description('Start the proxy server')
    .option('--port <number>', 'Proxy port', '8080')
    .option('--ui-port <number>', 'UI/API port', '8081')
    .option('--db-path <path>', 'Database path')
    .action(async (opts) => {
      const config = loadConfig({
        proxyPort: parseInt(opts.port, 10),
        uiPort: parseInt(opts.uiPort, 10),
        ...(opts.dbPath ? { dbPath: opts.dbPath } : {}),
      });

      const pidPath = path.join(os.homedir(), '.laurel-proxy', 'pid');
      fs.mkdirSync(path.dirname(pidPath), { recursive: true });
      fs.writeFileSync(pidPath, process.pid.toString());

      const server = new LaurelProxyServer(config);
      const { proxyPort, uiPort } = await server.start();

      console.log(`Laurel Proxy started`);
      console.log(`  Proxy:  http://127.0.0.1:${proxyPort}`);
      console.log(`  Web UI: http://127.0.0.1:${uiPort}`);
      console.log(`  Press Ctrl+C to stop`);

      const shutdown = async () => {
        console.log('\nShutting down...');
        await server.stop();
        try { fs.unlinkSync(pidPath); } catch {}
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
}
```

Create `src/cli/commands/stop.ts`:

```typescript
import type { Command } from 'commander';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function registerStop(program: Command): void {
  program
    .command('stop')
    .description('Stop the running proxy server')
    .option('--ui-port <number>', 'UI/API port', '8081')
    .action(async (opts) => {
      const port = parseInt(opts.uiPort, 10);

      // Try API first
      try {
        await apiPost(port, '/api/proxy/stop');
        console.log('Proxy stopped via API.');
        return;
      } catch {}

      // Fallback to PID file
      const pidPath = path.join(os.homedir(), '.laurel-proxy', 'pid');
      if (fs.existsSync(pidPath)) {
        const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
        try {
          process.kill(pid, 'SIGTERM');
          fs.unlinkSync(pidPath);
          console.log(`Sent SIGTERM to process ${pid}.`);
          return;
        } catch {}
      }

      console.error('Could not stop proxy. Is it running?');
      process.exit(1);
    });
}

function apiPost(port: number, urlPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      res.resume();
      res.on('end', () => {
        if (res.statusCode === 200) resolve();
        else reject(new Error(`HTTP ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}
```

Create `src/cli/commands/status.ts`:

```typescript
import type { Command } from 'commander';
import http from 'node:http';

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show proxy status')
    .option('--ui-port <number>', 'UI/API port', '8081')
    .action(async (opts) => {
      const port = parseInt(opts.uiPort, 10);
      try {
        const body = await apiGet(port, '/api/status');
        const status = JSON.parse(body);
        console.log(`Running:  ${status.running}`);
        console.log(`Proxy:    port ${status.proxyPort}`);
        console.log(`Requests: ${status.requestCount}`);
        console.log(`DB Size:  ${(status.dbSizeBytes / (1024 * 1024)).toFixed(1)}MB`);
      } catch {
        console.error('Proxy is not running.');
        process.exit(1);
      }
    });
}

function apiGet(port: number, urlPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.end();
  });
}
```

Create `src/cli/commands/requests.ts`:

```typescript
import type { Command } from 'commander';
import { Database } from '../../storage/db.js';
import { loadConfig } from '../../server/config.js';
import { formatRequests } from '../format.js';
import type { RequestFilter } from '../../shared/types.js';

export function registerRequests(program: Command): void {
  program
    .command('requests')
    .description('Query captured requests')
    .option('--host <pattern>', 'Filter by hostname')
    .option('--status <code>', 'Filter by status code')
    .option('--method <method>', 'Filter by HTTP method')
    .option('--search <pattern>', 'Search URL')
    .option('--since <time>', 'Requests after this time')
    .option('--until <time>', 'Requests before this time')
    .option('--limit <n>', 'Max results', '100')
    .option('--format <format>', 'Output format (json|table)', 'json')
    .option('--db-path <path>', 'Database path')
    .action((opts) => {
      const config = loadConfig(opts.dbPath ? { dbPath: opts.dbPath } : {});
      const db = new Database(config.dbPath);

      const filter: RequestFilter = {
        limit: parseInt(opts.limit, 10),
      };
      if (opts.host) filter.host = opts.host;
      if (opts.status) filter.status = parseInt(opts.status, 10);
      if (opts.method) filter.method = opts.method;
      if (opts.search) filter.search = opts.search;
      if (opts.since) filter.since = parseTime(opts.since);
      if (opts.until) filter.until = parseTime(opts.until);

      const result = db.query(filter);
      console.log(formatRequests(result, opts.format));
      db.close();
    });
}

function parseTime(value: string): number {
  const num = Number(value);
  if (!isNaN(num)) return num;
  return new Date(value).getTime();
}
```

Create `src/cli/commands/request.ts`:

```typescript
import type { Command } from 'commander';
import { Database } from '../../storage/db.js';
import { loadConfig } from '../../server/config.js';
import { formatRequest } from '../format.js';

export function registerRequest(program: Command): void {
  program
    .command('request <id>')
    .description('Show details of a single request')
    .option('--format <format>', 'Output format (json|table)', 'json')
    .option('--db-path <path>', 'Database path')
    .action((id, opts) => {
      const config = loadConfig(opts.dbPath ? { dbPath: opts.dbPath } : {});
      const db = new Database(config.dbPath);

      const record = db.getById(id);
      if (!record) {
        console.error(`Request ${id} not found.`);
        db.close();
        process.exit(1);
      }

      console.log(formatRequest(record, opts.format));
      db.close();
    });
}
```

Create `src/cli/commands/clear.ts`:

```typescript
import type { Command } from 'commander';
import http from 'node:http';

export function registerClear(program: Command): void {
  program
    .command('clear')
    .description('Clear all captured traffic')
    .option('--ui-port <number>', 'UI/API port', '8081')
    .action(async (opts) => {
      const port = parseInt(opts.uiPort, 10);
      try {
        await apiDelete(port, '/api/requests');
        console.log('All traffic cleared.');
      } catch {
        console.error('Could not clear. Is the proxy running?');
        process.exit(1);
      }
    });
}

function apiDelete(port: number, urlPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'DELETE' }, (res) => {
      res.resume();
      res.on('end', () => {
        if (res.statusCode === 200) resolve();
        else reject(new Error(`HTTP ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}
```

Create `src/cli/commands/trust-ca.ts`:

```typescript
import type { Command } from 'commander';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export function registerTrustCa(program: Command): void {
  program
    .command('trust-ca')
    .description('Show CA certificate path and trust instructions')
    .action(() => {
      const certPath = path.join(os.homedir(), '.laurel-proxy', 'ca', 'ca.crt');

      if (!fs.existsSync(certPath)) {
        console.error('CA certificate not found. Start the proxy first to generate it.');
        process.exit(1);
      }

      console.log(`CA Certificate: ${certPath}`);
      console.log('');
      console.log('To trust this certificate:');
      console.log('');
      console.log('macOS:');
      console.log(`  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`);
      console.log('');
      console.log('Linux (Debian/Ubuntu):');
      console.log(`  sudo cp "${certPath}" /usr/local/share/ca-certificates/laurel-proxy.crt`);
      console.log('  sudo update-ca-certificates');
      console.log('');
      console.log('Firefox:');
      console.log('  Settings > Privacy & Security > Certificates > Import');
    });
}
```

- [ ] **Step 3: Implement CLI entry point**

Create `src/cli/index.ts`:

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { registerStart } from './commands/start.js';
import { registerStop } from './commands/stop.js';
import { registerStatus } from './commands/status.js';
import { registerRequests } from './commands/requests.js';
import { registerRequest } from './commands/request.js';
import { registerClear } from './commands/clear.js';
import { registerTrustCa } from './commands/trust-ca.js';

const program = new Command();
program
  .name('laurel-proxy')
  .description('HTTP/HTTPS intercepting proxy with CLI and web UI')
  .version('0.1.0');

registerStart(program);
registerStop(program);
registerStatus(program);
registerRequests(program);
registerRequest(program);
registerClear(program);
registerTrustCa(program);

program.parse();
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/
git commit -m "feat: add CLI with start, stop, status, requests, clear, and trust-ca commands"
```

---

## Task 10: Web UI — Project Setup and API Client

**Files:**
- Create: `src/ui/index.html`
- Create: `src/ui/main.tsx`
- Create: `src/ui/app.css`
- Create: `src/ui/api.ts`
- Create: `vite.config.ts`

- [ ] **Step 1: Create Vite config**

Create `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'src/ui',
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8081',
    },
  },
});
```

- [ ] **Step 2: Install Vite React plugin**

```bash
npm install -D @vitejs/plugin-react
```

- [ ] **Step 3: Create HTML entry**

Create `src/ui/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Laurel Proxy</title>
  </head>
  <body class="bg-gray-950 text-gray-100 min-h-screen">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create app CSS with Tailwind import**

Create `src/ui/app.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 5: Create main.tsx**

Create `src/ui/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Create API client + SSE hook**

Create `src/ui/api.ts`:

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';

export interface RequestRecord {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  host: string;
  path: string;
  protocol: string;
  request_headers: string;
  request_body: string | null;
  request_size: number;
  status: number | null;
  response_headers: string | null;
  response_body: string | null;
  response_size: number;
  duration: number | null;
  content_type: string | null;
  truncated: number;
}

export interface ProxyStatus {
  running: boolean;
  proxyPort: number;
  requestCount: number;
  dbSizeBytes: number;
}

export interface PaginatedResponse {
  data: RequestRecord[];
  total: number;
  limit: number;
  offset: number;
}

const API_BASE = '/api';

export async function fetchRequests(params: Record<string, string> = {}): Promise<PaginatedResponse> {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/requests?${query}`);
  return res.json();
}

export async function fetchRequest(id: string): Promise<RequestRecord> {
  const res = await fetch(`${API_BASE}/requests/${id}`);
  return res.json();
}

export async function fetchStatus(): Promise<ProxyStatus> {
  const res = await fetch(`${API_BASE}/status`);
  return res.json();
}

export async function clearRequests(): Promise<void> {
  await fetch(`${API_BASE}/requests`, { method: 'DELETE' });
}

export async function startProxy(): Promise<void> {
  await fetch(`${API_BASE}/proxy/start`, { method: 'POST' });
}

export async function stopProxy(): Promise<void> {
  await fetch(`${API_BASE}/proxy/stop`, { method: 'POST' });
}

export function useSSE(maxItems = 500): RequestRecord[] {
  const [requests, setRequests] = useState<RequestRecord[]>([]);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/events`);

    es.onmessage = (event) => {
      const record: RequestRecord = JSON.parse(event.data);
      setRequests((prev) => {
        const next = [record, ...prev];
        return next.slice(0, maxItems);
      });
    };

    return () => {
      es.close();
    };
  }, [maxItems]);

  return requests;
}
```

- [ ] **Step 7: Commit**

```bash
git add vite.config.ts src/ui/index.html src/ui/main.tsx src/ui/app.css src/ui/api.ts
git commit -m "feat: add web UI project setup with Vite, React 19, Tailwind v4, and API client"
```

---

## Task 11: Web UI — Components

**Files:**
- Create: `src/ui/App.tsx`
- Create: `src/ui/components/TrafficList.tsx`
- Create: `src/ui/components/RequestDetail.tsx`
- Create: `src/ui/components/FilterBar.tsx`
- Create: `src/ui/components/Controls.tsx`

- [ ] **Step 1: Create FilterBar component**

Create `src/ui/components/FilterBar.tsx`:

```tsx
import { useState } from 'react';

interface FilterBarProps {
  onFilter: (filters: Record<string, string>) => void;
}

export function FilterBar({ onFilter }: FilterBarProps) {
  const [host, setHost] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [search, setSearch] = useState('');

  const apply = () => {
    const filters: Record<string, string> = {};
    if (host) filters.host = host;
    if (status) filters.status = status;
    if (method) filters.method = method;
    if (search) filters.search = search;
    onFilter(filters);
  };

  const clear = () => {
    setHost('');
    setStatus('');
    setMethod('');
    setSearch('');
    onFilter({});
  };

  return (
    <div className="flex items-center gap-2 p-3 bg-gray-900 border-b border-gray-800">
      <input
        type="text"
        placeholder="Host"
        value={host}
        onChange={(e) => setHost(e.target.value)}
        className="bg-gray-800 text-gray-100 px-2 py-1 rounded text-sm border border-gray-700 w-40"
      />
      <input
        type="text"
        placeholder="Status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="bg-gray-800 text-gray-100 px-2 py-1 rounded text-sm border border-gray-700 w-20"
      />
      <select
        value={method}
        onChange={(e) => setMethod(e.target.value)}
        className="bg-gray-800 text-gray-100 px-2 py-1 rounded text-sm border border-gray-700"
      >
        <option value="">All Methods</option>
        <option value="GET">GET</option>
        <option value="POST">POST</option>
        <option value="PUT">PUT</option>
        <option value="PATCH">PATCH</option>
        <option value="DELETE">DELETE</option>
        <option value="OPTIONS">OPTIONS</option>
      </select>
      <input
        type="text"
        placeholder="Search URL..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="bg-gray-800 text-gray-100 px-2 py-1 rounded text-sm border border-gray-700 flex-1"
      />
      <button onClick={apply} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm">
        Filter
      </button>
      <button onClick={clear} className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1 rounded text-sm">
        Clear
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create Controls component**

Create `src/ui/components/Controls.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { fetchStatus, startProxy, stopProxy, clearRequests } from '../api.ts';
import type { ProxyStatus } from '../api.ts';

interface ControlsProps {
  onClear: () => void;
}

export function Controls({ onClear }: ControlsProps) {
  const [status, setStatus] = useState<ProxyStatus | null>(null);

  const loadStatus = async () => {
    try {
      const s = await fetchStatus();
      setStatus(s);
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    loadStatus();
    const timer = setInterval(loadStatus, 5000);
    return () => clearInterval(timer);
  }, []);

  const toggleProxy = async () => {
    if (status?.running) {
      await stopProxy();
    } else {
      await startProxy();
    }
    await loadStatus();
  };

  const handleClear = async () => {
    await clearRequests();
    onClear();
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div className="flex items-center gap-4 p-3 bg-gray-900 border-b border-gray-800">
      <h1 className="text-lg font-bold text-white mr-4">Laurel Proxy</h1>

      <button
        onClick={toggleProxy}
        className={`px-3 py-1 rounded text-sm font-medium ${
          status?.running
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-green-600 hover:bg-green-700 text-white'
        }`}
      >
        {status?.running ? 'Stop' : 'Start'}
      </button>

      <button
        onClick={handleClear}
        className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1 rounded text-sm"
      >
        Clear
      </button>

      {status && (
        <div className="flex items-center gap-4 text-sm text-gray-400 ml-auto">
          <span className={`flex items-center gap-1 ${status.running ? 'text-green-400' : 'text-red-400'}`}>
            <span className={`w-2 h-2 rounded-full ${status.running ? 'bg-green-400' : 'bg-red-400'}`} />
            {status.running ? 'Running' : 'Stopped'}
          </span>
          <span>Port: {status.proxyPort}</span>
          <span>Requests: {status.requestCount}</span>
          <span>DB: {formatBytes(status.dbSizeBytes)}</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create TrafficList component**

Create `src/ui/components/TrafficList.tsx`:

```tsx
import type { RequestRecord } from '../api.ts';

interface TrafficListProps {
  requests: RequestRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const statusColor = (status: number | null) => {
  if (!status) return 'text-gray-500';
  if (status < 300) return 'text-green-400';
  if (status < 400) return 'text-yellow-400';
  if (status < 500) return 'text-orange-400';
  return 'text-red-400';
};

const methodColor = (method: string) => {
  const colors: Record<string, string> = {
    GET: 'text-blue-400',
    POST: 'text-green-400',
    PUT: 'text-yellow-400',
    PATCH: 'text-orange-400',
    DELETE: 'text-red-400',
  };
  return colors[method] || 'text-gray-400';
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};

export function TrafficList({ requests, selectedId, onSelect }: TrafficListProps) {
  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-900 sticky top-0">
          <tr className="text-left text-gray-400 border-b border-gray-800">
            <th className="px-3 py-2 w-20">Method</th>
            <th className="px-3 py-2 w-16">Status</th>
            <th className="px-3 py-2 w-48">Host</th>
            <th className="px-3 py-2">Path</th>
            <th className="px-3 py-2 w-20 text-right">Time</th>
            <th className="px-3 py-2 w-20 text-right">Size</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((req) => (
            <tr
              key={req.id}
              onClick={() => onSelect(req.id)}
              className={`border-b border-gray-800/50 cursor-pointer hover:bg-gray-800/50 ${
                selectedId === req.id ? 'bg-gray-800' : ''
              }`}
            >
              <td className={`px-3 py-1.5 font-mono ${methodColor(req.method)}`}>{req.method}</td>
              <td className={`px-3 py-1.5 font-mono ${statusColor(req.status)}`}>{req.status ?? '-'}</td>
              <td className="px-3 py-1.5 text-gray-300 truncate max-w-48">{req.host}</td>
              <td className="px-3 py-1.5 text-gray-400 truncate">{req.path}</td>
              <td className="px-3 py-1.5 text-gray-500 text-right">{req.duration ? `${req.duration}ms` : '-'}</td>
              <td className="px-3 py-1.5 text-gray-500 text-right">{formatBytes(req.response_size)}</td>
            </tr>
          ))}
          {requests.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-8 text-center text-gray-600">
                No requests captured yet. Configure your app to use the proxy.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Create RequestDetail component**

Create `src/ui/components/RequestDetail.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { fetchRequest } from '../api.ts';
import type { RequestRecord } from '../api.ts';

interface RequestDetailProps {
  requestId: string;
  onClose: () => void;
}

export function RequestDetail({ requestId, onClose }: RequestDetailProps) {
  const [record, setRecord] = useState<RequestRecord | null>(null);
  const [activeTab, setActiveTab] = useState<'request' | 'response'>('response');

  useEffect(() => {
    fetchRequest(requestId).then(setRecord);
  }, [requestId]);

  if (!record) {
    return <div className="p-4 text-gray-500">Loading...</div>;
  }

  const requestHeaders = parseHeaders(record.request_headers);
  const responseHeaders = parseHeaders(record.response_headers);

  return (
    <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-800">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-mono font-bold text-blue-400">{record.method}</span>
          <span className="font-mono text-green-400">{record.status}</span>
          <span className="text-gray-400 truncate">{record.url}</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg px-2">
          &times;
        </button>
      </div>

      {/* Meta */}
      <div className="flex gap-4 px-3 py-2 text-xs text-gray-500 border-b border-gray-800">
        <span>Duration: {record.duration}ms</span>
        <span>Size: {record.response_size}B</span>
        <span>Protocol: {record.protocol}</span>
        <span>{new Date(record.timestamp).toLocaleTimeString()}</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800">
        <button
          onClick={() => setActiveTab('request')}
          className={`px-4 py-2 text-sm ${activeTab === 'request' ? 'text-white border-b-2 border-blue-500' : 'text-gray-500'}`}
        >
          Request
        </button>
        <button
          onClick={() => setActiveTab('response')}
          className={`px-4 py-2 text-sm ${activeTab === 'response' ? 'text-white border-b-2 border-blue-500' : 'text-gray-500'}`}
        >
          Response
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        {activeTab === 'request' ? (
          <>
            <HeadersView headers={requestHeaders} />
            <BodyView body={record.request_body} contentType={null} />
          </>
        ) : (
          <>
            <HeadersView headers={responseHeaders} />
            <BodyView body={record.response_body} contentType={record.content_type} />
          </>
        )}
      </div>
    </div>
  );
}

function HeadersView({ headers }: { headers: Record<string, string> }) {
  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Headers</h3>
      <div className="font-mono text-xs space-y-0.5">
        {Object.entries(headers).map(([key, value]) => (
          <div key={key}>
            <span className="text-purple-400">{key}</span>
            <span className="text-gray-600">: </span>
            <span className="text-gray-300">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BodyView({ body, contentType }: { body: string | null; contentType: string | null }) {
  if (!body) return null;

  let formatted = body;
  if (contentType?.includes('json') || body.startsWith('{') || body.startsWith('[')) {
    try { formatted = JSON.stringify(JSON.parse(body), null, 2); } catch {}
  }

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Body</h3>
      <pre className="font-mono text-xs text-gray-300 bg-gray-950 rounded p-3 overflow-auto whitespace-pre-wrap">
        {formatted}
      </pre>
    </div>
  );
}

function parseHeaders(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
```

- [ ] **Step 5: Create App component**

Create `src/ui/App.tsx`:

```tsx
import { useState, useCallback } from 'react';
import { Controls } from './components/Controls.tsx';
import { FilterBar } from './components/FilterBar.tsx';
import { TrafficList } from './components/TrafficList.tsx';
import { RequestDetail } from './components/RequestDetail.tsx';
import { useSSE, fetchRequests } from './api.ts';
import type { RequestRecord } from './api.ts';

export function App() {
  const liveRequests = useSSE(500);
  const [filteredRequests, setFilteredRequests] = useState<RequestRecord[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleFilter = useCallback(async (filters: Record<string, string>) => {
    if (Object.keys(filters).length === 0) {
      setFilteredRequests(null);
      return;
    }
    const result = await fetchRequests(filters);
    setFilteredRequests(result.data);
  }, []);

  const handleClear = useCallback(() => {
    setFilteredRequests(null);
    setSelectedId(null);
  }, []);

  const displayRequests = filteredRequests ?? liveRequests;

  return (
    <div className="flex flex-col h-screen">
      <Controls onClear={handleClear} />
      <FilterBar onFilter={handleFilter} />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col flex-1">
          <TrafficList
            requests={displayRequests}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
        {selectedId && (
          <div className="w-[500px] flex-shrink-0">
            <RequestDetail requestId={selectedId} onClose={() => setSelectedId(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify UI builds**

```bash
npx vite build
```

Expected: Build succeeds, output in `dist/ui/`.

- [ ] **Step 7: Commit**

```bash
git add src/ui/
git commit -m "feat: add web UI with traffic list, request detail, filters, and controls"
```

---

## Task 12: Build and Smoke Test

**Files:**
- Modify: `package.json` (add bin shebang handling)

- [ ] **Step 1: Build the server**

```bash
npm run build:server
```

Expected: TypeScript compiles to `dist/` without errors.

- [ ] **Step 2: Build the UI**

```bash
npm run build:ui
```

Expected: Vite builds to `dist/ui/` without errors.

- [ ] **Step 3: Verify CLI runs**

```bash
node dist/cli/index.js --help
```

Expected: Shows help text with all commands listed.

- [ ] **Step 4: Smoke test — start proxy**

```bash
node dist/cli/index.js start &
sleep 2
curl -x http://127.0.0.1:8080 http://httpbin.org/get
node dist/cli/index.js requests --format table
node dist/cli/index.js stop
```

Expected: Proxy starts, request is captured and shown in the query output, proxy stops cleanly.

- [ ] **Step 5: Fix any issues found during smoke test**

Address any build or runtime issues.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build and runtime issues from smoke test"
```

---

## Task 13: Integration Test

**Files:**
- Create: `tests/integration/proxy.integration.test.ts`

- [ ] **Step 1: Write integration test**

Create `tests/integration/proxy.integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { LaurelProxyServer } from '../../src/server/index.js';
import { DEFAULT_CONFIG } from '../../src/shared/types.js';
import type { Config } from '../../src/shared/types.js';

describe('Laurel Proxy Integration', () => {
  let targetServer: http.Server;
  let targetPort: number;
  let proxy: LaurelProxyServer;
  let proxyPort: number;
  let uiPort: number;
  let tmpDir: string;

  beforeAll(async () => {
    // Start a simple target server
    targetServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: req.url }));
    });
    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetServer.address() as net.AddressInfo).port;
        resolve();
      });
    });

    // Start proxy
    tmpDir = path.join(os.tmpdir(), `laurel-proxy-integration-${randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const config: Config = {
      ...DEFAULT_CONFIG,
      proxyPort: 0,
      uiPort: 0,
      dbPath: path.join(tmpDir, 'data.db'),
    };
    proxy = new LaurelProxyServer(config);
    const ports = await proxy.start();
    proxyPort = ports.proxyPort;
    uiPort = ports.uiPort;
  });

  afterAll(async () => {
    await proxy.stop();
    targetServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('proxies HTTP request and stores it', async () => {
    // Make a proxied request
    const url = `http://127.0.0.1:${targetPort}/test-path`;
    await httpGet(url, proxyPort);

    // Wait for write queue
    await new Promise(r => setTimeout(r, 300));

    // Query via API
    const apiRes = await httpGet(`http://127.0.0.1:${uiPort}/api/requests`, 0);
    const body = JSON.parse(apiRes.body);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].path).toBe('/test-path');
    expect(body.data[0].status).toBe(200);
  });

  it('serves status endpoint', async () => {
    const res = await httpGet(`http://127.0.0.1:${uiPort}/api/status`, 0);
    const status = JSON.parse(res.body);
    expect(status.running).toBe(true);
  });
});

function httpGet(url: string, proxyPort: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: http.RequestOptions = proxyPort > 0
      ? { host: '127.0.0.1', port: proxyPort, path: url, method: 'GET' }
      : { host: parsed.hostname, port: parseInt(parsed.port), path: parsed.pathname, method: 'GET' };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
```

- [ ] **Step 2: Run integration test**

```bash
npx vitest run tests/integration/proxy.integration.test.ts
```

Expected: All tests PASS.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: All unit + integration tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/ vitest.config.ts
git commit -m "test: add integration tests for proxy and API"
```
