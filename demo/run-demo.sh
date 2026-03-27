#!/bin/bash
# RoxyProxy Demo — automated script for asciinema recording
# Real proxy commands, simulated Claude Code UI

# --- Helpers ---

# Simulate typing with realistic speed
type_text() {
  local text="$1"
  local delay="${2:-0.04}"
  for (( i=0; i<${#text}; i++ )); do
    printf '%s' "${text:$i:1}"
    sleep "$delay"
  done
}

# Type a command (display only) then run the real command
show_and_run() {
  local display="$1"
  local actual="${2:-$1}"
  printf '\033[1;32m$ \033[0m'
  type_text "$display"
  sleep 0.3
  echo ""
  eval "$actual"
}

# Print with color
dim()    { printf '\033[2m%s\033[0m' "$1"; }
bold()   { printf '\033[1m%s\033[0m' "$1"; }

# Claude Code styled prompt
claude_prompt() {
  echo ""
  printf '\033[1;37m>\033[0m '
}

# Claude Code "thinking" indicator
claude_thinking() {
  printf '\033[2m'
  for i in 1 2 3; do
    printf '.'
    sleep 0.4
  done
  printf '\033[0m'
  echo ""
}

# Claude Code response text (typed out)
claude_say() {
  local text="$1"
  printf '\033[0m'
  type_text "$text" 0.015
  echo ""
}

# Claude Code tool use block
claude_tool() {
  local tool="$1"
  local cmd="$2"
  echo ""
  printf '  \033[2m%s\033[0m \033[1;36m%s\033[0m\n' "$tool" "$cmd"
  sleep 0.3
}

# --- Resolve roxyproxy binary ---
# Always prefer the local build for the demo (ensures latest code)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -f "$REPO_ROOT/dist/cli/index.js" ]; then
  ROXY="node $REPO_ROOT/dist/cli/index.js"
elif command -v roxyproxy &>/dev/null && roxyproxy --version &>/dev/null; then
  ROXY="roxyproxy"
else
  echo "Error: roxyproxy not found. Run 'npm run build' first."
  exit 1
fi

# --- Cleanup from any previous run ---
$ROXY stop --ui-port 8081 2>/dev/null || true
sleep 0.5

# --- Pre-record: start proxy, capture traffic, kill proxy (not shown in recording) ---
# This runs before the visible demo so the data is ready to query
$ROXY start --port 8080 --ui-port 8081 &>/dev/null &
sleep 2
curl -s -x http://127.0.0.1:8080 -X POST https://httpbin.org/status/422 \
  -H 'Content-Type: application/json' \
  -d '{"webhook_id":"evt_123","type":"payment.failed"}' -o /dev/null 2>/dev/null
sleep 1
# Kill the proxy tree (stop command spawns subprocesses that hang)
pkill -f "dist/cli/index.js start" 2>/dev/null || true
sleep 1

# --- Visible demo starts here ---
clear
echo ""
bold "RoxyProxy Demo"; echo " — the HTTP proxy your AI agent can use"
dim "────────────────────────────────────────────────────────────"; echo ""
echo ""
sleep 1.5

# --- Simulated Claude Code interaction ---
# User prompt
claude_prompt
type_text "My POST to httpbin.org is returning a 422. Can you find out why?" 0.03
sleep 0.5
echo ""
echo ""

# Claude thinking
claude_thinking
echo ""

# Claude runs the command
claude_say "I'll check the captured traffic for the failing request."
claude_tool "Bash" "roxyproxy requests --host httpbin.org --failed --format agent"
echo ""
sleep 0.3

# Actually run the command (real output)
$ROXY requests --host httpbin.org --failed --format agent --limit 1 2>/dev/null
echo ""
sleep 2

# Claude analysis
claude_say "Found it. The POST to httpbin.org/status/422 returned a 422 Unprocessable Entity."
sleep 0.3
claude_say "The request body contains a payment.failed webhook payload, but the endpoint"
claude_say "is rejecting it. The 422 means the server understood the request but can't"
claude_say "process it — likely a schema validation issue in the webhook payload."
echo ""
sleep 1

claude_say "One prompt. Zero manual steps."
echo ""
sleep 2

# no cleanup needed — proxy was already stopped before the visible demo
