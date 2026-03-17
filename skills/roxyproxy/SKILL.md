---
name: roxyproxy
description: Use when working with RoxyProxy, intercepting HTTP/HTTPS traffic, debugging API calls, inspecting network requests, or when the user mentions roxyproxy, proxy traffic, captured requests, or network debugging. Also use when the user asks to start/stop a proxy, view traffic, or configure HTTPS interception.
version: 1.0.0
---

# RoxyProxy

RoxyProxy is an HTTP/HTTPS intercepting proxy with a CLI and web UI. It captures traffic, stores it in SQLite, and makes it queryable.

Install: `npm install -g @rvanbaalen/roxyproxy`
Run without installing: `npx @rvanbaalen/roxyproxy`

## Quick Reference

### Starting the Proxy

```bash
# Interactive mode (recommended for first-time use)
roxyproxy

# Start in foreground
roxyproxy start

# Custom ports
roxyproxy start --port 9000 --ui-port 9001
```

The web UI is available at `http://127.0.0.1:8081` when running.

### Stopping the Proxy

```bash
roxyproxy stop
```

### HTTPS Interception Setup

HTTPS interception requires trusting the RoxyProxy CA certificate:

```bash
roxyproxy start        # generates CA on first run
roxyproxy trust-ca     # installs cert (prompts for sudo)
```

To remove the certificate later:

```bash
roxyproxy uninstall-ca
```

### Routing Traffic Through the Proxy

```bash
# Single command
curl -x http://127.0.0.1:8080 https://api.example.com/data

# Terminal session
export http_proxy=http://127.0.0.1:8080
export https_proxy=http://127.0.0.1:8080

# macOS system-wide (routes all app traffic)
roxyproxy proxy-on
roxyproxy proxy-off    # to disable
```

## Querying Traffic

### CLI Queries

The default output is JSON (pipe to `jq` or feed to LLMs):

```bash
# All captured requests (last 100)
roxyproxy requests

# Filter by host
roxyproxy requests --host api.example.com

# Filter by status code
roxyproxy requests --status 500

# Filter by HTTP method
roxyproxy requests --method POST

# Search URLs
roxyproxy requests --search "/api/v2"

# Combine filters
roxyproxy requests --host stripe.com --method POST --status 200

# Human-readable table
roxyproxy requests --format table --limit 20

# Time-bounded
roxyproxy requests --since "2024-01-15T00:00:00Z"

# Full detail for one request (headers + body)
roxyproxy request <uuid>

# Pipe to jq
roxyproxy requests --host example.com | jq '.data[].url'
```

**All filter options:**

| Flag | Description |
|---|---|
| `--host <pattern>` | Substring match on hostname |
| `--status <code>` | Exact HTTP status code |
| `--method <method>` | HTTP method (GET, POST, etc.) |
| `--search <pattern>` | Substring match on full URL |
| `--since <time>` | After timestamp (Unix ms or ISO date) |
| `--until <time>` | Before timestamp (Unix ms or ISO date) |
| `--limit <n>` | Max results (default: 100) |
| `--format <fmt>` | `json` (default) or `table` |

### REST API

The API is at `http://127.0.0.1:8081/api` when running:

```bash
# Query requests (same filters as CLI via query params)
curl "http://127.0.0.1:8081/api/requests?host=example.com&limit=50"

# Single request detail
curl http://127.0.0.1:8081/api/requests/<uuid>

# Proxy status
curl http://127.0.0.1:8081/api/status

# Start/stop proxy
curl -X POST http://127.0.0.1:8081/api/proxy/start
curl -X POST http://127.0.0.1:8081/api/proxy/stop

# Clear all traffic
curl -X DELETE http://127.0.0.1:8081/api/requests

# SSE stream (real-time traffic)
curl -N http://127.0.0.1:8081/api/events
```

### Clear Traffic

```bash
roxyproxy clear
```

## Configuration

Config file at `~/.roxyproxy/config.json`:

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

Priority: CLI flags > config file > defaults.

## Data Locations

| Path | Purpose |
|---|---|
| `~/.roxyproxy/data.db` | SQLite database |
| `~/.roxyproxy/config.json` | Configuration (optional) |
| `~/.roxyproxy/ca/ca.crt` | Root CA certificate |
| `~/.roxyproxy/ca/ca.key` | Root CA private key |
| `~/.roxyproxy/pid` | Process ID file |

## Common Workflows

### Debug a failing API call

```bash
roxyproxy start
# reproduce the issue with traffic going through the proxy
roxyproxy requests --host api.failing-service.com --status 500 --format table
roxyproxy request <uuid-of-failing-request>
```

### Inspect what an app sends to a third-party API

```bash
roxyproxy start
roxyproxy trust-ca          # for HTTPS
roxyproxy proxy-on          # system-wide on macOS
# use the app
roxyproxy requests --host third-party-api.com
roxyproxy proxy-off
```

### Monitor traffic in real-time

Open `http://127.0.0.1:8081` in a browser, or use the SSE stream:

```bash
curl -N http://127.0.0.1:8081/api/events
```

## Port Conflicts

RoxyProxy auto-detects port conflicts. If the default port is in use:
- If another roxyproxy instance holds the port, it's automatically shut down
- Otherwise, the next available port is used (8080 -> 8081 -> 8082...)

The actual ports are always printed on startup.
