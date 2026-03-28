#!/bin/bash
# Laurel Proxy Demo Script
# Records an asciinema demo showing the AI-native debugging workflow.
# Real proxy, real traffic, simulated Claude Code UI.
#
# Usage: ./demo/record.sh
# Output: demo/laurel-proxy-demo.cast

set -e

CAST_FILE="demo/laurel-proxy-demo.cast"
DEMO_SCRIPT="demo/run-demo.sh"

echo "Starting asciinema recording..."
echo "The demo will run automatically. Just watch."
echo ""

asciinema rec "$CAST_FILE" \
  --command "bash $DEMO_SCRIPT" \
  --title "Laurel Proxy — The HTTP proxy your AI agent can use" \
  --cols 100 \
  --rows 30 \
  --overwrite

echo ""
echo "Recording saved to $CAST_FILE"
echo ""
echo "To generate GIF:  agg $CAST_FILE demo/laurel-proxy-demo.gif --theme monokai --font-size 14"
echo "To play locally:  asciinema play $CAST_FILE"
echo "To upload:        asciinema upload $CAST_FILE"
