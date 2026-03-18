# Request Repeater — Design Spec

## Overview

Add a Repeater feature to RoxyProxy: view a captured request, edit any field (URL, method, headers, body), and send it again. The replayed response is ephemeral (not stored in the traffic DB). Supports multiple tabs, and is accessible via web UI, REST API, and CLI.

## Architecture

```
RequestDetail → "Send to Repeater" button
                        ↓
              Repeater view (new tab in UI)
              ┌─────────────────────────────────┐
              │ Tab bar: [Tab 1] [Tab 2] [+]    │
              │ ┌──────────────┬───────────────┐ │
              │ │ Request      │ Response      │ │
              │ │ (editable)   │ (read-only)   │ │
              │ │              │               │ │
              │ │ URL bar      │ Status        │ │
              │ │ Method       │ Headers       │ │
              │ │ Headers      │ Body          │ │
              │ │ Body         │               │ │
              │ │       [Send] │               │ │
              │ └──────────────┴───────────────┘ │
              └─────────────────────────────────┘
```

## 1. Backend — Replay Module

**New file:** `src/server/replay.ts`

A standalone async function that sends an HTTP/HTTPS request and returns the response. Reuses the proxy's approach (strip `accept-encoding`, delete `proxy-connection`) but does NOT store to DB or emit SSE events.

```typescript
export interface ReplayRequest {
  url: string;                                   // full URL with scheme (http:// or https://)
  method: string;                                // GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
  headers: Record<string, string | string[]>;    // request headers (supports multi-value)
  body?: string;                                 // base64-encoded body (optional)
}

export interface ReplayResponse {
  status: number;
  headers: Record<string, string | string[]>;    // preserves multi-value headers from Node.js
  body: string;                                  // base64-encoded
  duration: number;                              // milliseconds
  size: number;                                  // response body bytes
}

export async function replay(request: ReplayRequest): Promise<ReplayResponse>
```

**Behavior:**
- Parse URL to determine http vs https
- Validate URL has a scheme (`http://` or `https://`); reject with error if missing
- Validate method is a non-empty string
- Strip `accept-encoding` from outgoing headers (same as proxy)
- Delete `proxy-connection` header
- Set `host` header from URL hostname
- Use `http.request` or `https.request` (with `rejectUnauthorized: false` for https)
- Collect full response body up to `maxBodySize` (from config, default 1MB); truncate beyond
- Return response headers as-is from Node.js (preserving arrays for multi-value headers like `set-cookie`)
- Measure duration from request start to response end
- Timeout: 30 seconds (reject with error)

### RequestRecord to ReplayRequest conversion

A utility function `recordToReplayRequest` converts a stored `RequestRecord` to a `ReplayRequest`:

```typescript
export function recordToReplayRequest(record: RequestRecord): ReplayRequest {
  // Parse JSON string headers, stripping proxy-specific ones
  const rawHeaders = JSON.parse(record.request_headers || '{}');
  const headers: Record<string, string | string[]> = {};
  const skipHeaders = new Set(['proxy-connection', 'proxy-authorization', 'connection', 'keep-alive']);
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (!skipHeaders.has(key.toLowerCase())) {
      headers[key] = value as string | string[];
    }
  }
  return {
    url: record.url,
    method: record.method,
    headers,
    body: record.request_body ? Buffer.from(record.request_body).toString('base64') : undefined,
  };
}
```

This is used by both the CLI command and the frontend's "Send to Repeater" flow.

## 2. API Endpoint

**New route in** `src/server/api.ts`:

```
POST /api/replay
```

**Request body:** `ReplayRequest` (JSON). Max body size: 2MB (covers base64 overhead on 1MB payload).

**Response body:** `ReplayResponse` (JSON)

**Validation:**
- `url` must be present and start with `http://` or `https://`; otherwise `400`
- `method` must be a non-empty string; otherwise `400`
- `headers` defaults to `{}` if omitted
- `body` is optional

**Error responses (format: `{ error: string }`):**
- `400` — missing/invalid URL or method
- `502` — upstream connection failed (DNS, connection refused, etc.)
- `504` — request timed out (30s)

## 3. CLI Command

**New file:** `src/cli/commands/replay.ts`

```
roxyproxy replay <id> [options]
```

Loads the request from DB by UUID, converts it using `recordToReplayRequest`, optionally overrides fields, sends it via the `replay()` function, and prints the response.

**Options:**
- `--method <method>` — override HTTP method
- `--url <url>` — override URL
- `--header <header>` — override/add header (repeatable, format: `Key: Value`)
- `--body <body>` — override body (raw string, will be base64-encoded before sending)
- `--format <format>` — output format: `json` (default) or `table`
- `--db-path <path>` — database path (consistent with other CLI commands)

**Behavior:**
1. Load config with `loadConfig()`, open DB
2. Fetch record via `db.getById(id)`
3. Convert to `ReplayRequest` via `recordToReplayRequest(record)`
4. Apply any overrides from flags (--method, --url, --header, --body)
5. Call `replay(request)` directly (same process, no API call needed)
6. Print response: status, headers, decoded body
7. Close DB

## 4. Web UI — Layout Changes

**Modified file:** `src/ui/App.tsx`

Add a top-level tab bar to switch between two views:
- **Traffic** — the existing traffic list + detail panel (unchanged)
- **Repeater** — the new repeater workspace

State additions in App:
- `activeView: 'traffic' | 'repeater'`
- `repeaterTabs: RepeaterTab[]` — array of open repeater tabs
- `activeRepeaterTab: string | null` — ID of the focused tab

## 5. Web UI — RequestDetail Changes

**Modified file:** `src/ui/components/RequestDetail.tsx`

Add a "Send to Repeater" button next to the existing "cURL" button. When clicked, it calls a callback (`onSendToRepeater`) that:
1. Switches the app view to Repeater
2. Creates a new repeater tab pre-filled with the request's URL, method, headers, and body

The callback receives a `RepeaterTabInit` with the request data already parsed from the `RequestRecord` (headers converted from JSON string to one-per-line text format, body base64-decoded to raw text).

## 6. Web UI — Repeater Component

**New file:** `src/ui/components/Repeater.tsx`

### RepeaterTab data model

```typescript
interface RepeaterTab {
  id: string;              // unique tab ID
  name: string;            // display name (host from URL, or "New Request 1", "New Request 2", etc.)
  request: {
    url: string;
    method: string;
    headers: string;       // raw text, one header per line ("Key: Value")
    body: string;          // raw text (displayed/edited as text)
  };
  response: ReplayResponse | null;
  loading: boolean;
}
```

### Header parsing (textarea to API)

When sending, the headers textarea is parsed line by line:
- Empty lines and whitespace-only lines are skipped
- Each line is split on the first `:` — left side is key, right side (trimmed) is value
- Lines without a `:` are skipped (silently ignored)
- Duplicate keys: last value wins (single-value `Record<string, string>` sent to API)
- This is intentionally simple — for multi-value headers, users can use the CLI or API directly

### Layout

- **Tab bar** across the top — shows tab names, close buttons, and a "+" button for blank new tabs
- **Keyboard shortcut:** Cmd+Enter (Mac) / Ctrl+Enter (Windows/Linux) sends the request
- **Split pane** below (horizontal split):
  - **Left: Request editor**
    - URL input (text field, full URL)
    - Method dropdown (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
    - Headers textarea (raw key-value pairs, one per line)
    - Body textarea (raw text)
    - "Send" button (prominent, blue)
  - **Right: Response viewer** (read-only, same styling as RequestDetail)
    - Status code (color-coded)
    - Duration and size metadata
    - Headers display (multi-value headers shown with each value on its own line)
    - Body display (with JSON pretty-printing)
    - Empty state when no response yet: "Send a request to see the response"
    - Error state: show error message (timeout, connection failed, etc.)

### Interactions

- **Send:** Parse headers textarea, base64-encode body, POST to `/api/replay`, show loading spinner on Send button, display response or error
- **Close tab:** Remove tab, switch to adjacent tab or show empty state
- **New tab (+):** Add blank tab with incrementing name ("New Request 1", "New Request 2", ...)
- **Tab rename:** Double-click tab name to edit (optional, low priority)

## 7. Frontend API Client

**Modified file:** `src/ui/api.ts`

Add:

```typescript
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

## Files Changed

| File | Change |
|------|--------|
| `src/server/replay.ts` | **New** — replay function + recordToReplayRequest conversion |
| `src/server/api.ts` | Add `POST /api/replay` route |
| `src/shared/types.ts` | Add `ReplayRequest`, `ReplayResponse` types |
| `src/cli/commands/replay.ts` | **New** — CLI replay command |
| `src/cli/index.ts` | Register replay command |
| `src/ui/App.tsx` | Add view tabs (Traffic/Repeater), repeater tab state |
| `src/ui/api.ts` | Add `replayRequest` function + types |
| `src/ui/components/RequestDetail.tsx` | Add "Send to Repeater" button |
| `src/ui/components/Repeater.tsx` | **New** — full repeater UI |

## Testing

- **`src/server/replay.ts`** — unit tests: mock `http.request`/`https.request`, verify header stripping, timeout, base64 encoding, `recordToReplayRequest` conversion
- **`src/server/api.ts`** — integration tests for `POST /api/replay`: valid request, missing URL (400), bad scheme (400), connection error (502), timeout (504)
- **`src/cli/commands/replay.ts`** — smoke test: load from DB, verify override flags are applied

## Out of Scope

- Request history within repeater tabs (undo/redo)
- Saving/loading repeater tabs across sessions (including localStorage persistence)
- Diff view between original and replayed response
- WebSocket replay
- Request interception/breakpoints (modify in-flight)
- Binary body editing (binary bodies are displayed as base64 text; a hex editor is a future enhancement)
- Cancel/abort for in-flight requests (future enhancement)
