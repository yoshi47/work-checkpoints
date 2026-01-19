# Work Checkpoints

Save and restore work snapshots using a shadow Git repository. Perfect for experimenting with code changes without committing to your main repository.

## Features

- **Save Snapshots**: Capture your current work state at any time
- **Restore Snapshots**: Revert to a previous snapshot with one click
- **Favorites**: Mark important snapshots as favorites to protect them from auto-deletion
- **Auto-Cleanup**: Automatically delete old snapshots based on retention period
- **File-level Operations**: View diffs, restore, or delete individual files
- **Folder Operations**: Restore or delete entire folders
- **Rename Snapshots**: Give meaningful names to your checkpoints
- **Branch Grouping**: Organize snapshots by branch for better management
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

| Command | Description |
|---------|-------------|
| `Work Checkpoints: Save Snapshot` | Save current work state |
| `Work Checkpoints: Restore Snapshot` | Restore from a snapshot |
| `Work Checkpoints: Delete Snapshots` | Delete one or more snapshots |
| `Work Checkpoints: Group by Branch` | Organize snapshots by branch |
| `Work Checkpoints: Flat List` | Display snapshots in a flat list |
| `Work Checkpoints: Show Claude Snapshots` | Show Claude-created snapshots |
| `Work Checkpoints: Hide Claude Snapshots` | Hide Claude-created snapshots |
| `Work Checkpoints: Delete Claude Snapshots` | Delete all Claude-created snapshots |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `work-checkpoints.messageFormat` | `${branch} @ ${date}` | Snapshot message format. Variables: `${branch}`, `${date}` |
| `work-checkpoints.dateFormat` | `yyyy/MM/dd HH:mm:ss` | Date format. Tokens: `yyyy`, `MM`, `dd`, `HH`, `mm`, `ss` |
| `work-checkpoints.showDeleteAllButton` | `true` | Show "Delete All" button in snapshot input panel |
| `work-checkpoints.ignorePatterns` | `[]` | Additional patterns to ignore when creating snapshots (gitignore format) |
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

## Claude Code Plugin

Use the same checkpoint functionality in Claude Code. Automatically creates a checkpoint every time you send a message.

### Installation

```bash
# Add marketplace
/plugin marketplace add kururu6966/work-checkpoints

# Install plugin
/plugin install work-checkpoints@work-checkpoints-plugin
```

### Features

- **Auto-save**: Creates a checkpoint each time you send a prompt
- **Checkpoint restore**: Ability to revert to previous checkpoints
- Shares the same shadow repository with the VSCode extension

### Commands

- `/work-checkpoints:restore-checkpoint` - Restore a checkpoint

## Requirements

- Git must be installed and available in your PATH
- Your workspace must be a Git repository

## License

MIT
