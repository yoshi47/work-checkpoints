# Change Log

All notable changes to the "work-checkpoints" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.3.1] - 2026-08-20

### Fixed
- Restoring a checkpoint could overwrite a **different** workspace. A shadow repository is bound to one
  workspace through `core.worktree`, and every client rewrites that binding on save — so with several
  `git worktree` checkouts (or several clones) of one repository, `restore-checkpoint.sh` checked out into
  whichever workspace happened to save last. Restore now verifies the binding and refuses on a mismatch;
  `WORK_CHECKPOINTS_FORCE_WORKTREE=1` overrides it. The VS Code extension shows a modal confirmation
  instead, and performs its check *before* re-pointing `core.worktree` (previously it would have rewritten
  the evidence and then `clean -fd` + `reset --hard` the workspace).
- Snapshots could silently omit most of the changed files. `core.fsmonitor` caches "what changed since
  last time" against a watcher bound to one directory; once the shadow repository was re-pointed at another
  workspace the cached token became meaningless and `git add -A` staged almost nothing, with no log entry.
  Measured on a real repository: `git status` reported 0 changed files with fsmonitor enabled versus 548
  with it disabled. The shadow repository now sets `core.fsmonitor=false` and `core.untrackedcache=false`
  explicitly (a plain `--unset` is not enough — the value is inherited from the user's global config, and
  an unset `core.untrackedCache` means *keep*) and drops the corresponding index extensions. Existing
  shadow repositories are repaired once, on first use, by any client.
- `restore-checkpoint.sh` reported success while doing nothing when `core.worktree` was unset: the
  checkout landed inside the shadow repository itself and the workspace was untouched. It now binds the
  repository to the current workspace first.
- A failed `--force` re-bind is no longer ignored. Previously `git config core.worktree` could fail (it
  takes a lock, and the VS Code extension does not participate in the plugins' mutex) and the checkout
  would then still run against the stale binding — overwriting another workspace while printing
  "Successfully restored checkpoint".

### Added
- The save hook now logs a warning when `git add -A` stages nothing while the workspace has changed
  files. That combination is what the fsmonitor bug looked like from the outside, and it previously
  exited silently — which is why it went unnoticed for weeks.
- Restore refusals are recorded in `checkpoint.log`; previously only successful restores were.

### Changed
- The Claude Code and Codex plugins no longer enable `core.fsmonitor` / `core.untrackedcache` on new
  shadow repositories. Scans are slower on large monorepos but no longer lose files.
- The VS Code extension no longer rewrites `core.worktree` on read-only operations (listing a snapshot's
  changed files, opening a diff). Doing so destroyed the record of which workspace a shadow repository
  belongs to, which the restore check depends on; git now receives the workspace through `GIT_WORK_TREE`
  per invocation instead. Only saving and restoring update the stored binding. (Note for anyone tempted
  by `-c core.worktree=…`: git ignores `core.worktree` from the command line, so that route silently
  keeps using the stored value.)
- Bumped `@vscode/test-electron` to 3.x and `@vscode/test-cli` to 0.0.15 — the pinned versions could not
  launch VS Code 1.134, so the test suite did not run at all.

## [1.3.0] - 2026-05-01

### Added
- Codex CLI plugin (`codex-plugin/`) — UserPromptSubmit hook integration that saves checkpoints to the shared shadow repository, with `[Codex]` commit prefix
- Codex-specific delete mode (`delete-checkpoints.sh --codex`) for bulk-removing Codex-created checkpoints
- `restore-checkpoint.sh` now records each restore operation to `checkpoint.log` for audit trail (Claude Code and Codex plugins)

### Fixed
- Commit message template `${branch} @ ${date}` was not substituted correctly when no `messageFormat` was configured, producing broken `[Claude] ${branch @ ...}` titles (Claude Code and Codex plugins)
- `restore-checkpoint.sh` now acquires the same `mkdir`-based lock used by `save-checkpoint.sh`, preventing `index.lock` collisions and partial restores when a save runs in parallel
- Save hook now verifies `checkpoint.log` is writable on startup; if not, it falls back to `~/.work-checkpoints-error` (and finally stderr) instead of silently swallowing every subsequent failure
- Save hook now detects a corrupted shadow repository (existing `.git` directory but `git log` fails) and exits cleanly with a diagnostic message, instead of treating it as "no previous commit" and looping into more failures

## [1.2.0] - 2026-04-23

### Added
- Config file sync: VS Code settings (`messageFormat`, `dateFormat`, `ignorePatterns`, `retentionDays`) are now synced to `config.json` in the shadow repository for CLI consumers (Claude Code plugin, OpenCode plugin)
- Customizable message format and date format support in CLI tools via shared config
- strftime-style date format conversion (`yyyy/MM/dd` → `%Y/%m/%d`) for CLI compatibility

### Changed
- Automatic exclude pattern refresh when `ignorePatterns` setting changes
- Retention days setting is now read from `config.json` for unified config management across VS Code extension and CLI

### Security
- Bumped lodash to 4.18.1 (dependabot)
- Bumped npm_and_yarn group dependencies (dependabot)

## [1.1.0] - 2026-03-26

### Added
- Checkpoint delete command for Claude Code plugin (`delete-checkpoints`)
- Auto-cleanup implementation for expired snapshots in Claude plugin scripts

### Changed
- Background checkpoint saving for improved performance
- Enhanced lock mechanism for more reliable concurrent Git operations
- Updated documentation to reflect new features and UI improvements
- Simplified plugin name for clarity

### Security
- Bumped flatted in the npm_and_yarn group

## [1.0.4] - 2026-03-20

### Changed
- Unified version across package.json and .claude-plugin/marketplace.json to 1.0.4
- Updated owner information and simplified plugin name
- Improved checkpoint save script: removed stderr redirect, use stdin for commit messages

### Security
- Bumped undici to address vulnerability (dependabot)
- Bumped npm_and_yarn group dependencies

## [0.8.0] - 2026-03-08

### Added
- File history view to browse checkpoint history for individual files
- Context menu command to show file history from the editor
- Diff display between snapshots for comparing changes over time

### Fixed
- Excluded opencode-plugin from TypeScript compilation

## [0.7.0] - 2026-02-13

### Added
- OpenCode plugin for checkpoint functionality in [OpenCode](https://opencode.ai/)
  - Auto-save snapshots on each message (`chat.message` hook)
  - `list_checkpoints` and `restore_checkpoint` tools
  - Shares the same shadow repository with VSCode extension and Claude Code plugin
  - Git lock waiting and retry logic for stability

## [0.6.1] - 2026-01-29

### Fixed
- Enhanced Git lock file handling in save-checkpoint.sh hook
- Added automatic cleanup of stale lock files (older than 60 seconds)
- Improved retry mechanism for Git operations with better error handling
- Added trap for EXIT and ERR to prevent blocking user operations
- Added logging to checkpoint.log for debugging Git operation failures

## [0.6.0] - 2026-01-19

### Added
- Favorites feature for snapshots with star icons
- Auto-cleanup service with configurable retention period (`work-checkpoints.retentionDays` setting)
- Favorite snapshots are protected from auto-deletion and displayed at the top of the list
- Toggle favorite and remove favorite commands in snapshot context menu
- Comprehensive tests for favorites and auto-cleanup functionality

### Fixed
- Enhanced Git operation robustness with retry mechanism for lock conflicts
- Improved file and folder restoration with error handling and progress display
- Optimized Git configuration (reduced maxConcurrentProcesses to prevent lock conflicts, added timeout)
- Better file path handling for spaces and special characters using null-terminated strings

## [0.5.3] - 2026-01-19

### Changed
- Removed VS Code extension template quickstart guide documentation

## [0.5.2] - 2026-01-16

### Changed
- Added marketplace version field to Claude plugin configuration
- Added required marketplace.json fields for discover visibility
- Updated Claude plugin marketplace.json to version 1.0.2
- Organized Claude plugin configuration files

## [0.5.1] - 2026-01-16

### Changed
- Simplified Claude plugin config file paths by removing unnecessary parent directory references

## [0.5.0] - 2025-12-25

### Added
- Branch grouping display feature to organize snapshots by branch
- Toggle visibility for Claude-created snapshots
- Individual delete functionality for Claude-created snapshots (renamed snapshots are protected)

### Fixed
- Fixed icon assignments for view and grouping commands (tree/list view and group/flat list icons were swapped)

## [0.4.1] - 2025-12-16

### Fixed
- Fixed `git clean` command arguments to match library's expected format

### Changed
- Added comprehensive tests for snapshot restore functionality

## [0.4.0] - 2025-12-10

### Added
- Open Settings command to quickly access extension settings
- Full description display for snapshots (expandable)

### Fixed
- Removed `[Claude]` prefix from branch names in snapshot descriptions

## [0.3.0] - 2025-12-09

### Added
- Configurable ignore patterns for snapshot creation (`work-checkpoints.ignorePatterns` setting)
- Branch name in snapshot description

### Changed
- Enhanced snapshot diff display with detailed file change information
- Improved snapshot diff retrieval method

## [0.2.3] - 2025-12-09

### Fixed
- Ensure branch name extraction for custom snapshot descriptions

## [0.2.2] - 2025-12-09

### Changed
- Expanded ignore patterns for development and CI folders in `.vscodeignore`

## [0.2.1] - 2025-12-09

### Added
- SCM category and keywords for better discoverability in VS Code marketplace
- File change tracking when creating snapshots

### Fixed
- Claude Code plugin: Fixed invalid manifest paths (hooks/commands must start with `./`)

## [0.2.0] - 2025-12-09

### Added
- Claude Code plugin integration for auto-saving checkpoints
- `/work-checkpoints:restore-checkpoint` command for Claude Code

### Changed
- Updated README with Claude Code plugin installation instructions

### Fixed
- Claude Code plugin: Fixed invalid manifest paths (hooks/commands must start with `./`)

## [0.1.0] - 2025-12-04

### Added
- Initial release
- Save and restore work snapshots using shadow Git repository
- File-level operations (view diff, restore, delete)
- Folder operations (restore, delete)
- Rename snapshots
- Activity Bar integration
- Command Palette support
- Configurable message and date formats