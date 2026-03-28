---
name: laurel-proxy
description: Use when working with Laurel Proxy, intercepting HTTP/HTTPS traffic, debugging API calls, inspecting network requests, or when the user mentions laurel-proxy, proxy traffic, captured requests, or network debugging. Also use when the user asks to start/stop a proxy, view traffic, configure HTTPS interception, or debug why an API call is failing. Trigger even when the user just says "capture traffic", "inspect requests", "what is my app sending", or "debug this API".
version: 1.2.0
---

# Laurel Proxy

Laurel Proxy is an HTTP/HTTPS intercepting proxy with a CLI and web UI. It captures traffic, stores it in SQLite, and makes it queryable. Works on **macOS** and **Linux**.

Install: `npm install -g @rvanbaalen/laurel-proxy`
Run without installing: `npx @rvanbaalen/laurel-proxy`

## Quick Start — One Command

The fastest way to capture and inspect traffic. This single command starts the proxy, enables the macOS system proxy, and opens a live interactive TUI:

```bash
laurel-proxy requests --tail
laurel-proxy requests --host api.example.com --tail
laurel-proxy requests --status 500 --tail
laurel-proxy requests --host stripe.com --method POST --tail
```

`--tail` automatically:
1. Starts the proxy if it isn't running
2. Enables the macOS system proxy (routes all traffic through Laurel Proxy)
3. Opens an interactive terminal TUI
4. On quit (Ctrl+C), disables the system proxy and stops the proxy

For raw JSON streaming instead of the TUI: `laurel-proxy requests --format json --tail`

## CLI Commands

### `laurel-proxy` (interactive mode)

Running with no arguments launches a terminal menu with access to all features: start/stop proxy, view requests, clear traffic, open web UI, trust CA, enable system proxy, quit.

### `laurel-proxy start [options]`

Start the proxy server in the foreground.

| Option | Default | Description |
|---|---|---|
| `--port <number>` | `8080` | Proxy listening port |
| `--ui-port <number>` | `8081` | Web UI and API port |
| `--db-path <path>` | `~/.laurel-proxy/data.db` | SQLite database location |

### `laurel-proxy stop [--ui-port <number>]`

Stop the running proxy. Sends a graceful shutdown request via the API, falls back to SIGTERM via PID file.

### `laurel-proxy status [--ui-port <number>]`

Show proxy status: running state, proxy port, request count, database size.

### `laurel-proxy requests [options]`

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
| `--format <fmt>` | `table` | `table`, `json`, or `agent` |
| `--failed` | | Shortcut: only 4xx/5xx responses (statusMin=400) |
| `--last-hour` | | Shortcut: requests from the last hour |
| `--last-day` | | Shortcut: requests from the last 24 hours |
| `--slow <ms>` | | Shortcut: requests slower than threshold (e.g. `--slow 500`) |
| `--tail` | | Real-time interactive TUI (auto-starts proxy + system proxy) |
| `--ui-port <number>` | `8081` | API port (used with `--tail`) |
| `--db-path <path>` | `~/.laurel-proxy/data.db` | Database location |

```bash
laurel-proxy requests --host api.example.com --method POST
laurel-proxy requests --status 500 --limit 20
laurel-proxy requests --search "/api/v2" --since "2024-01-15T00:00:00Z"
laurel-proxy requests --format json --host stripe.com | jq '.data[].url'
```

### `laurel-proxy request <id> [options]`

Show full details of a single captured request: URL, method, status, duration, headers, and bodies.

| Option | Default | Description |
|---|---|---|
| `--format <fmt>` | `json` | `json`, `table`, or `agent` |
| `--db-path <path>` | `~/.laurel-proxy/data.db` | Database location |

```bash
laurel-proxy request a1b2c3d4-e5f6-7890-abcd-ef1234567890
laurel-proxy request <uuid> --format table
```

### `laurel-proxy clear [--ui-port <number>]`

Delete all captured traffic from the database.

### `laurel-proxy trust-ca`

Install and trust the Laurel Proxy CA certificate for HTTPS interception. On macOS, adds to the System Keychain (prompts for sudo). Must start the proxy first to generate the CA.

### `laurel-proxy uninstall-ca`

Remove the CA certificate from the system trust store.

### `laurel-proxy proxy-on [--port <number>] [--service <name>]`

Configure Laurel Proxy as the macOS system-wide HTTP/HTTPS proxy. Auto-detects the active network service (Wi-Fi, Ethernet).

### `laurel-proxy proxy-off [--service <name>]`

Remove Laurel Proxy from system proxy settings.

### `laurel-proxy replay <id> [options]`

Resend a previously captured request. Useful for reproducing issues or testing fixes.

| Option | Default | Description |
|---|---|---|
| `--method <method>` | (original) | Override HTTP method |
| `--url <url>` | (original) | Override URL |
| `--header <header...>` | (original) | Override/add header (format: "Key: Value") |
| `--body <body>` | (original) | Override body (raw string) |
| `--diff` | off | Show diff between original and replay response |
| `--format <format>` | `json` | Output format (json\|table\|agent) |
| `--db-path <path>` | (config) | Database path |

```bash
# Replay a captured request
laurel-proxy replay a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Replay with diff to see if a fix worked
laurel-proxy replay a1b2c3d4 --diff

# Replay with diff in agent format (best for LLM consumption)
laurel-proxy replay a1b2c3d4 --diff --format agent
```

**Diff output** shows whether the replay status improved, regressed, changed, or stayed the same compared to the original captured response. Exit codes: 0 = replay is 2xx, 1 = replay is 4xx/5xx, 2 = connection failure.

## Agent Output Format (`--format agent`)

The `agent` format returns enriched JSON optimized for LLM consumption. Use this when debugging via Claude Code instead of `json` or `table`.

**List view** (`laurel-proxy requests --format agent`): returns an array of enriched records with decoded bodies, `is_error` flag, and timing metadata.

**Detail view** (`laurel-proxy request <id> --format agent`): returns a single enriched record with full request/response bodies decoded (not base64), a human-readable `summary` line, and `context.is_error` for quick triage.

```bash
# Get all failed requests in agent-optimized format
laurel-proxy requests --failed --format agent

# Get full detail for a specific request
laurel-proxy request <uuid> --format agent
```

## Smart Filter Aliases

Convenience shortcuts that map to common filter combinations:

```bash
laurel-proxy requests --failed              # status >= 400
laurel-proxy requests --last-hour           # since 1 hour ago
laurel-proxy requests --last-day            # since 24 hours ago
laurel-proxy requests --slow 500            # duration > 500ms
laurel-proxy requests --failed --last-hour  # combine filters
```

`--status` overrides `--failed` if both are specified.

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
laurel-proxy start        # generates CA on first run
laurel-proxy trust-ca     # installs cert (prompts for sudo)
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
laurel-proxy proxy-on
laurel-proxy proxy-off
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
| `/api/replay` | POST | Replay a captured request (body: `{ url, method, headers, body }`) |

## Using Laurel Proxy as Claude (agent workflow)

When you (Claude) need to debug HTTP traffic — for example, the user says "why is this API call failing" or "what's my app sending to Stripe" — use `--format agent` for enriched, LLM-optimized output. This is much faster than asking the user to describe what they see.

### Step 1: Find failing requests

```bash
# Get all recent failures with enriched output
laurel-proxy requests --host <relevant-host> --failed --format agent

# Or narrow by time
laurel-proxy requests --host <relevant-host> --failed --last-hour --format agent
```

The `agent` format returns decoded bodies (not base64), `is_error` flags, and timing metadata — everything you need to diagnose the issue.

### Step 2: Inspect a specific request

```bash
laurel-proxy request <uuid> --format agent
```

Returns the full request and response with decoded bodies, headers, a human-readable summary line, and error context. JSON bodies are already parsed.

### Step 3: Replay with diff to verify a fix

After identifying the issue and applying a fix, replay the original request and diff against the original response:

```bash
laurel-proxy replay <uuid> --diff --format agent
```

The `--diff` flag shows whether the status improved, regressed, or stayed the same. The agent format returns structured JSON with `result` ("improved", "regressed", "changed", "unchanged"), `status_changed`, and `body_changed` fields. Exit code 0 means the replay returned 2xx (success).

### Step 4: Tail for real-time debugging

If the issue needs live reproduction:

```bash
laurel-proxy requests --host <relevant-host> --format agent --tail
```

Streams enriched JSON to stdout in real-time. Run this, then ask the user to reproduce the issue.

### Example: diagnosing a 422 error

```bash
# 1. Find the failing request
laurel-proxy requests --host api.example.com --failed --format agent --limit 1
# 2. Read the full detail (replace with actual UUID from step 1)
laurel-proxy request <uuid-from-step-1> --format agent
# 3. The agent format shows decoded body, error context, and timing
# 4. After fixing, replay with diff to verify
laurel-proxy replay <uuid-from-step-1> --diff --format agent
```

This pattern works for any HTTP debugging task — auth failures, unexpected response bodies, missing headers, wrong payloads, CORS preflight issues, etc.

## Debugging Workflows (user-facing)

### Debug a failing API call

```bash
# Watch traffic in real time, filtered to the failing service
laurel-proxy requests --host api.failing-service.com --tail
# Reproduce the issue — the request appears in the TUI
# Press Enter on the failing request, switch to Response tab to see error body
# Or query after the fact:
laurel-proxy requests --host api.failing-service.com --status 500
laurel-proxy request <uuid>
```

### Inspect authentication headers

```bash
# Filter to the auth endpoint
laurel-proxy requests --host auth.example.com --method POST --tail
# Select a request, switch to Request tab to inspect Authorization header, tokens, cookies
```

### Debug webhook payloads

```bash
# Your app receives webhooks — route traffic through the proxy and filter
laurel-proxy requests --host localhost --search "/webhooks" --tail
# Select the webhook request, Request tab shows the incoming payload
# Response tab shows what your server replied
```

### Compare request/response for an API integration

```bash
# Capture all traffic to the third-party API
laurel-proxy requests --host api.thirdparty.com --tail
# Walk through each request: Overview shows status + timing
# Request tab shows exactly what was sent (headers + body)
# Response tab shows exactly what came back
```

### Find slow requests

```bash
# Find requests slower than 500ms
laurel-proxy requests --host api.example.com --slow 500 --format agent

# Or browse visually in the table
laurel-proxy requests --host api.example.com --format table --limit 50
# The TIME column shows duration in ms — spot outliers
```

### Feed captured traffic to an LLM for analysis

```bash
# Export as JSON and pipe to your tool of choice
laurel-proxy requests --host api.example.com --format json | jq '.data' > traffic.json
# Or get a single request's full detail
laurel-proxy request <uuid> > request-detail.json
```

### Debug CORS or preflight issues

```bash
# Filter for OPTIONS requests
laurel-proxy requests --method OPTIONS --host api.example.com --tail
# Check the Response tab for Access-Control-Allow-* headers
```

## Configuration

Config file at `~/.laurel-proxy/config.json`:

```json
{
  "proxyPort": 8080,
  "uiPort": 8081,
  "dbPath": "~/.laurel-proxy/data.db",
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
| `~/.laurel-proxy/data.db` | SQLite database |
| `~/.laurel-proxy/config.json` | Configuration (optional) |
| `~/.laurel-proxy/ca/ca.crt` | Root CA certificate |
| `~/.laurel-proxy/ca/ca.key` | Root CA private key |
| `~/.laurel-proxy/pid` | Process ID file |

## Platform Notes

Works on **macOS** and **Linux**. Core proxy, query, and web UI features work on both platforms. These are macOS-only:

- System proxy (`proxy-on` / `proxy-off`)
- Auto-enable system proxy with `--tail`
- CA trust via Keychain (`trust-ca`)

## Port Conflicts

Laurel Proxy auto-detects port conflicts:
- If another laurel-proxy instance holds the port, it's automatically shut down
- Otherwise, the next available port is used (8080 -> 8081 -> 8082...)

The actual ports are always printed on startup.
