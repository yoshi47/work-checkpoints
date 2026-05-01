# work-checkpoints — Codex CLI plugin

[Work Checkpoints](../README.md) integration for OpenAI's [Codex CLI](https://developers.openai.com/codex/). Saves a snapshot of your workspace into a shared shadow Git repository every time you submit a prompt.

Shares the same `~/.work-checkpoints/<repo-id>/` storage as the VSCode extension, the Claude Code plugin, and the OpenCode plugin — so checkpoints from any client show up in all the others.

## Requirements

- A version of Codex CLI that supports the `UserPromptSubmit` hook (see the [official hooks docs](https://developers.openai.com/codex/hooks))
- `git`, `bash`, `shasum`, and either `jq` or `python3` (already present on most macOS / Linux setups)

## Installation

### 1. Copy the hook scripts

```bash
mkdir -p ~/.codex/hooks/work-checkpoints
cp scripts/*.sh ~/.codex/hooks/work-checkpoints/
chmod +x ~/.codex/hooks/work-checkpoints/*.sh
```

### 2. Install the hooks definition

Codex auto-loads `~/.codex/hooks.json` (and inline `[hooks]` tables in `~/.codex/config.toml`). Pick **one** representation per layer — Codex warns if both exist in the same layer.

If you don't already have `~/.codex/hooks.json`, copy the bundled file:

```bash
cp hooks/hooks.json ~/.codex/hooks.json
```

If you already have `~/.codex/hooks.json`, merge the `UserPromptSubmit` entry from `hooks/hooks.json` into it manually.

### 3. Enable the feature flag

Codex hooks are currently gated by a feature flag. Open `~/.codex/config.toml` and ensure it contains:

```toml
[features]
codex_hooks = true
```

If a `[features]` table already exists, **add only the `codex_hooks = true` line under it** — do not paste a second `[features]` header (TOML rejects duplicate tables).

`hooks/feature-flag.toml` in this directory contains the same snippet for reference.

### Project-local install (optional)

You can place `hooks.json` and `scripts/` under `<repo>/.codex/` instead. Project-local hooks only run after the project is marked trusted in Codex (untrusted projects still load user/system hooks). See the Codex docs for the trust workflow.

## How it works

- On every `UserPromptSubmit`, `save-checkpoint.sh` calculates the shadow repo path (`~/.work-checkpoints/<sha256(remote URL or workspace)[0:12]>/`) and forks a background git commit. The foreground portion is intentionally minimal so prompt submission is not blocked.
- Commit message format: `[Codex] <branch> @ <timestamp>` (timestamp uses the `dateFormat` from the shared `config.json` if present).
- Debounce: commits within 5 seconds of the previous one are skipped.
- Concurrency: `mkdir`-based lock with a 60-second stale-lock recovery, identical to the Claude Code plugin.
- Auto-cleanup: same retention logic as the other plugins, controlled by `WORK_CHECKPOINTS_RETENTION_DAYS` env var or `retentionDays` in `config.json`.

## Available scripts

| Script | Purpose |
|---|---|
| `save-checkpoint.sh` | Hook handler. Reads stdin JSON, creates a checkpoint commit. |
| `restore-checkpoint.sh <id>` | Restore the workspace to a checkpoint. |
| `list-checkpoints.sh` | List all checkpoints (excluding soft-deleted ones). |
| `delete-checkpoints.sh --ids <id...>` | Soft-delete specific checkpoints. |
| `delete-checkpoints.sh --codex` | Soft-delete every `[Codex]` checkpoint (renamed entries are protected). |
| `delete-checkpoints.sh --older-than <days>` | Soft-delete checkpoints older than N days (favorites are protected). |
| `delete-checkpoints.sh --all` | Soft-delete every checkpoint, regardless of which agent created it. |

The shadow repo is shared across plugins. To bulk-delete `[Claude]`-prefixed checkpoints, use the equivalent script in `claude-plugin/scripts/`.

## Troubleshooting

- Logs: `~/.work-checkpoints/<repo-id>/checkpoint.log`
- Hook not firing? Verify `codex_hooks = true` is set under `[features]` in `~/.codex/config.toml`, and that `~/.codex/hooks.json` actually contains the `UserPromptSubmit` entry.
- See the [Codex hooks docs](https://developers.openai.com/codex/hooks) for the broader hook system.
