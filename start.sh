#!/usr/bin/env bash
# OmniComics Runner Script (Node.js)

cd "$(dirname "$0")"

PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"

echo "=========================================================="
echo "🚀 Starting OmniComics Web Reader & Telegram Publisher (Node.js)"
echo "=========================================================="
echo "• Web App URL: http://localhost:${PORT}"
echo "• Runtime:     Node.js $(node -v)"
echo "• Database:    ./data/database.db"
echo "• Uploads:     ./data/uploads"
echo "=========================================================="

export PORT="${PORT}"
exec node server/index.js
