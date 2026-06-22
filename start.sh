#!/usr/bin/env bash
# Run this to start Wally on macOS or Linux:  ./start.sh
cd "$(dirname "$0")" || exit 1

if command -v python3 >/dev/null 2>&1; then
  exec python3 start.py
elif command -v python >/dev/null 2>&1; then
  exec python start.py
else
  echo
  echo "[X] Python was not found."
  echo "    Install it from https://www.python.org/downloads/ and try again."
  echo
  exit 1
fi
