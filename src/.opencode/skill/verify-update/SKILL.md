---
name: verify-update
description: Post-restart verification after a deployment. Run health checks, notify user of success or failure, trigger rollback if broken, and open a fix PR after rollback.
---

# Verify Update

You are resuming after a production deployment restart. Verify everything works.

## Context

Your continuation prompt includes:
- Elapsed time since you triggered the update (typically 30-90s)
- Before/after SHA and commit list
- Current git SHA (what's actually running)

## Steps

### 1. Self-Checks

Run these using your own tools. **Errors are your diagnostics** — they give you context for fix PRs if rollback is needed.

```
# Verify git state matches expected SHA
bash: git rev-parse HEAD

# Verify build output exists and is recent
bash: ls -la dist/index.js

# Basic tool execution
echo: "health check"

# Memory system
memory_search: query="test" limit=1

# Scheduler
schedule_list: limit=1
```

If ANY check returns an error, go to the Failure path.

### 2. Success Path

All checks passed:
- Use `send_message` to notify user: "Deploy complete. N commits live. All checks passed."
- Use `memory_write` with type `learning` to record: "Deployed commits [SHAs] on [date]. Changes: [summary]. All checks passed."
- Done.

### 3. Failure Path

A check failed:
- Call `trigger_rollback` with the exact error message from the failed check
- Your session will be interrupted by the rollback restart

### 4. Post-Rollback Path

If you're resumed after a rollback (the continuation prompt will say so):
- Use `send_message` to notify user: "Deploy failed and rolled back. Issue: [error]. Opening fix PR."
- Use the normal self-improvement workflow to open a fix PR:
  - `github_clone` the repo
  - `github_branch` for the fix
  - Investigate and fix the issue (you have the error context from your earlier checks)
  - Test your fix
  - `github_commit`, `github_push`, `github_pr`
- Use `memory_write` to record the failure and fix PR

## Important

- Don't hot-patch production — ALL fixes go through PR gate
- Let tool errors speak for themselves — they ARE your diagnostics
- Rollback first, fix second — don't debug in a broken state
