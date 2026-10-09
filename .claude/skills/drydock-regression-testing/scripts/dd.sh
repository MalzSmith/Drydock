#!/bin/sh
# Sends the JavaScript read from stdin to this runner's driver and prints the JSON reply.
# usage: sh dd.sh <<'EOF' ... EOF        (needs DD_DRIVER_PORT from work/<runner>/env.sh)
[ -n "$DD_DRIVER_PORT" ] || { echo '{"ok":false,"error":"DD_DRIVER_PORT is not set"}'; exit 1; }
curl -s --max-time "${DD_MAXTIME:-540}" --data-binary @- "http://127.0.0.1:$DD_DRIVER_PORT/"
