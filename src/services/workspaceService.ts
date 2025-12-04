import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';
import { createIgnoreFilter, getAllFiles } from '../utils/fileUtils';

export class WorkspaceService {
  private workspacePath: string;
  private git: SimpleGit;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.git = simpleGit(workspacePath);
  }

  getGitRoot = async (): Promise<string | null> => {
    try {
      const root = await this.git.revparse(['--show-toplevel']);
      return root.trim();
    } catch {
      return null;
    }
  };

  getCurrentBranch = async (): Promise<string> => {
    try {
      const status = await this.git.status();
      if (status.current) {
        return status.current;
      }
      // Fallback to rev-parse for detached HEAD
      const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
      return branch.trim() || 'unknown';
    } catch {
      return 'unknown';
    }
  };

  getRemoteOriginUrl = async (): Promise<string | null> => {
    try {
      const remotes = await this.git.getRemotes(true);
      const origin = remotes.find((r) => r.name === 'origin');
      return origin?.refs?.fetch ?? null;
    } catch {
      return null;
    }
  };

  hasUncommittedChanges = async (): Promise<boolean> => {
    try {
      const status = await this.git.status();
      return !status.isClean();
    } catch {
      return false;
    }
  };

  getWorkspaceFiles = async (): Promise<string[]> => {
    const gitRoot = await this.getGitRoot();
    if (!gitRoot) {
      return [];
    }

    const ig = await createIgnoreFilter(gitRoot);
    return getAllFiles(gitRoot, ig);
  };

  getActualGitRoot = async (): Promise<string | null> => {
    try {
      // For worktrees, get the actual main repository path
      const gitDir = await this.git.revparse(['--git-common-dir']);
      const trimmedGitDir = gitDir.trim();

      // If it's a worktree, git-common-dir points to the main repo's .git
      // We need the parent directory of that
      if (trimmedGitDir.endsWith('.git')) {
        return path.dirname(trimmedGitDir);
      }

      // Otherwise, just use the show-toplevel
      return await this.getGitRoot();
    } catch {
      return null;
    }
  };
}
