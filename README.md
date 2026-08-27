# Work Checkpoints

Save and restore work snapshots using a shadow Git repository. Perfect for experimenting with code changes without committing to your main repository.

Works with **VSCode**, **[Claude Code](#claude-code-plugin)**, **[OpenCode](#opencode-plugin)**, and **[Codex CLI](#codex-cli-plugin)**.

## Features

- **Save Snapshots**: Capture your current work state at any time
- **Restore Snapshots**: Revert to a previous snapshot with one click
- **Commit Diff Mode**: Compare changes between consecutive snapshots
- **Favorites**: Mark important snapshots as favorites to protect them from auto-deletion
- **Auto-Cleanup**: Automatically delete old snapshots based on retention period
- **File-level Operations**: View diffs, restore, or delete individual files
- **Folder Operations**: Restore or delete entire folders
- **Tree/List View Toggle**: Switch between tree and flat file display
- **Rename Snapshots**: Give meaningful names to your checkpoints
- **Branch Grouping**: Organize snapshots by branch for better management
- **File History**: Browse checkpoint history for individual files with diff comparison
- **Claude Snapshot Management**: Toggle visibility and delete Claude-created snapshots individually
- **Activity Bar Integration**: Quick access from the sidebar
- **Command Palette Support**: All commands available via `Cmd+Shift+P`

## Usage

### Save a Snapshot

1. Click the **+** button in the Work Checkpoints view, or
2. Run `Work Checkpoints: Save Snapshot` from the Command Palette

### Restore a Snapshot

1. Hover over a snapshot and click the **Restore** button, or
2. Run `Work Checkpoints: Restore Snapshot` from the Command Palette

### View File Diff

Click on any file within a snapshot to see the diff between the snapshot version and your current file.

Use the **Show Commit Changes** / **Compare with Current** toggle in the Snapshots or File History panel toolbar to switch between:
- **Compare with Current** (default): Diff between the snapshot and your current working state
- **Commit Diff Mode**: Diff between consecutive snapshots, showing what changed in each snapshot

The toggle applies to file diffs in both panels.

### File/Folder Operations

Hover over a file or folder in a snapshot to restore or delete it.

### Rename a Snapshot

Right-click on a snapshot and select **Rename** to give it a meaningful name.

### Organize by Branch

Use the **Group by Branch** command to organize snapshots by branch. Switch back to flat list view with **Flat List** command.

### Mark Favorites

Click the star icon on a snapshot to mark it as a favorite. Favorite snapshots are:
- Displayed at the top of the list
- Protected from auto-deletion
- Clearly indicated with a filled star icon

### Manage Claude Snapshots

- Use **Show/Hide Claude Snapshots** to toggle visibility of Claude-created snapshots
- Use **Delete Claude Snapshots** to remove all Claude-created snapshots (renamed snapshots are protected)

## Commands

### Command Palette

| Command | Description |
|---------|-------------|
| `Work Checkpoints: Save Snapshot` | Save current work state |
| `Work Checkpoints: Save Snapshot with Description` | Save current work state with a custom description |
| `Work Checkpoints: Restore Snapshot` | Restore from a snapshot |
| `Work Checkpoints: Delete Snapshots` | Delete one or more snapshots |
| `Work Checkpoints: Show File History` | Show checkpoint history for the current file |

### Toolbar Actions

These actions are available from the panel toolbar buttons, not the Command Palette.

| Action | Description |
|--------|-------------|
| `Group by Branch` | Organize snapshots by branch |
| `Flat List` | Display snapshots in a flat list |
| `Show Claude Snapshots` | Show Claude-created snapshots |
| `Hide Claude Snapshots` | Hide Claude-created snapshots |
| `Delete Claude Snapshots` | Delete all Claude-created snapshots |
| `Delete All Snapshots` | Delete all snapshots |
| `Show Commit Changes` | Switch to commit diff mode |
| `Compare with Current` | Switch to diff-with-current mode |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `work-checkpoints.messageFormat` | `${branch} @ ${date}` | Snapshot message format. Variables: `${branch}`, `${date}` |
| `work-checkpoints.dateFormat` | `yyyy/MM/dd HH:mm:ss` | Date format. Tokens: `yyyy`, `MM`, `dd`, `HH`, `mm`, `ss` |
| `work-checkpoints.showDeleteAllButton` | `true` | Show "Delete All" button in snapshot input panel |
| `work-checkpoints.ignorePatterns` | `[]` | Additional patterns to ignore when creating snapshots (gitignore format) |
| `work-checkpoints.showSettingsButton` | `false` | Show "Open Settings" button in Snapshots panel toolbar |
| `work-checkpoints.retentionDays` | `0` | Number of days to keep snapshots before auto-deletion. Set to 0 to disable auto-deletion. Favorites are always excluded. |

### Examples

```json
{
  "work-checkpoints.messageFormat": "[${branch}] ${date}",
  "work-checkpoints.dateFormat": "yyyy-MM-dd HH:mm"
}
```

Result: `[main] 2025-12-04 19:30`

```json
{
  "work-checkpoints.dateFormat": "MM/dd HH:mm"
}
```

Result: `main @ 12/04 19:30`

## How It Works

Work Checkpoints creates a separate "shadow" Git repository to store your snapshots. This keeps your main repository clean while allowing you to save and restore work states freely.

- Snapshots are stored in `~/.work-checkpoints/`
- Each project has its own shadow repository
- Your main Git history is never affected
- `core.fsmonitor` and `core.untrackedcache` are explicitly disabled in the shadow repository.
  They cache "what changed since last time" against a watcher bound to one directory, which does not
  survive the shadow repository being re-pointed at another workspace — the result is a snapshot that
  silently omits files. Disabling them makes a scan slower but complete.

## Claude Code Plugin

Use the same checkpoint functionality in Claude Code. Automatically creates a checkpoint every time you send a message.

### Installation

```bash
# Add marketplace
/plugin marketplace add yoshi47/work-checkpoints

# Install plugin
/plugin install work-checkpoints@work-checkpoints-plugin
```

### How It Works

- Uses the `UserPromptSubmit` hook to automatically save a checkpoint each time you send a prompt
- Checkpoints are stored in the same shadow Git repository as the VSCode extension (`~/.work-checkpoints/`)
- Commit messages follow the format: `[Claude] <branch> @ <timestamp>`

### Features

- **Auto-save**: Creates a checkpoint each time you send a prompt
- **Checkpoint restore**: Revert to previous checkpoints
- Shares the same shadow repository as the VSCode extension and the other plugins (OpenCode, Codex CLI)

### Commands

- `/work-checkpoints:restore-checkpoint` — Lists all available checkpoints and lets you select one to restore

### Troubleshooting

Check the log file for errors:

```
~/.work-checkpoints/<repo-id>/checkpoint.log
```

Where `<repo-id>` is a hash derived from the repository's remote URL (or workspace path if no remote is configured).

#### "This checkpoint repository last tracked a different workspace"

A shadow repository points at exactly one workspace via `core.worktree`, and that binding is rewritten by
whichever client saved last. If you use several clones — or several `git worktree` checkouts — of the same
repository, they currently share one shadow repository, so its history may hold snapshots taken in a
*different* workspace. Restoring one of those would overwrite your current workspace with that other
workspace's files, so restore refuses instead.

```bash
# what does this shadow repository actually contain?
git -C ~/.work-checkpoints/<repo-id> log --oneline

# throw the mixed history away (soft delete — recorded in .deleted, objects are kept until gc)
delete-checkpoints.sh --all

# restore anyway, knowing the files may come from another workspace
WORK_CHECKPOINTS_FORCE_WORKTREE=1 restore-checkpoint.sh <checkpoint-id>
```

To find which workspace a shadow repository is bound to:

```bash
git -C ~/.work-checkpoints/<repo-id> config --get core.worktree
```

## OpenCode Plugin

Use the same checkpoint functionality in [OpenCode](https://opencode.ai/). Automatically creates a checkpoint every time you send a message.

### Installation

Copy the plugin file to your OpenCode plugin directory:

```bash
# Global (all projects)
cp opencode-plugin/work-checkpoints.ts ~/.config/opencode/plugin/

# Project-local
cp opencode-plugin/work-checkpoints.ts .opencode/plugin/
```

### Features

- **Auto-save**: Creates a checkpoint each time you send a message (`chat.message` hook)
- **List checkpoints**: `list_checkpoints` tool to view all saved checkpoints
- **Restore checkpoints**: `restore_checkpoint` tool to revert to a previous state
- Shares the same shadow repository as the VSCode extension and the other plugins (Claude Code, Codex CLI)
- Git lock waiting and retry logic for stability

### Requirements

- [Bun](https://bun.sh/) runtime (used by OpenCode)
- `@opencode-ai/plugin` package (installed in your OpenCode config directory)

## Codex CLI Plugin

Use the same checkpoint functionality in OpenAI's [Codex CLI](https://developers.openai.com/codex/). Automatically creates a checkpoint every time you submit a prompt.

### Installation

```bash
codex plugin marketplace add yoshi47/work-checkpoints
codex plugin add work-checkpoints@work-checkpoints-plugin
```

Then start Codex interactively once and approve the hook when it asks — newly installed plugin hooks stay dormant until reviewed.

Already using the old manual-copy install? See the migration steps in [`codex-plugin/README.md`](codex-plugin/README.md#migrating-from-the-manual-install).

### Requirements

- A Codex CLI version with plugin and hook support (verified on 0.149.1)
- `[features] hooks = true` in `~/.codex/config.toml`

### How It Works

- Uses the `UserPromptSubmit` hook to save a checkpoint on each prompt submission
- Same shadow repository as the VSCode extension and other plugins (`~/.work-checkpoints/`)
- Commit messages follow the format: `[Codex] <branch> @ <timestamp>`
- Ships `restore-checkpoint` / `delete-checkpoints` as skills (Codex plugins have no slash commands)

### Troubleshooting

Same log file as the other plugins:

```
~/.work-checkpoints/<repo-id>/checkpoint.log
```

If hooks don't fire: confirm `[features] hooks = true` in `~/.codex/config.toml`, that `codex plugin list` shows the plugin installed and enabled, and that you approved the hook in an interactive session.

## Requirements

- Git must be installed and available in your PATH
- Your workspace must be a Git repository

## License

MIT
