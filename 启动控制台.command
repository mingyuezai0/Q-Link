#!/bin/sh
# macOS / Linux 启动脚本。中文提示统一由 scripts/launch.mjs 输出。
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  [!] Node.js not found. Please install Node.js 18+ from https://nodejs.org"
  echo ""
  read -r _
  exit 1
fi

node "scripts/launch.mjs"
