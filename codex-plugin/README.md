# work-checkpoints — Codex CLI plugin

[Work Checkpoints](../README.md) integration for OpenAI's [Codex CLI](https://developers.openai.com/codex/). Saves a snapshot of your workspace into a shared shadow Git repository every time you submit a prompt.

Shares the same `~/.work-checkpoints/<repo-id>/` storage as the VSCode extension, the Claude Code plugin, and the OpenCode plugin — so checkpoints from any client show up in all the others.

## Requirements

- A version of Codex CLI with plugin and hook support (verified on 0.149.1)
- `[features] hooks = true` in `~/.codex/config.toml`
- `git`, `bash`, `shasum`, and either `jq` or `python3` (already present on most macOS / Linux setups)

## Installation

```bash
# Register this repository as a plugin marketplace
codex plugin marketplace add yoshi47/work-checkpoints
# ...or point at a local clone
codex plugin marketplace add /path/to/work-checkpoints

codex plugin add work-checkpoints@work-checkpoints-plugin
```

Then **start Codex interactively once and approve the hook**. Newly installed plugin hooks stay dormant until you review them — Codex shows a "Hooks need review" prompt, and until you accept it the checkpoint hook is silently skipped (including in `codex exec`). Approval is recorded as a `trusted_hash` under `[hooks.state]` in `~/.codex/config.toml`.

Verify with:

```bash
codex plugin list   # work-checkpoints@work-checkpoints-plugin → installed, enabled
```

### Migrating from the manual install

Earlier versions were installed by copying scripts into `~/.codex/hooks/work-checkpoints/` and declaring the hook by hand. **Install the plugin first, confirm it works, and only then remove the old copy** — the reverse order leaves you with no checkpoints at all if you forget a step, and the overlap is harmless (see below).

```bash
# 1. install as above, and approve the hook in an interactive session
# 2. confirm a new "[Codex] ..." commit appears (see Troubleshooting for the shadow repo path)
# 3. remove the old install
rm -rf ~/.codex/hooks/work-checkpoints
#    ...and delete the work-checkpoints UserPromptSubmit entry from
#    ~/.codex/hooks.json or from the [[hooks.UserPromptSubmit]] tables in ~/.codex/config.toml
```

Running both at once does not double-commit: `save-checkpoint.sh` serializes concurrent invocations with a `mkdir` lock, the second one falls out on the 5-second debounce, and even past that window it exits without committing because `git add -A` stages nothing.

### Updating

`codex plugin add` copies the plugin into `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`; it does not run from your working tree. After changing anything under `codex-plugin/`, reinstall:

```bash
codex plugin remove work-checkpoints@work-checkpoints-plugin
codex plugin add work-checkpoints@work-checkpoints-plugin
```

## How it works

- On every `UserPromptSubmit`, `save-checkpoint.sh` calculates the shadow repo path (`~/.work-checkpoints/<sha256(remote URL or workspace)[0:12]>/`) and forks a background git commit. The foreground portion is intentionally minimal so prompt submission is not blocked.
- Commit message format: `[Codex] <branch> @ <timestamp>` (timestamp uses the `dateFormat` from the shared `config.json` if present).
- Debounce: commits within 5 seconds of the previous one are skipped.
- Concurrency: `mkdir`-based lock with a 60-second stale-lock recovery, identical to the Claude Code plugin.
- Auto-cleanup: same retention logic as the other plugins, controlled by `WORK_CHECKPOINTS_RETENTION_DAYS` env var or `retentionDays` in `config.json`.

## Skills

The plugin ships two skills that Codex can invoke by name:

| Skill | Purpose |
|---|---|
| `restore-checkpoint` | List checkpoints and restore the workspace to the one you pick. |
| `delete-checkpoints` | List checkpoints and soft-delete by ID, by `[Codex]` prefix, by age, or all. |

Codex plugins have no slash-command capability, so these are skills rather than commands (the Claude Code plugin ships the same two as `/restore-checkpoint` and `/delete-checkpoints`).

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
- Hook not firing? In order: confirm `[features] hooks = true` in `~/.codex/config.toml`; confirm `codex plugin list` shows the plugin as installed and enabled; confirm you approved the hook in an interactive session (look for a `[hooks.state]` entry mentioning `work-checkpoints`); confirm no stale entry still points at `~/.codex/hooks/work-checkpoints/`.
- See the [Codex hooks docs](https://developers.openai.com/codex/hooks) for the broader hook system.
