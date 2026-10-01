#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SOURCE_DIR/scripts/deploy-runtime.sh"
STAGING_DIR="${SUPERAMBER_STAGING_DIR:-/srv/superamber/staging}"
SERVICE="${SUPERAMBER_STAGING_SERVICE:-superamber-staging.service}"
DEPLOY_BRANCH="${SUPERAMBER_DEPLOY_BRANCH:-main}"
ALLOW_DIRTY=0

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-staging.sh <commit-sha> [--allow-dirty]

Deploy staging from an explicit commit only.
- Default: abort if the source repo worktree is dirty.
- Default: abort if the commit is not reachable from the configured deploy branch (main by default).
- Override: add --allow-dirty to continue, but deployment still uses the given commit only.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

COMMIT_SHA="${1:-}"
if [[ -z "$COMMIT_SHA" ]]; then
  usage
  exit 1
fi

shift || true
for arg in "$@"; do
  case "$arg" in
    --allow-dirty)
      ALLOW_DIRTY=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! "$COMMIT_SHA" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
  echo "Staging deploy requires an explicit commit SHA (7-40 hex chars)." >&2
  exit 1
fi

RESOLVED_COMMIT="$(git -C "$SOURCE_DIR" rev-parse --verify "${COMMIT_SHA}^{commit}")"
SHORT_COMMIT="$(git -C "$SOURCE_DIR" rev-parse --short=12 "$RESOLVED_COMMIT")"
CURRENT_BRANCH="$(git -C "$SOURCE_DIR" branch --show-current)"
DIRTY_STATUS="$(git -C "$SOURCE_DIR" status --short)"

if ! git -C "$SOURCE_DIR" merge-base --is-ancestor "$RESOLVED_COMMIT" "$DEPLOY_BRANCH"; then
  cat >&2 <<EOF
Refusing staging deploy: commit $SHORT_COMMIT is not on branch $DEPLOY_BRANCH.

Staging must come from the configured deploy branch so /api/version,
acceptance, and production promotion all point to the same tested commit.
EOF
  exit 1
fi

if [[ -n "$DIRTY_STATUS" && "$ALLOW_DIRTY" -ne 1 ]]; then
  cat >&2 <<EOF
Refusing staging deploy: source repo has uncommitted changes.

Repo:   $SOURCE_DIR
Branch: ${CURRENT_BRANCH:-detached}
Commit: $SHORT_COMMIT

Commit the intended change first, then deploy by commit.
If you must continue, rerun with: ./scripts/deploy-staging.sh $SHORT_COMMIT --allow-dirty
EOF
  exit 1
fi

if [[ -n "$DIRTY_STATUS" ]]; then
  cat <<EOF
Warning: source repo is dirty, but --allow-dirty was given.
Staging will still deploy from commit $SHORT_COMMIT only.
EOF
fi

if [[ ! -d "$SOURCE_DIR/backend/node_modules" || ! -d "$SOURCE_DIR/frontend/node_modules" ]]; then
  cat >&2 <<EOF
Refusing staging deploy: source dependencies are not installed.

Run this first:
  npm run install:all
EOF
  exit 1
fi

TMP_WORKTREE="$(mktemp -d /tmp/superamber-staging-deploy.XXXXXX)"
cleanup() {
  git -C "$SOURCE_DIR" worktree remove --force "$TMP_WORKTREE" >/dev/null 2>&1 || true
  rm -rf "$TMP_WORKTREE"
}
trap cleanup EXIT

echo "[0/9] Preparing temporary worktree for $SHORT_COMMIT..."
git -C "$SOURCE_DIR" worktree add --detach "$TMP_WORKTREE" "$RESOLVED_COMMIT" >/dev/null

DEPLOYED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
cat >"$TMP_WORKTREE/deploy-meta.json" <<EOF
{
  "environment": "test",
  "commit": "$RESOLVED_COMMIT",
  "commitShort": "$SHORT_COMMIT",
  "sourceBranch": "${CURRENT_BRANCH:-detached}",
  "deployedAt": "$DEPLOYED_AT"
}
EOF

echo "[1/9] Linking dependencies into temporary worktree..."
ln -sfn "$SOURCE_DIR/backend/node_modules" "$TMP_WORKTREE/backend/node_modules"
ln -sfn "$SOURCE_DIR/frontend/node_modules" "$TMP_WORKTREE/frontend/node_modules"

echo "[2/9] Running backend tests..."
node "$TMP_WORKTREE/scripts/verify-staging-release.cjs" "$RESOLVED_COMMIT"
(cd "$TMP_WORKTREE/backend" && NODE_ENV=test npm test)

echo "[3/9] Running frontend tests..."
(cd "$TMP_WORKTREE/frontend" && NODE_ENV=test npm test)

echo "[4/9] Building frontend..."
(cd "$TMP_WORKTREE/frontend" && npm run build)

echo "[5/9] Removing dependency symlinks before sync..."
rm -f "$TMP_WORKTREE/backend/node_modules" "$TMP_WORKTREE/frontend/node_modules"

echo "[6/9] Syncing files to staging..."
node "$TMP_WORKTREE/scripts/verify-staging-release.cjs" "$RESOLVED_COMMIT"
if [[ -n "${SUPERAMBER_EXPECTED_STAGING_COMMIT:-}" ]]; then
  CURRENT_STAGING_COMMIT="$(node -p "require('$STAGING_DIR/deploy-meta.json').commitShort")"
  if [[ "$CURRENT_STAGING_COMMIT" != "$SUPERAMBER_EXPECTED_STAGING_COMMIT" ]]; then
    echo "Staging changed during validation; refusing to overwrite commit $CURRENT_STAGING_COMMIT." >&2
    exit 1
  fi
fi
sync_runtime_release "$TMP_WORKTREE" "$STAGING_DIR"

echo "[7/9] Restarting staging service..."
systemctl restart "$SERVICE"
sleep 2

echo "[8/9] Checking staging health..."
curl -fsS http://127.0.0.1:7781/api/health
echo

echo "[9/9] Checking staging version..."
curl -fsS http://127.0.0.1:7781/api/version
echo
echo "Staging deploy finished at commit $SHORT_COMMIT."
echo "Checking teacher grant endpoints (SPA HTML is a deployment failure)..."
node "$STAGING_DIR/scripts/check-source-grant-contract.mjs" http://127.0.0.1:7781
