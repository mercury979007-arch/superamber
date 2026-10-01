#!/usr/bin/env bash

# Both environments publish the same tracked files and locked dependencies.
# Teacher data, runtime links and previously loaded frontend assets survive.
sync_runtime_release() {
  local candidate="$1"
  local destination="$2"
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'data/' \
    --exclude 'node_modules/' \
    --filter 'protect node_modules/' \
    --filter 'protect frontend/dist/assets/***' \
    "$candidate/" "$destination/"
  mkdir -p "$destination/data"
  npm ci --prefix "$destination/backend" --ignore-scripts --no-audit --no-fund
}
