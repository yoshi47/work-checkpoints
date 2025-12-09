# Change Log

All notable changes to the "work-checkpoints" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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