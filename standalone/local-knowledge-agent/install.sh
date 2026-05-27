#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

echo "Installing Local Knowledge Agent"
echo "Package: $(pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required. Install it from https://nodejs.org/" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required and normally ships with Node.js." >&2
  exit 1
fi

npm install --ignore-scripts
mkdir -p data/store
npm run setup:check

echo
echo "Install complete."
echo "Start the web UI with: npm start"
echo "Then open: http://localhost:3737"
