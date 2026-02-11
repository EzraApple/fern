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

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] [updater] $*"
}

perform_update() {
  log "Update trigger detected"
  cat "$TRIGGER_FILE"
  rm -f "$TRIGGER_FILE"

  cd "$REPO_DIR" || { log "ERROR: Cannot cd to $REPO_DIR"; return 1; }

  # Backup current dist/
  rm -rf "$BACKUP_DIR"
  if [[ -d dist ]]; then
    log "Backing up dist/ → dist-backup/"
    cp -r dist "$BACKUP_DIR"
  fi

  # Pull
  log "Running git pull origin main..."
  if ! git pull origin main; then
    log "ERROR: git pull failed — restoring backup"
    restore_backup
    return 1
  fi

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
