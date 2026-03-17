# RoxyProxy — Design Spec

An HTTP/HTTPS intercepting proxy server with CLI querying and a web UI. Similar to Charles Proxy, built in Node.js/TypeScript.

## Architecture

Single Node.js/TypeScript process containing four modules:

```
┌─────────────────────────────────────────────┐
│                 RoxyProxy                   │
│                                             │
│  ┌───────────┐  ┌───────────┐  ┌─────────┐ │
│  │   Proxy   │  │  REST API │  │  Web UI  │ │
│  │  Engine   │──│  Server   │──│  (SPA)   │ │
│  └─────┬─────┘  └─────┬─────┘  └─────────┘ │
│        │              │                     │
│        ▼              ▼                     │
│  ┌─────────────────────────┐                │
│  │   SQLite Storage Layer  │                │
│  └─────────────────────────┘                │
└─────────────────────────────────────────────┘

CLI ──→ SQLite (direct read for queries)
CLI ──→ REST API (for live data / control commands)
```

**Ports:**
- Proxy: `8080` (configurable)
- Web UI + REST API: `8081` (configurable)

The CLI is a separate entry point in the same package. For queries it reads SQLite directly (fast, works even if the proxy is stopped). For control commands (start/stop/clear) it hits the REST API.

## Proxy Engine

### HTTP Proxying

Standard forward proxy using Node's built-in `http` module. Client sends `GET http://example.com/path`, proxy forwards the request and captures both request and response.

### HTTPS/SSL Interception (MITM)

1. Client sends `CONNECT example.com:443`
2. Proxy responds `200 Connection Established`
3. Proxy creates a TLS socket to the client using a dynamically generated cert for that domain
4. Proxy opens a separate TLS connection to the real server
5. Decrypted traffic is piped through, with request/response captured in the middle

### CA Certificate Management

- On first run, generates a root CA key + cert, stored in `~/.roxyproxy/ca/`
- Per-domain certs generated on-the-fly and cached in memory (LRU cache, ~500 domains)
- CLI command `roxyproxy trust-ca` prints the CA cert path and OS-specific trust instructions

### Error Handling

- If CA generation fails on first run (permissions, disk full), the process exits with a clear error message
- If per-domain cert generation fails at runtime, the CONNECT tunnel is dropped and the error is logged
- Failed upstream connections return `502 Bad Gateway` to the client

### Captured Data Per Request

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `timestamp` | Unix ms | When the request was received |
| `method` | string | HTTP method |
| `url` | string | Full URL |
| `host` | string | Target host |
| `path` | string | URL path |
| `protocol` | string | `http` or `https` |
| `request_headers` | JSON | Request headers |
| `request_body` | Buffer | Request body |
| `status` | integer | HTTP response status code |
| `response_headers` | JSON | Response headers |
| `response_body` | Buffer | Response body |
| `duration` | integer | ms from request start to response complete |
| `request_size` | integer | Request body bytes |
| `response_size` | integer | Response body bytes |
| `content_type` | string | Response content-type (extracted from response headers on insert) |
| `truncated` | boolean | Whether body was truncated |

### Body Handling

- Bodies stored as buffers (supports binary)
- Large bodies (>1MB) truncated with a flag indicating truncation
- Content-encoding (gzip, brotli, etc.) decoded before storage so bodies are always readable

## SQLite Storage Layer

### Schema

```sql
CREATE TABLE requests (
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

CREATE INDEX idx_timestamp ON requests(timestamp);
CREATE INDEX idx_host ON requests(host);
CREATE INDEX idx_status ON requests(status);
CREATE INDEX idx_path ON requests(path);
CREATE INDEX idx_content_type ON requests(content_type);
```

### Auto-Cleanup

- Configurable max age (default: 7 days) and max DB size (default: 500MB)
- Cleanup runs on a timer every 5 minutes — deletes oldest rows first when either limit is exceeded
- `PRAGMA auto_vacuum = INCREMENTAL` so the file shrinks after deletes

### Write Strategy

- Writes are batched in a queue and flushed every 100ms using `better-sqlite3` transactions to avoid blocking the event loop during high traffic
- Reads are synchronous (fast for queries)

### Concurrency

- WAL mode for concurrent reads (CLI) while the proxy writes
- Single writer (the proxy process), multiple readers (CLI instances)

### Location

`~/.roxyproxy/data.db` by default, configurable via `--db-path`.

## REST API

Served on port `8081` alongside the web UI.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/requests` | List/filter requests |
| `GET` | `/api/requests/:id` | Full request detail including bodies |
| `DELETE` | `/api/requests` | Clear all captured traffic |
| `GET` | `/api/status` | Proxy status (running, port, request count, DB size) |
| `POST` | `/api/proxy/start` | Start the proxy |
| `POST` | `/api/proxy/stop` | Stop the proxy |
| `GET` | `/api/config` | Get current config |
| `PUT` | `/api/config` | Update config (ports, cleanup settings) |

### Query Parameters for `GET /api/requests`

| Param | Type | Description |
|-------|------|-------------|
| `host` | string | Filter by hostname (substring match) |
| `status` | integer | Filter by response status code |
| `method` | string | Filter by HTTP method |
| `content_type` | string | Filter by response content-type |
| `search` | string | Substring match against URL |
| `since` | ISO 8601 / Unix ms | Requests after this time |
| `until` | ISO 8601 / Unix ms | Requests before this time |
| `limit` | integer | Max results (default: 100) |
| `offset` | integer | Pagination offset |

### Response Envelope

All list endpoints return a paginated envelope:

```json
{
  "data": [...],
  "total": 1234,
  "limit": 100,
  "offset": 0
}
```

### Live Updates

Server-Sent Events (SSE) on `GET /api/events` — pushes new requests to the web UI in real time. Simpler than WebSockets, no extra dependencies.

- Each event includes an `id` field (request UUID) so clients can resume via `Last-Event-ID` after reconnection
- Under high throughput, events are batched (max one push per 100ms) to avoid flooding the browser
- The web UI maintains a rolling window of the most recent requests in memory

## CLI

```
roxyproxy start [--port 8080] [--ui-port 8081] [--db-path ~/.roxyproxy/data.db]
roxyproxy stop
roxyproxy status
roxyproxy trust-ca
roxyproxy requests [--host <pattern>] [--status <code>] [--method <method>]
                   [--search <url-pattern>] [--since <time>] [--until <time>]
                   [--limit <n>] [--format json|table]
roxyproxy request <id> [--format json|table]
roxyproxy clear
```

### Behavior

- `start` runs in the foreground (Ctrl+C to stop). Writes a PID file to `~/.roxyproxy/pid` on startup, removes it on clean shutdown.
- `stop` sends a shutdown request via REST API. If the API is unreachable, checks the PID file and sends SIGTERM. Prints an error and exits with code 1 if neither works.
- `requests` and `request` read directly from SQLite (works even when proxy is stopped)
- `status`, `clear` communicate via the REST API
- Default output format: `json` (LLM-friendly). Use `--format table` for human readability.
- `trust-ca` prints the CA cert path and OS-specific instructions for trusting it

## Web UI

React 19 SPA built with Vite and styled with Tailwind CSS v4. Served as static files from the same Express server on port `8081`.

### Views

**Traffic List:**
- Live-updating table of captured requests (via SSE)
- Columns: method, status, host, path, duration, size
- Click a row to expand/inspect

**Request Detail:**
- Split pane: request headers/body on one side, response headers/body on the other
- Pretty-prints JSON bodies, shows HTML as text, hex view for binary

**Filter Bar:**
- Filter by host, status code, method (mirrors CLI filter capabilities)

**Controls:**
- Start/stop proxy toggle
- Clear traffic button
- Displays proxy status and port info

## Configuration

All configuration has sensible defaults. Config can be provided via:
- CLI flags (highest priority)
- Config file at `~/.roxyproxy/config.json`
- Defaults (lowest priority)

### Config Options

| Option | Default | Description |
|--------|---------|-------------|
| `proxyPort` | `8080` | Port the proxy listens on |
| `uiPort` | `8081` | Port for web UI and REST API |
| `dbPath` | `~/.roxyproxy/data.db` | SQLite database path |
| `maxAge` | `7d` | Auto-cleanup: max request age |
| `maxDbSize` | `500MB` | Auto-cleanup: max database size |
| `maxBodySize` | `1MB` | Truncate bodies larger than this |
| `certCacheSize` | `500` | Max cached per-domain certs |

## Project Structure

```
roxyproxy/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── cli/              # CLI entry point and commands
│   │   ├── index.ts
│   │   └── commands/
│   ├── server/           # Proxy + API server
│   │   ├── index.ts
│   │   ├── proxy.ts      # Proxy engine
│   │   ├── ssl.ts        # CA and cert generation
│   │   ├── api.ts        # REST API routes
│   │   ├── events.ts     # SSE event emitter
│   │   └── config.ts     # Config loading
│   ├── storage/          # SQLite layer
│   │   ├── db.ts
│   │   └── cleanup.ts
│   └── ui/               # React SPA
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       └── components/
├── docs/
└── tests/
```

## Dependencies

### Runtime
- `better-sqlite3` — SQLite driver (writes batched via a write queue to avoid blocking the event loop)
- `node-forge` — CA and certificate generation
- `commander` — CLI argument parsing
- `express` — REST API server
- `uuid` — Request IDs

### Dev / UI
- `typescript`
- `vite`
- `react` + `react-dom` (v19)
- `tailwindcss` (v4)
- `@types/node`, `@types/express`, `@types/better-sqlite3`

## Non-Goals for v1

- Request/response modification (breakpoints, rewriting)
- WebSocket proxying
- Throttling/bandwidth simulation
- Remote access / sharing
- Authentication for the web UI
