import simpleGit, { SimpleGit } from 'simple-git';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SnapshotMetadata, ShadowRepoConfig } from '../types';
import { SHADOW_REPO_BASE_PATH, SNAPSHOT_BRANCH_NAME } from '../utils/constants';
import { generateRepoIdentifier } from '../utils/hashUtils';
import { copyFileToShadowRepo, clearDirectory } from '../utils/fileUtils';

export class ShadowGitService {
  private config: ShadowRepoConfig;
  private git: SimpleGit | null = null;

  constructor(remoteUrl: string | null, gitRoot: string) {
    const repoIdentifier = generateRepoIdentifier(remoteUrl, gitRoot);
    this.config = {
      basePath: SHADOW_REPO_BASE_PATH,
      repoIdentifier,
      shadowRepoPath: path.join(SHADOW_REPO_BASE_PATH, repoIdentifier),
    };
  }

  get shadowRepoPath(): string {
    return this.config.shadowRepoPath;
  }

  private getGit = (): SimpleGit => {
    if (!this.git) {
      this.git = simpleGit(this.config.shadowRepoPath);
    }
    return this.git;
  };

  initializeIfNeeded = async (): Promise<void> => {
    try {
      await fs.access(path.join(this.config.shadowRepoPath, '.git'));
    } catch {
      await fs.mkdir(this.config.shadowRepoPath, { recursive: true });
      const git = this.getGit();
      await git.init();
      await git.addConfig('user.email', 'work-checkpoints@local');
      await git.addConfig('user.name', 'Work Checkpoints');
    }
  };

  createSnapshot = async (
    workspacePath: string,
    branchName: string,
    files: string[]
  ): Promise<SnapshotMetadata> => {
    await this.initializeIfNeeded();

    // Clear shadow repo (except .git)
    await clearDirectory(this.config.shadowRepoPath, true);

    // Copy all files to shadow repo
    for (const file of files) {
      await copyFileToShadowRepo(workspacePath, file, this.config.shadowRepoPath);
    }

    // Stage all files
    const git = this.getGit();
    await git.add('.');

    // Create commit with metadata
    const timestamp = new Date();
    const description = this.formatDescription(branchName, timestamp);

    try {
      await git.commit(description, { '--allow-empty': null });
    } catch {
      // If nothing to commit, create an empty commit
      await git.commit(description, { '--allow-empty': null });
    }

    const log = await git.log({ maxCount: 1 });
    const latestCommit = log.latest;

    return {
      id: latestCommit?.hash.substring(0, 7) ?? '',
      branchName,
      timestamp,
      description,
    };
  };

  listSnapshots = async (): Promise<SnapshotMetadata[]> => {
    try {
      await fs.access(path.join(this.config.shadowRepoPath, '.git'));
    } catch {
      return [];
    }

    try {
      const git = this.getGit();
      const log = await git.log({ maxCount: 100 });
      return log.all.map((commit) => this.parseCommitMetadata(commit));
    } catch {
      return [];
    }
  };

  getSnapshotFiles = async (snapshotId: string): Promise<Map<string, Buffer>> => {
    const files = new Map<string, Buffer>();
    const git = this.getGit();

    // Get the file list at that commit
    const fileList = await git.raw(['ls-tree', '-r', '--name-only', snapshotId]);
    const filePaths = fileList.trim().split('\n').filter(Boolean);

    for (const filePath of filePaths) {
      try {
        const content = await git.show([`${snapshotId}:${filePath}`]);
        files.set(filePath, Buffer.from(content, 'utf-8'));
      } catch {
        // Skip files that can't be read (binary, etc.)
      }
    }

    return files;
  };

  deleteSnapshot = async (snapshotId: string): Promise<void> => {
    // Use git rebase to remove the commit
    // This is a simplified version - in practice, we might want to use a different approach
    try {
      const git = this.getGit();
      await git.raw(['rebase', '--onto', `${snapshotId}^`, snapshotId, SNAPSHOT_BRANCH_NAME]);
    } catch {
      // If rebase fails (e.g., it's the first commit), try alternative approach
      // For now, we'll just skip
    }
  };

  private formatDescription = (branchName: string, timestamp: Date): string => {
    const dateStr = timestamp.toISOString().replace('T', ' ').substring(0, 19);
    return `${branchName} @ ${dateStr}`;
  };

  private parseCommitMetadata = (commit: { hash: string; message: string; date: string }): SnapshotMetadata => {
    const message = commit.message;
    const match = message.match(/^(.+) @ (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$/);

    if (match) {
      return {
        id: commit.hash.substring(0, 7),
        branchName: match[1],
        timestamp: new Date(match[2]),
        description: message,
      };
    }

    // Fallback for commits with different format
    return {
      id: commit.hash.substring(0, 7),
      branchName: 'unknown',
      timestamp: new Date(commit.date),
      description: message,
    };
  };
}
