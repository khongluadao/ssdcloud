#!/usr/bin/env sh
set -eu

if ! command -v go >/dev/null 2>&1; then
  echo "[ERROR] Go is not installed or not in PATH." >&2
  exit 1
fi

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
BIN_DIR="$ROOT_DIR/bin"

mkdir -p "$BIN_DIR"
cd "$ROOT_DIR"

echo "Building Linux binary..."
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-s -w" -o "$BIN_DIR/up" ./scripts/up/main.go

echo "Building Windows binary..."
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags "-s -w" -o "$BIN_DIR/up.exe" ./scripts/up/main.go

echo "Done:"
echo "  - bin/up      (Linux ELF)"
echo "  - bin/up.exe  (Windows EXE)"
