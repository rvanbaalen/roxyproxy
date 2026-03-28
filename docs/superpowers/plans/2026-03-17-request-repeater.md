# Request Repeater Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Repeater feature — view captured requests, edit them (URL, method, headers, body), and resend. Ephemeral responses. Multi-tab UI, REST API, and CLI.

**Architecture:** New `replay()` function makes HTTP/HTTPS requests directly (reuses proxy's header-stripping approach, skips DB storage). API endpoint wraps it. CLI loads from DB and calls it. React UI adds a Repeater view with tabbed editor/response split pane.

**Tech Stack:** Node.js http/https modules, Express route, Commander CLI, React 19 + Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-17-request-repeater-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/shared/types.ts` | Add `ReplayRequest`, `ReplayResponse` interfaces |
| `src/server/replay.ts` | **New** — `replay()` function + `recordToReplayRequest()` conversion |
| `src/server/api.ts` | Add `POST /api/replay` route |
| `src/cli/commands/replay.ts` | **New** — `laurel-proxy replay <id>` CLI command |
| `src/cli/index.ts` | Register replay command |
| `src/ui/api.ts` | Add `replayRequest()` fetch function |
| `src/ui/components/RequestDetail.tsx` | Add "Repeater" button |
| `src/ui/components/Repeater.tsx` | **New** — full repeater UI (tabs, editor, response viewer) |
| `src/ui/App.tsx` | Add Traffic/Repeater view switching, repeater tab state |
| `tests/integration/replay.integration.test.ts` | **New** — integration tests for replay API |

---

### Task 1: Add shared types

**Files:**
- Modify: `src/shared/types.ts:66` (append after `RequestFilter`)

- [ ] **Step 1: Add ReplayRequest and ReplayResponse to shared types**

In `src/shared/types.ts`, append after the `RequestFilter` interface (line 66):

```typescript
export interface ReplayRequest {
  url: string;
  method: string;
  headers: Record<string, string | string[]>;
  body?: string;
}

export interface ReplayResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
  duration: number;
  size: number;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.server.json`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add ReplayRequest and ReplayResponse types"
```

---

### Task 2: Implement replay module

**Files:**
- Create: `src/server/replay.ts`
- Test: `tests/integration/replay.integration.test.ts`

- [ ] **Step 1: Write integration test for replay**

Create `tests/integration/replay.integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { replay, recordToReplayRequest } from '../../src/server/replay.js';
import type { RequestRecord } from '../../src/shared/types.js';

describe('replay', () => {
  let targetServer: http.Server;
  let targetPort: number;

  beforeAll(async () => {
    targetServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          method: req.method,
          path: req.url,
          headers: req.headers,
          body: body || null,
        }));
      });
    });
    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetServer.address() as net.AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(() => { targetServer.close(); });

  it('sends a GET request and returns the response', async () => {
    const result = await replay({
      url: `http://127.0.0.1:${targetPort}/test-path`,
      method: 'GET',
      headers: {},
    });

    expect(result.status).toBe(200);
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.size).toBeGreaterThan(0);

    const body = JSON.parse(Buffer.from(result.body, 'base64').toString());
    expect(body.method).toBe('GET');
    expect(body.path).toBe('/test-path');
  });

  it('sends a POST request with body', async () => {
    const payload = JSON.stringify({ hello: 'world' });
    const result = await replay({
      url: `http://127.0.0.1:${targetPort}/post-test`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(payload).toString('base64'),
    });

    expect(result.status).toBe(200);
    const body = JSON.parse(Buffer.from(result.body, 'base64').toString());
    expect(body.method).toBe('POST');
    expect(body.body).toBe(payload);
  });

  it('strips accept-encoding header', async () => {
    const result = await replay({
      url: `http://127.0.0.1:${targetPort}/headers-test`,
      method: 'GET',
      headers: { 'accept-encoding': 'gzip', 'x-custom': 'test' },
    });

    const body = JSON.parse(Buffer.from(result.body, 'base64').toString());
    expect(body.headers['accept-encoding']).toBeUndefined();
    expect(body.headers['x-custom']).toBe('test');
  });

  it('rejects invalid URL (no scheme)', async () => {
    await expect(replay({
      url: 'example.com/path',
      method: 'GET',
      headers: {},
    })).rejects.toThrow();
  });
});

describe('recordToReplayRequest', () => {
  it('converts a RequestRecord to ReplayRequest', () => {
    const record: RequestRecord = {
      id: 'test-id',
      timestamp: Date.now(),
      method: 'POST',
      url: 'https://example.com/api',
      host: 'example.com',
      path: '/api',
      protocol: 'https',
      request_headers: JSON.stringify({
        'content-type': 'application/json',
        'proxy-connection': 'keep-alive',
        'connection': 'keep-alive',
        'x-custom': 'value',
      }),
      request_body: Buffer.from('{"test":true}'),
      request_size: 13,
      status: 200,
      response_headers: null,
      response_body: null,
      response_size: 0,
      duration: 100,
      content_type: 'application/json',
      truncated: 0,
    };

    const result = recordToReplayRequest(record);

    expect(result.url).toBe('https://example.com/api');
    expect(result.method).toBe('POST');
    expect(result.headers['content-type']).toBe('application/json');
    expect(result.headers['x-custom']).toBe('value');
    // Proxy-specific headers should be stripped
    expect(result.headers['proxy-connection']).toBeUndefined();
    expect(result.headers['connection']).toBeUndefined();
    // Body should be base64-encoded
    expect(result.body).toBe(Buffer.from('{"test":true}').toString('base64'));
  });

  it('handles null body', () => {
    const record: RequestRecord = {
      id: 'test-id',
      timestamp: Date.now(),
      method: 'GET',
      url: 'http://example.com/',
      host: 'example.com',
      path: '/',
      protocol: 'http',
      request_headers: '{}',
      request_body: null,
      request_size: 0,
      status: 200,
      response_headers: null,
      response_body: null,
      response_size: 0,
      duration: 50,
      content_type: null,
      truncated: 0,
    };

    const result = recordToReplayRequest(record);
    expect(result.body).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/replay.integration.test.ts`
Expected: FAIL — module `../../src/server/replay.js` not found

- [ ] **Step 3: Implement the replay module**

Create `src/server/replay.ts`:

```typescript
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { ReplayRequest, ReplayResponse, RequestRecord } from '../shared/types.js';

const REPLAY_TIMEOUT = 30_000;

const SKIP_HEADERS = new Set([
  'proxy-connection', 'proxy-authorization', 'connection',
  'keep-alive', 'transfer-encoding', 'upgrade',
]);

export function recordToReplayRequest(record: RequestRecord): ReplayRequest {
  const rawHeaders: Record<string, string | string[]> = JSON.parse(record.request_headers || '{}');
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (!SKIP_HEADERS.has(key.toLowerCase())) {
      headers[key] = value;
    }
  }
  return {
    url: record.url,
    method: record.method,
    headers,
    body: record.request_body ? Buffer.from(record.request_body).toString('base64') : undefined,
  };
}

export function replay(request: ReplayRequest): Promise<ReplayResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(request.url);
    } catch {
      reject(new Error(`Invalid URL: ${request.url}`));
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new Error(`Unsupported protocol: ${parsed.protocol}`));
      return;
    }

    const headers = { ...request.headers };
    delete headers['accept-encoding'];
    delete headers['proxy-connection'];
    headers['host'] = parsed.host;

    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: request.method,
      headers,
      timeout: REPLAY_TIMEOUT,
      ...(isHttps ? { rejectUnauthorized: false } : {}),
    };

    const startTime = Date.now();
    const transport = isHttps ? https : http;

    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          status: res.statusCode || 0,
          headers: res.headers as Record<string, string | string[]>,
          body: body.toString('base64'),
          duration: Date.now() - startTime,
          size: body.length,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.on('error', (err) => {
      reject(new Error(`Connection failed: ${err.message}`));
    });

    if (request.body) {
      req.write(Buffer.from(request.body, 'base64'));
    }
    req.end();
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/replay.integration.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/replay.ts tests/integration/replay.integration.test.ts
git commit -m "feat: add replay module for resending HTTP requests"
```

---

### Task 3: Add POST /api/replay endpoint

**Files:**
- Modify: `src/server/api.ts:7` (add import), `src/server/api.ts:117` (add route before shutdown)

- [ ] **Step 1: Add replay integration test for the API endpoint**

Append to `tests/integration/replay.integration.test.ts`:

```typescript
import { LaurelProxyServer } from '../../src/server/index.js';
import { DEFAULT_CONFIG } from '../../src/shared/types.js';
import type { Config } from '../../src/shared/types.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

describe('POST /api/replay', () => {
  let targetServer: http.Server;
  let targetPort: number;
  let proxy: LaurelProxyServer;
  let uiPort: number;
  let tmpDir: string;

  beforeAll(async () => {
    targetServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, path: req.url, body: body || null }));
      });
    });
    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetServer.address() as net.AddressInfo).port;
        resolve();
      });
    });

    tmpDir = path.join(os.tmpdir(), `laurel-proxy-replay-${randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const config: Config = { ...DEFAULT_CONFIG, proxyPort: 0, uiPort: 0, dbPath: path.join(tmpDir, 'data.db') };
    proxy = new LaurelProxyServer(config);
    const ports = await proxy.start();
    uiPort = ports.uiPort;
  });

  afterAll(async () => {
    await proxy.stop();
    targetServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('replays a GET request via API', async () => {
    const reqBody = JSON.stringify({
      url: `http://127.0.0.1:${targetPort}/replay-test`,
      method: 'GET',
      headers: {},
    });

    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: uiPort,
        path: '/api/replay',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode!, body }));
      });
      req.on('error', reject);
      req.write(reqBody);
      req.end();
    });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.status).toBe(200);
    expect(parsed.duration).toBeGreaterThanOrEqual(0);
    expect(parsed.size).toBeGreaterThan(0);
  });

  it('returns 400 for missing URL', async () => {
    const reqBody = JSON.stringify({ method: 'GET', headers: {} });

    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: uiPort,
        path: '/api/replay',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode!, body }));
      });
      req.on('error', reject);
      req.write(reqBody);
      req.end();
    });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/replay.integration.test.ts`
Expected: FAIL — the API endpoint tests fail (404 on POST /api/replay)

- [ ] **Step 3: Add the replay route to api.ts**

In `src/server/api.ts`, add the import at line 7 (after the `RequestFilter` import):

```typescript
import type { ReplayRequest } from '../shared/types.js';
import { replay } from './replay.js';
```

Then add the route before the shutdown route (before the `router.post('/shutdown', ...)` block at line 119):

```typescript
  router.post('/replay', async (req: Request, res: Response) => {
    const { url, method, headers, body } = req.body as ReplayRequest;
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      res.status(400).json({ error: 'Invalid or missing URL (must start with http:// or https://)' });
      return;
    }
    if (!method) {
      res.status(400).json({ error: 'Missing HTTP method' });
      return;
    }
    try {
      const result = await replay({ url, method, headers: headers || {}, body });
      res.json(result);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('timed out')) {
        res.status(504).json({ error: message });
      } else {
        res.status(502).json({ error: message });
      }
    }
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/replay.integration.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/api.ts tests/integration/replay.integration.test.ts
git commit -m "feat: add POST /api/replay endpoint"
```

---

### Task 4: Add CLI replay command

**Files:**
- Create: `src/cli/commands/replay.ts`
- Modify: `src/cli/index.ts:11-12` (add import + register)

- [ ] **Step 1: Create the CLI replay command**

Create `src/cli/commands/replay.ts`:

```typescript
import type { Command } from 'commander';
import { Database } from '../../storage/db.js';
import { loadConfig } from '../../server/config.js';
import { replay, recordToReplayRequest } from '../../server/replay.js';
import type { ReplayResponse } from '../../shared/types.js';
import pc from 'picocolors';

function formatReplayResponse(response: ReplayResponse, format: string): string {
  if (format === 'json') {
    return JSON.stringify({
      ...response,
      body: Buffer.from(response.body, 'base64').toString('utf-8'),
    }, null, 2);
  }

  const lines: string[] = [
    '',
    `  ${pc.dim('Status')}    ${response.status < 400 ? pc.green(String(response.status)) : pc.red(String(response.status))}`,
    `  ${pc.dim('Duration')}  ${response.duration}ms`,
    `  ${pc.dim('Size')}      ${response.size}B`,
    '',
    `  ${pc.bold('Response Headers')}`,
  ];

  for (const [key, value] of Object.entries(response.headers)) {
    const vals = Array.isArray(value) ? value : [value];
    for (const v of vals) {
      lines.push(`  ${pc.magenta(key)}${pc.dim(':')} ${v}`);
    }
  }

  const bodyStr = Buffer.from(response.body, 'base64').toString('utf-8');
  if (bodyStr) {
    lines.push('', `  ${pc.bold('Response Body')}`);
    let formatted = bodyStr;
    try { formatted = JSON.stringify(JSON.parse(bodyStr), null, 2); } catch {}
    lines.push(...formatted.split('\n').map(line => `  ${line}`));
  }

  lines.push('');
  return lines.join('\n');
}

export function registerReplay(program: Command): void {
  program
    .command('replay <id>')
    .description('Replay a captured request')
    .option('--method <method>', 'Override HTTP method')
    .option('--url <url>', 'Override URL')
    .option('--header <header...>', 'Override/add header (format: "Key: Value")')
    .option('--body <body>', 'Override body (raw string)')
    .option('--format <format>', 'Output format (json|table)', 'json')
    .option('--db-path <path>', 'Database path')
    .action(async (id, opts) => {
      const config = loadConfig(opts.dbPath ? { dbPath: opts.dbPath } : {});
      const db = new Database(config.dbPath);

      const record = db.getById(id);
      if (!record) {
        console.error(`Request ${id} not found.`);
        db.close();
        process.exit(1);
      }

      const request = recordToReplayRequest(record);

      // Apply overrides
      if (opts.method) request.method = opts.method;
      if (opts.url) request.url = opts.url;
      if (opts.header) {
        for (const h of opts.header as string[]) {
          const colonIdx = h.indexOf(':');
          if (colonIdx > 0) {
            const key = h.slice(0, colonIdx).trim();
            const value = h.slice(colonIdx + 1).trim();
            request.headers[key] = value;
          }
        }
      }
      if (opts.body) {
        request.body = Buffer.from(opts.body).toString('base64');
      }

      try {
        const response = await replay(request);
        console.log(formatReplayResponse(response, opts.format));
      } catch (err) {
        console.error(`Replay failed: ${(err as Error).message}`);
        process.exit(1);
      } finally {
        db.close();
      }
    });
}
```

- [ ] **Step 2: Register the command in index.ts**

In `src/cli/index.ts`, add the import after line 12 (the `registerProxyOff` import):

```typescript
import { registerReplay } from './commands/replay.js';
```

Then add the registration after line 38 (after `registerProxyOff(program)`):

```typescript
registerReplay(program);
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.server.json`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/replay.ts src/cli/index.ts
git commit -m "feat: add laurel-proxy replay CLI command"
```

---

### Task 5: Add frontend API function

**Files:**
- Modify: `src/ui/api.ts:66` (append after `stopProxy`)

- [ ] **Step 1: Add ReplayRequest/ReplayResponse types and replayRequest function**

In `src/ui/api.ts`, append after the `stopProxy` function (after line 66):

```typescript
export interface ReplayRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ReplayResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
  duration: number;
  size: number;
}

export async function replayRequest(request: ReplayRequest): Promise<ReplayResponse> {
  const res = await fetch(`${API_BASE}/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Replay failed');
  }
  return res.json();
}
```

Note: The frontend `ReplayRequest.headers` uses `Record<string, string>` (single-value) since the textarea editor parses to single values. The backend accepts `string | string[]` and handles both.

- [ ] **Step 2: Verify UI builds**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/ui/api.ts
git commit -m "feat: add replayRequest API client function"
```

---

### Task 6: Add "Repeater" button to RequestDetail

**Files:**
- Modify: `src/ui/components/RequestDetail.tsx:31-34` (props), `src/ui/components/RequestDetail.tsx:65-68` (button)

- [ ] **Step 1: Add onSendToRepeater prop and button**

In `src/ui/components/RequestDetail.tsx`, update the props interface (line 31):

```typescript
interface RequestDetailProps {
  requestId: string;
  onClose: () => void;
  onSendToRepeater?: (data: { url: string; method: string; headers: string; body: string }) => void;
}
```

Update the component signature (line 36):

```typescript
export function RequestDetail({ requestId, onClose, onSendToRepeater }: RequestDetailProps) {
```

Add a `sendToRepeater` callback after the `copyCurl` callback (after line 50):

```typescript
  const sendToRepeater = useCallback(() => {
    if (!record || !onSendToRepeater) return;
    const headers = parseHeaders(record.request_headers);
    const headersText = Object.entries(headers)
      .filter(([key]) => !SKIP_HEADERS.has(key.toLowerCase()))
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    const body = record.request_body ? decodeBody(record.request_body) : '';
    onSendToRepeater({ url: record.url, method: record.method, headers: headersText, body });
  }, [record, onSendToRepeater]);
```

Add the button next to the cURL button (inside the button container div, after the cURL button at line 67):

```tsx
          {onSendToRepeater && (
            <button onClick={sendToRepeater} className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors" title="Send to Repeater">
              Repeater
            </button>
          )}
```

- [ ] **Step 2: Verify UI builds**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/RequestDetail.tsx
git commit -m "feat: add Send to Repeater button in request detail"
```

---

### Task 7: Build the Repeater component

**Files:**
- Create: `src/ui/components/Repeater.tsx`

- [ ] **Step 1: Create the Repeater component**

Create `src/ui/components/Repeater.tsx`:

```tsx
import { useState, useCallback, useEffect } from 'react';
import { replayRequest } from '../api.ts';
import type { ReplayResponse } from '../api.ts';

export interface RepeaterTabData {
  id: string;
  name: string;
  request: { url: string; method: string; headers: string; body: string };
  response: ReplayResponse | null;
  error: string | null;
  loading: boolean;
}

interface RepeaterProps {
  tabs: RepeaterTabData[];
  activeTabId: string | null;
  onTabsChange: (tabs: RepeaterTabData[]) => void;
  onActiveTabChange: (id: string | null) => void;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

let tabCounter = 0;

export function createTab(init?: { url: string; method: string; headers: string; body: string }): RepeaterTabData {
  tabCounter++;
  let name = `New Request ${tabCounter}`;
  if (init) {
    try { name = new URL(init.url).hostname || name; } catch {}
  }
  return {
    id: crypto.randomUUID(),
    name,
    request: init || { url: '', method: 'GET', headers: '', body: '' },
    response: null,
    error: null,
    loading: false,
  };
}

function parseHeadersText(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    headers[key] = value;
  }
  return headers;
}

export function Repeater({ tabs, activeTabId, onTabsChange, onActiveTabChange }: RepeaterProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  const updateTab = useCallback((id: string, updates: Partial<RepeaterTabData>) => {
    onTabsChange(tabs.map((t) => t.id === id ? { ...t, ...updates } : t));
  }, [tabs, onTabsChange]);

  const updateRequest = useCallback((id: string, field: string, value: string) => {
    onTabsChange(tabs.map((t) =>
      t.id === id ? { ...t, request: { ...t.request, [field]: value } } : t
    ));
  }, [tabs, onTabsChange]);

  const closeTab = useCallback((id: string) => {
    const newTabs = tabs.filter((t) => t.id !== id);
    onTabsChange(newTabs);
    if (activeTabId === id) {
      onActiveTabChange(newTabs.length > 0 ? newTabs[0].id : null);
    }
  }, [tabs, activeTabId, onTabsChange, onActiveTabChange]);

  const addTab = useCallback(() => {
    const tab = createTab();
    onTabsChange([...tabs, tab]);
    onActiveTabChange(tab.id);
  }, [tabs, onTabsChange, onActiveTabChange]);

  const sendRequest = useCallback(async () => {
    if (!activeTab || activeTab.loading) return;
    updateTab(activeTab.id, { loading: true, error: null });
    try {
      const headers = parseHeadersText(activeTab.request.headers);
      const body = activeTab.request.body
        ? btoa(activeTab.request.body)
        : undefined;
      const result = await replayRequest({
        url: activeTab.request.url,
        method: activeTab.request.method,
        headers,
        body,
      });
      updateTab(activeTab.id, { response: result, loading: false });
    } catch (err) {
      updateTab(activeTab.id, { error: (err as Error).message, loading: false });
    }
  }, [activeTab, updateTab]);

  // Cmd/Ctrl+Enter to send
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        sendRequest();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sendRequest]);

  if (tabs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <p className="mb-4">No repeater tabs open</p>
        <button onClick={addTab} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm">
          New Request
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center border-b border-gray-800 bg-gray-900 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex items-center gap-1 px-3 py-2 text-sm cursor-pointer border-r border-gray-800 shrink-0 ${
              tab.id === activeTabId ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
            onClick={() => onActiveTabChange(tab.id)}
          >
            <span className="truncate max-w-32">{tab.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              className="text-gray-600 hover:text-gray-300 ml-1"
            >&times;</button>
          </div>
        ))}
        <button onClick={addTab} className="px-3 py-2 text-gray-500 hover:text-gray-300 text-sm shrink-0">+</button>
      </div>

      {/* Split pane */}
      {activeTab && (
        <div className="flex flex-1 overflow-hidden">
          {/* Request editor */}
          <div className="flex flex-col w-1/2 border-r border-gray-800 overflow-auto">
            <div className="flex gap-2 p-3 border-b border-gray-800">
              <select
                value={activeTab.request.method}
                onChange={(e) => updateRequest(activeTab.id, 'method', e.target.value)}
                className="bg-gray-800 text-white px-2 py-1.5 rounded text-sm border border-gray-700"
              >
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input
                type="text"
                value={activeTab.request.url}
                onChange={(e) => updateRequest(activeTab.id, 'url', e.target.value)}
                placeholder="https://example.com/api/endpoint"
                className="flex-1 bg-gray-800 text-white px-3 py-1.5 rounded text-sm border border-gray-700 font-mono"
              />
              <button
                onClick={sendRequest}
                disabled={activeTab.loading || !activeTab.request.url}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded text-sm font-medium shrink-0"
              >
                {activeTab.loading ? 'Sending...' : 'Send'}
              </button>
            </div>
            <div className="flex flex-col flex-1 p-3 gap-3">
              <div className="flex flex-col flex-1 min-h-0">
                <label className="text-xs font-semibold text-gray-500 uppercase mb-1">Headers</label>
                <textarea
                  value={activeTab.request.headers}
                  onChange={(e) => updateRequest(activeTab.id, 'headers', e.target.value)}
                  placeholder={"Content-Type: application/json\nAuthorization: Bearer token"}
                  className="flex-1 bg-gray-950 text-gray-300 font-mono text-xs p-3 rounded border border-gray-800 resize-none"
                />
              </div>
              <div className="flex flex-col flex-1 min-h-0">
                <label className="text-xs font-semibold text-gray-500 uppercase mb-1">Body</label>
                <textarea
                  value={activeTab.request.body}
                  onChange={(e) => updateRequest(activeTab.id, 'body', e.target.value)}
                  placeholder='{"key": "value"}'
                  className="flex-1 bg-gray-950 text-gray-300 font-mono text-xs p-3 rounded border border-gray-800 resize-none"
                />
              </div>
            </div>
          </div>

          {/* Response viewer */}
          <div className="flex flex-col w-1/2 overflow-auto">
            {activeTab.loading && (
              <div className="flex items-center justify-center h-full text-gray-500">
                Sending request...
              </div>
            )}
            {activeTab.error && !activeTab.loading && (
              <div className="flex items-center justify-center h-full text-red-400 p-4 text-center">
                {activeTab.error}
              </div>
            )}
            {activeTab.response && !activeTab.loading && (
              <ResponseView response={activeTab.response} />
            )}
            {!activeTab.response && !activeTab.loading && !activeTab.error && (
              <div className="flex items-center justify-center h-full text-gray-600">
                Send a request to see the response
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ResponseView({ response }: { response: ReplayResponse }) {
  const statusColor = response.status < 300 ? 'text-green-400' :
    response.status < 400 ? 'text-yellow-400' :
    response.status < 500 ? 'text-orange-400' : 'text-red-400';

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-4 px-3 py-2 text-xs text-gray-500 border-b border-gray-800">
        <span className={`font-mono font-bold ${statusColor}`}>{response.status}</span>
        <span>Duration: {response.duration}ms</span>
        <span>Size: {response.size}B</span>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Headers</h3>
          <div className="font-mono text-xs space-y-0.5">
            {Object.entries(response.headers).map(([key, value]) => {
              const vals = Array.isArray(value) ? value : [value];
              return vals.map((v, i) => (
                <div key={`${key}-${i}`}>
                  <span className="text-purple-400">{key}</span>
                  <span className="text-gray-600">: </span>
                  <span className="text-gray-300">{v}</span>
                </div>
              ));
            })}
          </div>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Body</h3>
          <pre className="font-mono text-xs text-gray-300 bg-gray-950 rounded p-3 overflow-auto whitespace-pre-wrap">
            {formatResponseBody(response.body)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function formatResponseBody(base64Body: string): string {
  try {
    const raw = atob(base64Body);
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch {}
    return raw;
  } catch {
    return base64Body;
  }
}
```

- [ ] **Step 2: Verify UI builds**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/Repeater.tsx
git commit -m "feat: add Repeater component with tabbed editor and response viewer"
```

---

### Task 8: Wire up App.tsx with view switching and repeater state

**Files:**
- Modify: `src/ui/App.tsx`

- [ ] **Step 1: Update App.tsx with Traffic/Repeater view tabs**

Replace the contents of `src/ui/App.tsx` with:

```tsx
import { useState, useMemo, useCallback } from 'react';
import { Controls } from './components/Controls.tsx';
import { FilterBar } from './components/FilterBar.tsx';
import { TrafficList } from './components/TrafficList.tsx';
import { RequestDetail } from './components/RequestDetail.tsx';
import { ResizeHandle } from './components/ResizeHandle.tsx';
import { Repeater, createTab } from './components/Repeater.tsx';
import type { RepeaterTabData } from './components/Repeater.tsx';
import { useSSE } from './api.ts';

const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 900;
const DEFAULT_PANEL_WIDTH = 500;

export function App() {
  const { requests: liveRequests, statusEvent, clearLocal } = useSSE(500);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [activeView, setActiveView] = useState<'traffic' | 'repeater'>('traffic');

  // Repeater state
  const [repeaterTabs, setRepeaterTabs] = useState<RepeaterTabData[]>([]);
  const [activeRepeaterTab, setActiveRepeaterTab] = useState<string | null>(null);

  const [filterHost, setFilterHost] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterMethod, setFilterMethod] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  const filteredRequests = useMemo(() => {
    const host = filterHost.toLowerCase();
    const status = filterStatus;
    const method = filterMethod;
    const search = filterSearch.toLowerCase();

    if (!host && !status && !method && !search) return liveRequests;

    return liveRequests.filter((r) => {
      if (host && !r.host.toLowerCase().includes(host)) return false;
      if (status && String(r.status) !== status) return false;
      if (method && r.method !== method) return false;
      if (search && !r.url.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [liveRequests, filterHost, filterStatus, filterMethod, filterSearch]);

  const handleClear = useCallback(() => { setSelectedId(null); clearLocal(); }, [clearLocal]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(prev => prev === id ? null : id);
  }, []);

  const handleResize = useCallback((delta: number) => {
    setPanelWidth(prev => Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, prev + delta)));
  }, []);

  const clearFilters = useCallback(() => {
    setFilterHost('');
    setFilterStatus('');
    setFilterMethod('');
    setFilterSearch('');
  }, []);

  const handleSendToRepeater = useCallback((data: { url: string; method: string; headers: string; body: string }) => {
    const tab = createTab(data);
    setRepeaterTabs((prev) => [...prev, tab]);
    setActiveRepeaterTab(tab.id);
    setActiveView('repeater');
  }, []);

  return (
    <div className="flex flex-col h-screen">
      <Controls onClear={handleClear} statusEvent={statusEvent} />
      {/* View tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900">
        <button
          onClick={() => setActiveView('traffic')}
          className={`px-4 py-2 text-sm font-medium ${activeView === 'traffic' ? 'text-white border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-300'}`}
        >Traffic</button>
        <button
          onClick={() => setActiveView('repeater')}
          className={`px-4 py-2 text-sm font-medium ${activeView === 'repeater' ? 'text-white border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-300'}`}
        >
          Repeater{repeaterTabs.length > 0 && ` (${repeaterTabs.length})`}
        </button>
      </div>

      {activeView === 'traffic' && (
        <>
          <FilterBar
            host={filterHost} status={filterStatus} method={filterMethod} search={filterSearch}
            onHostChange={setFilterHost} onStatusChange={setFilterStatus}
            onMethodChange={setFilterMethod} onSearchChange={setFilterSearch}
            onClearFilters={clearFilters}
            matchCount={filteredRequests.length} totalCount={liveRequests.length}
          />
          <div className="flex flex-1 overflow-hidden">
            <div className="flex flex-col flex-1 min-w-0">
              <TrafficList requests={filteredRequests} selectedId={selectedId} onSelect={handleSelect} />
            </div>
            {selectedId && (
              <>
                <ResizeHandle onResize={handleResize} />
                <div className="flex-shrink-0 overflow-hidden" style={{ width: panelWidth }}>
                  <RequestDetail requestId={selectedId} onClose={() => setSelectedId(null)} onSendToRepeater={handleSendToRepeater} />
                </div>
              </>
            )}
          </div>
        </>
      )}

      {activeView === 'repeater' && (
        <div className="flex-1 overflow-hidden">
          <Repeater
            tabs={repeaterTabs}
            activeTabId={activeRepeaterTab}
            onTabsChange={setRepeaterTabs}
            onActiveTabChange={setActiveRepeaterTab}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify UI builds**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat: wire up Traffic/Repeater view switching in App"
```

---

### Task 9: Run all tests and verify end-to-end

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Build everything**

Run: `npm run build`
Expected: Both server and UI build succeed

- [ ] **Step 3: Smoke test the full flow**

1. Start Laurel Proxy: `node dist/cli/index.js start`
2. Open `http://127.0.0.1:8081` — verify Traffic and Repeater tabs visible
3. Make a proxied request: `curl -x http://127.0.0.1:8080 http://httpbin.org/get`
4. Click on the captured request, click "Repeater" button
5. Verify Repeater tab opens with pre-filled fields
6. Click "Send" — verify response appears
7. Edit the URL and send again — verify new response
8. Test the CLI: `node dist/cli/index.js replay <request-uuid>`
9. Test the API: `curl -X POST http://127.0.0.1:8081/api/replay -H 'Content-Type: application/json' -d '{"url":"http://httpbin.org/get","method":"GET","headers":{}}'`

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete request repeater feature"
```
