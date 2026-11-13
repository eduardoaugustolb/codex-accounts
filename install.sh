#!/bin/sh
set -eu

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install Bun, then run this installer again." >&2
  exit 1
fi

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec bun "$project_dir/tools/install-cli.ts" "$@"
