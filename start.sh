#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js fehlt: https://nodejs.org/"; exit 1; }
(sleep 1; xdg-open http://127.0.0.1:4321 2>/dev/null || open http://127.0.0.1:4321 2>/dev/null) &
node server.js
