#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SOURCE_DIR/scripts/deploy-runtime.sh"
PROD_DIR="${SUPERAMBER_PROD_DIR:-/srv/superamber/production}"
STAGING_DIR="${SUPERAMBER_STAGING_DIR:-/srv/superamber/staging}"
SERVICE="${SUPERAMBER_PROD_SERVICE:-superamber-production.service}"
DEPLOY_BRANCH="${SUPERAMBER_DEPLOY_BRANCH:-main}"
EXPECTED_PRODUCTION_COMMIT="${SUPERAMBER_EXPECTED_PRODUCTION_COMMIT:-}"

verify_production_unchanged() {
  if [[ -n "$EXPECTED_PRODUCTION_COMMIT" ]]; then
    local actual
    actual="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PROD_DIR/deploy-meta.json','utf8')).commit || '')")"
    if [[ "$actual" != "$EXPECTED_PRODUCTION_COMMIT"* ]]; then
      echo "Production changed during verification; refusing to overwrite $actual." >&2
      exit 1
    fi
  fi
}

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-production.sh <commit-sha>

Promote a staging-verified commit to production.
- The commit MUST match the one currently deployed on staging.
- The commit MUST already be reachable from the configured deploy branch (main by default).
- The staging health check must pass before promotion proceeds.
- Source repo must be clean (no --allow-dirty for production).
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

if [[ ! "$COMMIT_SHA" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
  echo "Production deploy requires an explicit commit SHA (7-40 hex chars)." >&2
  exit 1
fi

RESOLVED_COMMIT="$(git -C "$SOURCE_DIR" rev-parse --verify "${COMMIT_SHA}^{commit}")"
SHORT_COMMIT="$(git -C "$SOURCE_DIR" rev-parse --short=12 "$RESOLVED_COMMIT")"
CURRENT_BRANCH="$(git -C "$SOURCE_DIR" branch --show-current)"

if ! git -C "$SOURCE_DIR" merge-base --is-ancestor "$RESOLVED_COMMIT" "$DEPLOY_BRANCH"; then
  cat >&2 <<EOF
Refusing production deploy: commit $SHORT_COMMIT is not on branch $DEPLOY_BRANCH.

Production must come from the configured deploy branch. Put the approved
commit on $DEPLOY_BRANCH, deploy it to staging, and then promote that exact
commit.
EOF
  exit 1
fi

# ── Guard 1: source repo must be clean ──────────────────────────────────────
DIRTY_STATUS="$(git -C "$SOURCE_DIR" status --short)"
if [[ -n "$DIRTY_STATUS" ]]; then
  cat >&2 <<EOF
Refusing production deploy: source repo has uncommitted changes.

Repo:   $SOURCE_DIR
Branch: ${CURRENT_BRANCH:-detached}
Commit: $SHORT_COMMIT

Commit all changes first, then deploy by commit.
EOF
  exit 1
fi

if [[ ! -d "$SOURCE_DIR/backend/node_modules" || ! -d "$SOURCE_DIR/frontend/node_modules" ]]; then
  cat >&2 <<EOF
Refusing production deploy: source dependencies are not installed.

Run this first:
  npm run install:all
EOF
  exit 1
fi

# ── Guard 2: staging must be healthy ────────────────────────────────────────
echo "[pre] Checking staging health..."
if ! curl -fsS http://127.0.0.1:7781/api/health >/dev/null 2>&1; then
  echo "Staging health check failed. Fix staging before promoting to production." >&2
  exit 1
fi

# ── Guard 3: commit must match staging deployment ───────────────────────────
STAGING_META="$STAGING_DIR/deploy-meta.json"
if [[ ! -f "$STAGING_META" ]]; then
  echo "No deploy-meta.json found in staging ($STAGING_DIR). Deploy to staging first." >&2
  exit 1
fi

STAGING_COMMIT="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$STAGING_META','utf8')).commit || '')")"
if [[ "$RESOLVED_COMMIT" != "$STAGING_COMMIT" ]]; then
  STAGING_SHORT="$(echo "$STAGING_COMMIT" | cut -c1-12)"
  cat >&2 <<EOF
Commit mismatch: refusing production deploy.

  Requested commit:  $SHORT_COMMIT
  Staging commit:    $STAGING_SHORT

Production can only be deployed from the same commit currently on staging.
Deploy this commit to staging first, verify it, then promote.
EOF
  exit 1
fi

echo "Staging verified: commit $SHORT_COMMIT matches staging deployment."
verify_production_unchanged

# ── Build from temporary worktree ───────────────────────────────────────────
TMP_WORKTREE="$(mktemp -d /tmp/superamber-prod-deploy.XXXXXX)"
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
  "environment": "production",
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
(cd "$TMP_WORKTREE/backend" && NODE_ENV=test npm test)

echo "[3/9] Running frontend tests..."
(cd "$TMP_WORKTREE/frontend" && NODE_ENV=test npm test)

echo "[4/9] Building frontend..."
(cd "$TMP_WORKTREE/frontend" && npm run build)

echo "[5/9] Removing dependency symlinks before sync..."
rm -f "$TMP_WORKTREE/backend/node_modules" "$TMP_WORKTREE/frontend/node_modules"

echo "[6/9] Syncing files to production..."
verify_production_unchanged
sync_runtime_release "$TMP_WORKTREE" "$PROD_DIR"

echo "[7/9] Restarting production service..."
systemctl restart "$SERVICE"
sleep 2

echo "[8/9] Checking production health..."
curl -fsS http://127.0.0.1:7741/api/health
echo

echo "[9/9] Checking production version..."
curl -fsS http://127.0.0.1:7741/api/version
echo
echo "Production deploy finished at commit $SHORT_COMMIT ($DEPLOYED_AT)."
