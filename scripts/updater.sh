#!/usr/bin/env bash
set -euo pipefail

# Fern Updater Script
# Polls for trigger files and performs git pull + build + restart or rollback.
# Runs as a separate pm2 process, isolated from the main Fern process.

REPO_DIR="${FERN_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
FERN_DIR="${HOME}/.fern"
TRIGGER_FILE="${FERN_DIR}/update-trigger.flag"
ROLLBACK_FILE="${FERN_DIR}/rollback-trigger.flag"
BACKUP_DIR="${REPO_DIR}/dist-backup"
POLL_INTERVAL="${FERN_UPDATER_POLL_INTERVAL:-5}"
NEW_KEYS_FLAG="${FERN_DIR}/new-env-keys.flag"

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] [updater] $*"
}

# Detect new env var keys added to .env.example after a git pull.
# Writes new key names to a flag file so Fern can alert on startup.
detect_new_env_keys() {
  local old_keys_file="$1"
  local env_example="${REPO_DIR}/.env.example"

  if [[ ! -f "$env_example" ]]; then
    log "No .env.example found — skipping env key detection"
    return
  fi

  # Extract key names (lines matching KEY=..., ignoring comments and blanks)
  local new_keys
  new_keys=$(grep -E '^[A-Z_]+=' "$env_example" | cut -d= -f1 | sort)

  if [[ ! -f "$old_keys_file" ]]; then
    log "No previous env keys to compare — skipping diff"
    return
  fi

  local added
  added=$(comm -13 "$old_keys_file" <(echo "$new_keys"))

  if [[ -n "$added" ]]; then
    log "New env vars detected in .env.example:"
    echo "$added" | while read -r key; do log "  + $key"; done
    echo "$added" > "$NEW_KEYS_FLAG"
  fi
}

perform_update() {
  log "Update trigger detected"
  cat "$TRIGGER_FILE"
  rm -f "$TRIGGER_FILE"

  cd "$REPO_DIR" || { log "ERROR: Cannot cd to $REPO_DIR"; return 1; }

  # Snapshot current .env.example keys before pulling
  local old_keys_file
  old_keys_file=$(mktemp)
  if [[ -f ".env.example" ]]; then
    grep -E '^[A-Z_]+=' .env.example | cut -d= -f1 | sort > "$old_keys_file"
  fi

  # Backup current dist/
  rm -rf "$BACKUP_DIR"
  if [[ -d dist ]]; then
    log "Backing up dist/ → dist-backup/"
    cp -r dist "$BACKUP_DIR"
  fi

  # Ensure we're on main and pull latest
  log "Checking out main and pulling..."
  if ! git checkout main 2>/dev/null; then
    log "ERROR: git checkout main failed — restoring backup"
    restore_backup
    return 1
  fi
  if ! git pull --ff-only origin main; then
    log "ERROR: git pull failed — restoring backup"
    restore_backup
    return 1
  fi

  # Check for new env vars added in this update
  detect_new_env_keys "$old_keys_file"
  rm -f "$old_keys_file"

  # Install dependencies
  log "Running pnpm install..."
  if ! pnpm install --frozen-lockfile 2>/dev/null || ! pnpm install; then
    log "ERROR: pnpm install failed — restoring backup"
    restore_backup
    return 1
  fi

  # Build
  log "Running pnpm build..."
  if ! pnpm run build; then
    log "ERROR: build failed — restoring backup"
    restore_backup
    return 1
  fi

  # Restart
  log "Restarting fern process..."
  pm2 restart fern
  log "Update complete"
}

perform_rollback() {
  log "Rollback trigger detected"
  cat "$ROLLBACK_FILE"
  rm -f "$ROLLBACK_FILE"

  cd "$REPO_DIR" || { log "ERROR: Cannot cd to $REPO_DIR"; return 1; }

  if [[ ! -d "$BACKUP_DIR" ]]; then
    log "ERROR: No backup found at $BACKUP_DIR — cannot rollback"
    return 1
  fi

  restore_backup

  # Also reset git to match the backup
  log "Resetting git to previous state..."
  git checkout HEAD -- . 2>/dev/null || true

  log "Restarting fern process..."
  pm2 restart fern
  log "Rollback complete"
}

restore_backup() {
  if [[ -d "$BACKUP_DIR" ]]; then
    log "Restoring dist/ from backup"
    rm -rf dist
    cp -r "$BACKUP_DIR" dist
  else
    log "WARNING: No backup to restore"
  fi
}

main() {
  log "Started (polling every ${POLL_INTERVAL}s, repo: ${REPO_DIR})"

  while true; do
    # Check rollback first (higher priority)
    if [[ -f "$ROLLBACK_FILE" ]]; then
      perform_rollback || log "Rollback failed"
    elif [[ -f "$TRIGGER_FILE" ]]; then
      perform_update || log "Update failed"
    fi

    sleep "$POLL_INTERVAL"
  done
}

main
