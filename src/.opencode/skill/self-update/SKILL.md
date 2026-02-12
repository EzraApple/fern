---
name: self-update
description: Review incoming commits on main and trigger a production deployment. Use when a GitHub webhook push event is received or when asked to deploy changes from main.
---

# Self-Update

You are reviewing commits that were pushed to main and deploying them to production.

## Steps

1. **Review the incoming changes**
   - Run `git fetch origin main` then `git log HEAD..origin/main --oneline` to see what's coming
   - Run `git diff HEAD..origin/main --stat` for a file-level overview
   - For core runtime changes, inspect the actual diff: `git diff HEAD..origin/main -- <file>`

2. **Assess risk**
   - High risk: changes to `src/index.ts`, `src/core/`, `src/memory/db.ts`, `ecosystem.config.cjs`
   - Medium risk: new tools, new features, dependency changes
   - Low risk: docs, tests, config, skills

3. **Notify the user**
   - Use `send_message` with `channel: "whatsapp"`, `to: "<user's phone number>"`, and `content: "<your message>"`
   - Keep it brief: "Deploying N commits to main: <1-line summary>. Back in ~60s."
   - The user's phone number is in your channel context; if not, check your memories

4. **Trigger the update**
   - Call `trigger_update` with a brief reason
   - This is the LAST thing you do — the server will restart after this

## Important

- You are running BEFORE the update — the new code isn't live yet
- Don't modify any code in this phase
- Don't call `trigger_rollback` (that's for post-update verification only)
- After `trigger_update`, your session will be interrupted by the restart and resumed for verification
