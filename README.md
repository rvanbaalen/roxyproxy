# RoxyProxy

HTTP/HTTPS intercepting proxy with a CLI and web UI. Captures traffic, stores it in SQLite, and makes it queryable — by humans and LLMs alike.

## Quick Start

```bash
npm install
npm run build

# Start the proxy
npx roxyproxy start

# In another terminal, route traffic through it
curl -x http://127.0.0.1:8080 http://httpbin.org/get

# Query captured traffic
npx roxyproxy requests --format table
npx roxyproxy requests --host httpbin --format json

# Open the web UI
open http://127.0.0.1:8081

# Stop
npx roxyproxy stop
```

## HTTPS Interception

RoxyProxy generates a local CA certificate on first run. To intercept HTTPS traffic, trust the CA in your OS:

```bash
npx roxyproxy trust-ca
```

This prints the cert path and platform-specific instructions. Once trusted:

```bash
curl -x http://127.0.0.1:8080 https://api.example.com/endpoint
```

## CLI Reference

```
roxyproxy start [--port 8080] [--ui-port 8081] [--db-path <path>]
roxyproxy stop [--ui-port 8081]
roxyproxy status [--ui-port 8081]
roxyproxy trust-ca
roxyproxy requests [--host <pattern>] [--status <code>] [--method <method>]
                   [--search <url>] [--since <time>] [--until <time>]
                   [--limit <n>] [--format json|table]
roxyproxy request <id> [--format json|table]
roxyproxy clear [--ui-port 8081]
```

### Querying

The default output format is JSON, designed for piping to LLMs or `jq`:

```bash
# All 500 errors
npx roxyproxy requests --status 500

# POST requests to a specific host
npx roxyproxy requests --host api.example.com --method POST

# Search URLs
npx roxyproxy requests --search "/api/v2"

# Human-readable table
npx roxyproxy requests --format table --limit 20

# Full detail on a single request
npx roxyproxy request <uuid>
```

## Web UI

Available at `http://127.0.0.1:8081` when the proxy is running.

- Live-updating traffic list via Server-Sent Events
- Click any request to inspect headers and bodies
- Filter by host, status, method, or URL
- Start/stop proxy and clear traffic from the UI

## Configuration

Config is loaded from (highest priority first):
1. CLI flags
2. `~/.roxyproxy/config.json`
3. Built-in defaults

```json
{
  "proxyPort": 8080,
  "uiPort": 8081,
  "dbPath": "~/.roxyproxy/data.db",
  "maxAge": "7d",
  "maxDbSize": "500MB",
  "maxBodySize": "1MB",
  "certCacheSize": 500
}
```

## Development

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run build:server  # Build server only
npm run build:ui      # Build UI only
npm run dev:ui        # Vite dev server (proxies API to :8081)
```
