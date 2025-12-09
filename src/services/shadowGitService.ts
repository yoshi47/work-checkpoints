import simpleGit, { SimpleGit } from 'simple-git';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SnapshotMetadata, ShadowRepoConfig } from '../types';
import { SHADOW_REPO_BASE_PATH } from '../utils/constants';
import { generateRepoIdentifier } from '../utils/hashUtils';
import { writeExcludePatterns } from '../utils/excludes';

export class ShadowGitService {
  private config: ShadowRepoConfig;
  private git: SimpleGit | null = null;
  private workspacePath: string;

  constructor(remoteUrl: string | null, gitRoot: string) {
    const repoIdentifier = generateRepoIdentifier(remoteUrl, gitRoot);
    this.workspacePath = gitRoot;
    this.config = {
      basePath: SHADOW_REPO_BASE_PATH,
      repoIdentifier,
      shadowRepoPath: path.join(SHADOW_REPO_BASE_PATH, repoIdentifier),
    };
  }

  get shadowRepoPath(): string {
    return this.config.shadowRepoPath;
  }

  private get deletedFilePath(): string {
    return path.join(this.config.shadowRepoPath, '.deleted');
  }

  private get renamedFilePath(): string {
    return path.join(this.config.shadowRepoPath, '.renamed');
  }

  private getGit = (): SimpleGit => {
    if (!this.git) {
      // 環境変数をサニタイズ（Dev Container対応）
      const sanitizedEnv = { ...process.env };
      delete sanitizedEnv.GIT_DIR;
      delete sanitizedEnv.GIT_WORK_TREE;
      delete sanitizedEnv.GIT_INDEX_FILE;
      delete sanitizedEnv.GIT_COMMON_DIR;

      this.git = simpleGit({
        baseDir: this.config.shadowRepoPath,
        binary: 'git',
        maxConcurrentProcesses: 6,
        config: [],
      }).env(sanitizedEnv);
    }
    return this.git;
  };

  private getDeletedIds = async (): Promise<Set<string>> => {
    try {
      const content = await fs.readFile(this.deletedFilePath, 'utf-8');
      return new Set(content.split('\n').filter(Boolean));
    } catch {
      return new Set();
    }
  };

  private addDeletedId = async (id: string): Promise<void> => {
    const deletedIds = await this.getDeletedIds();
    deletedIds.add(id);
    await fs.writeFile(this.deletedFilePath, [...deletedIds].join('\n'));
  };

  private getRenamedMap = async (): Promise<Map<string, string>> => {
    try {
      const content = await fs.readFile(this.renamedFilePath, 'utf-8');
      const map = new Map<string, string>();
      for (const line of content.split('\n').filter(Boolean)) {
        const [id, name] = line.split('\t');
        if (id && name) {
          map.set(id, name);
        }
      }
      return map;
    } catch {
      return new Map();
    }
  };

  private setRenamedMap = async (map: Map<string, string>): Promise<void> => {
    const lines = [...map.entries()].map(([id, name]) => `${id}\t${name}`);
    await fs.writeFile(this.renamedFilePath, lines.join('\n'));
  };

  initializeIfNeeded = async (): Promise<void> => {
    try {
      await fs.access(path.join(this.config.shadowRepoPath, '.git'));

      // 既存のリポジトリがある場合、core.worktree が正しく設定されているか確認
      const git = this.getGit();
      try {
        const currentWorktree = await git.raw(['config', '--get', 'core.worktree']);
        if (currentWorktree.trim() !== this.workspacePath) {
          await git.addConfig('core.worktree', this.workspacePath);
        }
      } catch {
        // core.worktree が設定されていない場合は設定する
        await git.addConfig('core.worktree', this.workspacePath);
      }
    } catch {
      // Shadow repo が存在しない場合は新規作成
      await fs.mkdir(this.config.shadowRepoPath, { recursive: true });
      const git = this.getGit();
      await git.init();

      // core.worktree を設定してワークスペースを直接参照
      await git.addConfig('core.worktree', this.workspacePath);
      await git.addConfig('user.email', 'work-checkpoints@local');
      await git.addConfig('user.name', 'Work Checkpoints');

      // 除外パターンを設定
      await writeExcludePatterns(this.config.shadowRepoPath);
    }
  };

  createSnapshot = async (
    branchName: string,
    messageFormat?: string,
    dateFormat?: string,
    customDescription?: string
  ): Promise<SnapshotMetadata> => {
    await this.initializeIfNeeded();

    const git = this.getGit();

    // git add . で直接ワークスペースをステージング（ファイルコピー不要！）
    await git.add('.');

    // ステージングエリアに変更があるか確認
    const status = await git.status();
    if (status.staged.length === 0) {
      throw new Error('No changes to save');
    }

    // Create commit with metadata
    const timestamp = new Date();
    const description = customDescription || this.formatDescription(branchName, timestamp, messageFormat, dateFormat);

    // Always include branch name as trailer for reliable extraction later
    const commitMessage = customDescription
      ? `${customDescription}\n\nBranch: ${branchName}`
      : description;

    await git.commit(commitMessage);

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
      const deletedIds = await this.getDeletedIds();
      const renamedMap = await this.getRenamedMap();

      return log.all
        .map((commit) => this.parseCommitMetadata(commit))
        .filter((snapshot) => !deletedIds.has(snapshot.id))
        .map((snapshot) => {
          const renamedDescription = renamedMap.get(snapshot.id);
          if (renamedDescription) {
            return { ...snapshot, description: renamedDescription };
          }
          return snapshot;
        });
    } catch {
      return [];
    }
  };

  getSnapshotFileNames = async (snapshotId: string): Promise<string[]> => {
    const git = this.getGit();
    const fileList = await git.raw(['ls-tree', '-r', '--name-only', snapshotId]);
    return fileList.trim().split('\n').filter(Boolean);
  };

  getSnapshotDiffFiles = async (snapshotId: string): Promise<string[]> => {
    const git = this.getGit();
    // スナップショットと現在の作業ディレクトリを比較
    const diff = await git.diffSummary([snapshotId]);
    return diff.files.map((f) => f.file);
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

  getSnapshotFileContent = async (snapshotId: string, filePath: string): Promise<string> => {
    const git = this.getGit();
    try {
      return await git.show([`${snapshotId}:${filePath}`]);
    } catch {
      return '';
    }
  };

  restoreSnapshot = async (snapshotId: string): Promise<void> => {
    await this.initializeIfNeeded();

    const git = this.getGit();

    // 未追跡ファイルを削除し、指定コミットに復元
    await git.clean(['-f', '-d']);
    await git.reset(['--hard', snapshotId]);
  };

  deleteSnapshot = async (snapshotId: string): Promise<void> => {
    await this.addDeletedId(snapshotId);
  };

  renameSnapshot = async (snapshotId: string, newName: string): Promise<void> => {
    const map = await this.getRenamedMap();
    map.set(snapshotId, newName);
    await this.setRenamedMap(map);
  };

  private formatDate = (date: Date, format: string): string => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return format
      .replace('yyyy', date.getFullYear().toString())
      .replace('MM', pad(date.getMonth() + 1))
      .replace('dd', pad(date.getDate()))
      .replace('HH', pad(date.getHours()))
      .replace('mm', pad(date.getMinutes()))
      .replace('ss', pad(date.getSeconds()));
  };

  private formatDescription = (
    branchName: string,
    timestamp: Date,
    messageFormat?: string,
    dateFormat?: string
  ): string => {
    const dateStr = this.formatDate(timestamp, dateFormat || 'yyyy/MM/dd HH:mm:ss');
    const template = messageFormat || '${branch} @ ${date}';
    return template.replace('${branch}', branchName).replace('${date}', dateStr);
  };

  private parseCommitMetadata = (commit: {
    hash: string;
    message: string;
    body: string;
    date: string;
  }): SnapshotMetadata => {
    const message = commit.message;
    const body = commit.body || '';

    // Try to extract branch from body trailer (new format with custom description)
    const trailerMatch = body.match(/^Branch: (.+)$/m);
    if (trailerMatch) {
      return {
        id: commit.hash.substring(0, 7),
        branchName: trailerMatch[1],
        timestamp: new Date(commit.date),
        description: message,
      };
    }

    // Fallback: try old format "${branch} @ ${date}"
    const oldFormatMatch = message.match(/^(.+) @ (.+)$/);
    if (oldFormatMatch) {
      const parsedDate = new Date(oldFormatMatch[2]);
      return {
        id: commit.hash.substring(0, 7),
        branchName: oldFormatMatch[1],
        timestamp: isNaN(parsedDate.getTime()) ? new Date(commit.date) : parsedDate,
        description: message,
      };
    }

    // Final fallback for unknown format
    return {
      id: commit.hash.substring(0, 7),
      branchName: 'unknown',
      timestamp: new Date(commit.date),
      description: message,
    };
  };
}
