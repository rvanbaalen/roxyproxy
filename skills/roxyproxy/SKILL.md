---
name: roxyproxy
description: Use when working with RoxyProxy, intercepting HTTP/HTTPS traffic, debugging API calls, inspecting network requests, or when the user mentions roxyproxy, proxy traffic, captured requests, or network debugging. Also use when the user asks to start/stop a proxy, view traffic, configure HTTPS interception, or debug why an API call is failing. Trigger even when the user just says "capture traffic", "inspect requests", "what is my app sending", or "debug this API".
version: 1.1.0
---

# RoxyProxy

RoxyProxy is an HTTP/HTTPS intercepting proxy with a CLI and web UI. It captures traffic, stores it in SQLite, and makes it queryable. Developed and tested on **macOS**.

Install: `npm install -g @rvanbaalen/roxyproxy`
Run without installing: `npx @rvanbaalen/roxyproxy`

## Quick Start — One Command

The fastest way to capture and inspect traffic. This single command starts the proxy, enables the macOS system proxy, and opens a live interactive TUI:

```bash
roxyproxy requests --tail
roxyproxy requests --host api.example.com --tail
roxyproxy requests --status 500 --tail
roxyproxy requests --host stripe.com --method POST --tail
```

`--tail` automatically:
1. Starts the proxy if it isn't running
2. Enables the macOS system proxy (routes all traffic through RoxyProxy)
3. Opens an interactive terminal TUI
4. On quit (Ctrl+C), disables the system proxy and stops the proxy

For raw JSON streaming instead of the TUI: `roxyproxy requests --format json --tail`

## CLI Commands

### `roxyproxy` (interactive mode)

Running with no arguments launches a terminal menu with access to all features: start/stop proxy, view requests, clear traffic, open web UI, trust CA, enable system proxy, quit.

### `roxyproxy start [options]`

Start the proxy server in the foreground.

| Option | Default | Description |
|---|---|---|
| `--port <number>` | `8080` | Proxy listening port |
| `--ui-port <number>` | `8081` | Web UI and API port |
| `--db-path <path>` | `~/.roxyproxy/data.db` | SQLite database location |

### `roxyproxy stop [--ui-port <number>]`

Stop the running proxy. Sends a graceful shutdown request via the API, falls back to SIGTERM via PID file.

### `roxyproxy status [--ui-port <number>]`

Show proxy status: running state, proxy port, request count, database size.

### `roxyproxy requests [options]`

Query captured requests. Default output is a human-readable table.

| Option | Default | Description |
|---|---|---|
| `--host <pattern>` | | Substring match on hostname |
| `--status <code>` | | Exact HTTP status code |
| `--method <method>` | | HTTP method (GET, POST, etc.) |
| `--search <pattern>` | | Substring match on full URL |
| `--since <time>` | | After timestamp (Unix ms or ISO date) |
| `--until <time>` | | Before timestamp (Unix ms or ISO date) |
| `--limit <n>` | `100` | Max results |
| `--format <fmt>` | `table` | `table` or `json` |
| `--tail` | | Real-time interactive TUI (auto-starts proxy + system proxy) |
| `--ui-port <number>` | `8081` | API port (used with `--tail`) |
| `--db-path <path>` | `~/.roxyproxy/data.db` | Database location |

```bash
roxyproxy requests --host api.example.com --method POST
roxyproxy requests --status 500 --limit 20
roxyproxy requests --search "/api/v2" --since "2024-01-15T00:00:00Z"
roxyproxy requests --format json --host stripe.com | jq '.data[].url'
```

### `roxyproxy request <id> [options]`

Show full details of a single captured request: URL, method, status, duration, headers, and bodies.

| Option | Default | Description |
|---|---|---|
| `--format <fmt>` | `json` | `json` or `table` |
| `--db-path <path>` | `~/.roxyproxy/data.db` | Database location |

```bash
roxyproxy request a1b2c3d4-e5f6-7890-abcd-ef1234567890
roxyproxy request <uuid> --format table
```

### `roxyproxy clear [--ui-port <number>]`

Delete all captured traffic from the database.

### `roxyproxy trust-ca`

Install and trust the RoxyProxy CA certificate for HTTPS interception. On macOS, adds to the System Keychain (prompts for sudo). Must start the proxy first to generate the CA.

### `roxyproxy uninstall-ca`

Remove the CA certificate from the system trust store.

### `roxyproxy proxy-on [--port <number>] [--service <name>]`

Configure RoxyProxy as the macOS system-wide HTTP/HTTPS proxy. Auto-detects the active network service (Wi-Fi, Ethernet).

### `roxyproxy proxy-off [--service <name>]`

Remove RoxyProxy from system proxy settings.

## Interactive Tail TUI

The `--tail` TUI has two views: a **request list** and a **request detail** view.

### Request list

| Key | Action |
|---|---|
| `↑` / `↓` | Navigate requests |
| `Enter` | Open request detail |
| `g` / `G` | Jump to newest / oldest |
| `Ctrl+C` | Quit (cleans up proxy + system proxy) |

New requests auto-scroll to the top. Scrolling down disables auto-scroll; `g` re-enables it.

### Request detail (tabbed)

The detail view has three tabs: **Overview**, **Request**, **Response**.

| Key | Action |
|---|---|
| `←` / `→` or `h` / `l` | Switch tabs |
| `1` / `2` / `3` | Jump to Overview / Request / Response |
| `Esc` | Back to request list |

- **Overview** — ID, URL, method, status, duration, protocol, timestamp, request/response sizes
- **Request** — Request headers and body (JSON bodies are pretty-printed)
- **Response** — Response headers and body (JSON bodies are pretty-printed)

## HTTPS Interception

```bash
roxyproxy start        # generates CA on first run
roxyproxy trust-ca     # installs cert (prompts for sudo)
```

After trusting, HTTPS traffic is automatically decrypted when routed through the proxy. Per-domain certificates are generated on-the-fly and cached (LRU, default 500).

## Routing Traffic

```bash
# Explicit proxy flag
curl -x http://127.0.0.1:8080 https://api.example.com/data

# Environment variables
export http_proxy=http://127.0.0.1:8080
export https_proxy=http://127.0.0.1:8080

# macOS system-wide (all apps)
roxyproxy proxy-on
roxyproxy proxy-off
```

`--tail` handles routing automatically — it enables the system proxy on start and disables it on quit.

## REST API

Available at `http://127.0.0.1:8081/api` when the proxy is running.

| Endpoint | Method | Description |
|---|---|---|
| `/api/requests` | GET | Query requests (same filters as CLI via query params) |
| `/api/requests/:id` | GET | Full request detail |
| `/api/requests` | DELETE | Clear all traffic |
| `/api/status` | GET | Proxy status |
| `/api/proxy/start` | POST | Start the proxy |
| `/api/proxy/stop` | POST | Stop the proxy |
| `/api/shutdown` | POST | Shut down the entire process |
| `/api/events` | GET | SSE stream for real-time traffic |

## Using RoxyProxy as Claude (agent workflow)

When you (Claude) need to debug HTTP traffic — for example, the user says "why is this API call failing" or "what's my app sending to Stripe" — you can use RoxyProxy directly via the CLI with JSON output. This is much faster than asking the user to describe what they see.

### Step 1: Start tailing with JSON output

```bash
roxyproxy requests --host <relevant-host> --format json --tail
```

This streams newline-delimited JSON to stdout. Each line is a summary with `id`, `method`, `status`, `host`, `path`, `url`, and `duration`. Run this in the background, then ask the user to reproduce the issue.

### Step 2: Inspect specific requests

Once you spot a relevant request in the stream, use its `id` to get the full detail:

```bash
roxyproxy request <uuid>
```

This returns JSON with the complete request and response: headers (`request_headers`, `response_headers` as JSON strings), bodies (`request_body`, `response_body`), status code, timing, and URL. Bodies are the raw content — JSON bodies are parseable directly.

### Step 3: Query captured traffic after the fact

If the proxy is already running and traffic has been captured, query the database directly:

```bash
# Get recent failures as JSON
roxyproxy requests --host api.example.com --status 500 --format json

# Get all POST requests to a specific endpoint
roxyproxy requests --host api.example.com --method POST --search "/webhooks" --format json

# Get full detail for a specific request
roxyproxy request <uuid>
```

### Example: diagnosing a 401 error

```bash
# 1. Find the failing request
roxyproxy requests --host api.example.com --status 401 --format json --limit 1
# 2. Read the full detail (replace with actual UUID from step 1)
roxyproxy request <uuid-from-step-1>
# 3. Now you can see the Authorization header, request body, and the error response
```

This pattern works for any HTTP debugging task — auth failures, unexpected response bodies, missing headers, wrong payloads, CORS preflight issues, etc.

## Debugging Workflows (user-facing)

### Debug a failing API call

```bash
# Watch traffic in real time, filtered to the failing service
roxyproxy requests --host api.failing-service.com --tail
# Reproduce the issue — the request appears in the TUI
# Press Enter on the failing request, switch to Response tab to see error body
# Or query after the fact:
roxyproxy requests --host api.failing-service.com --status 500
roxyproxy request <uuid>
```

### Inspect authentication headers

```bash
# Filter to the auth endpoint
roxyproxy requests --host auth.example.com --method POST --tail
# Select a request, switch to Request tab to inspect Authorization header, tokens, cookies
```

### Debug webhook payloads

```bash
# Your app receives webhooks — route traffic through the proxy and filter
roxyproxy requests --host localhost --search "/webhooks" --tail
# Select the webhook request, Request tab shows the incoming payload
# Response tab shows what your server replied
```

### Compare request/response for an API integration

```bash
# Capture all traffic to the third-party API
roxyproxy requests --host api.thirdparty.com --tail
# Walk through each request: Overview shows status + timing
# Request tab shows exactly what was sent (headers + body)
# Response tab shows exactly what came back
```

### Find slow requests

```bash
# Capture traffic, then query for all requests and sort by eye in the table
roxyproxy requests --host api.example.com --format table --limit 50
# The TIME column shows duration in ms — spot outliers
```

### Feed captured traffic to an LLM for analysis

```bash
# Export as JSON and pipe to your tool of choice
roxyproxy requests --host api.example.com --format json | jq '.data' > traffic.json
# Or get a single request's full detail
roxyproxy request <uuid> > request-detail.json
```

### Debug CORS or preflight issues

```bash
# Filter for OPTIONS requests
roxyproxy requests --method OPTIONS --host api.example.com --tail
# Check the Response tab for Access-Control-Allow-* headers
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

## Platform Notes

Developed and tested on **macOS**. Core proxy and query features work on Linux, but these are macOS-only:

- System proxy (`proxy-on` / `proxy-off`)
- Auto-enable system proxy with `--tail`
- CA trust via Keychain (`trust-ca`)

## Port Conflicts

RoxyProxy auto-detects port conflicts:
- If another roxyproxy instance holds the port, it's automatically shut down
- Otherwise, the next available port is used (8080 -> 8081 -> 8082...)

The actual ports are always printed on startup.
