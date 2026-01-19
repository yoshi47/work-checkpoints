# Change Log

All notable changes to the "work-checkpoints" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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