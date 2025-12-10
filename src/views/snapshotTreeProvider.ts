import * as vscode from 'vscode';
import * as path from 'path';
import { WorkspaceService } from '../services/workspaceService';
import { ShadowGitService } from '../services/shadowGitService';
import { SnapshotContentProvider } from '../providers/snapshotContentProvider';
import { SnapshotMetadata, DiffFileInfo, DiffFileStatus } from '../types';

export class SnapshotTreeItem extends vscode.TreeItem {
  constructor(
    public readonly snapshot: SnapshotMetadata,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(snapshot.description, collapsibleState);

    this.tooltip = `${snapshot.fullMessage || snapshot.description}\nBranch: ${snapshot.branchName}\nDate: ${snapshot.timestamp.toLocaleString()}`;
    this.description = `[${snapshot.branchName}] ${snapshot.id}`;
    this.contextValue = 'snapshot';
  }
}

const formatDiffStats = (insertions: number, deletions: number): string => {
  const parts: string[] = [];
  if (insertions > 0) {
    parts.push(`+${insertions}`);
  }
  if (deletions > 0) {
    parts.push(`-${deletions}`);
  }
  return parts.join(' ');
};

const getStatusColor = (status: DiffFileStatus): vscode.ThemeColor => {
  switch (status) {
    case 'added':
      return new vscode.ThemeColor('gitDecoration.addedResourceForeground');
    case 'deleted':
      return new vscode.ThemeColor('gitDecoration.deletedResourceForeground');
    case 'modified':
    default:
      return new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
  }
};

export class SnapshotFileTreeItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly snapshotId: string,
    showPath: boolean = true,
    public readonly diffInfo?: DiffFileInfo
  ) {
    super(path.basename(filePath), vscode.TreeItemCollapsibleState.None);

    const dirPath = path.dirname(filePath) !== '.' ? path.dirname(filePath) : '';
    const stats = diffInfo ? formatDiffStats(diffInfo.insertions, diffInfo.deletions) : '';

    // description: パス + 変更行数
    const descParts: string[] = [];
    if (showPath && dirPath) {
      descParts.push(dirPath);
    }
    if (stats) {
      descParts.push(stats);
    }
    this.description = descParts.join('  ');

    this.tooltip = `${filePath}${stats ? `\n${stats}` : ''}`;
    this.contextValue = 'snapshotFile';

    // ステータスに応じた色付きアイコン
    if (diffInfo) {
      this.iconPath = new vscode.ThemeIcon('file', getStatusColor(diffInfo.status));
    } else {
      this.iconPath = vscode.ThemeIcon.File;
    }

    this.command = {
      command: 'work-checkpoints.showFileDiff',
      title: 'Show Diff',
      arguments: [this],
    };
  }
}

export class SnapshotFolderTreeItem extends vscode.TreeItem {
  constructor(
    public readonly folderPath: string,
    public readonly snapshotId: string,
    public readonly childPaths: string[],
    public readonly childDiffFiles: DiffFileInfo[]
  ) {
    super(path.basename(folderPath), vscode.TreeItemCollapsibleState.Expanded);
    this.tooltip = folderPath;
    this.contextValue = 'snapshotFolder';
    this.iconPath = vscode.ThemeIcon.Folder;
  }
}

type TreeItem = SnapshotTreeItem | SnapshotFolderTreeItem | SnapshotFileTreeItem;

const buildTreeItems = (
  diffFiles: DiffFileInfo[],
  snapshotId: string,
  parentPath: string = ''
): TreeItem[] => {
  const items: TreeItem[] = [];
  const folders = new Map<string, DiffFileInfo[]>();
  const files: DiffFileInfo[] = [];

  for (const diffFile of diffFiles) {
    const relativePath = parentPath ? diffFile.file.slice(parentPath.length + 1) : diffFile.file;
    const firstSlash = relativePath.indexOf('/');

    if (firstSlash === -1) {
      files.push(diffFile);
    } else {
      const folderName = relativePath.slice(0, firstSlash);
      const folderPath = parentPath ? `${parentPath}/${folderName}` : folderName;
      if (!folders.has(folderPath)) {
        folders.set(folderPath, []);
      }
      folders.get(folderPath)!.push(diffFile);
    }
  }

  for (const [folderPath, childFiles] of folders) {
    items.push(new SnapshotFolderTreeItem(folderPath, snapshotId, childFiles.map((f) => f.file), childFiles));
  }

  for (const diffFile of files) {
    items.push(new SnapshotFileTreeItem(diffFile.file, snapshotId, false, diffFile));
  }

  return items;
};

export class SnapshotTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private shadowGitService: ShadowGitService | null = null;
  private workspaceService: WorkspaceService | null = null;
  private treeViewMode: boolean = true;

  constructor(private readonly snapshotContentProvider: SnapshotContentProvider) {
    this.initializeServices();
  }

  toggleViewMode(): void {
    this.treeViewMode = !this.treeViewMode;
    this._onDidChangeTreeData.fire();
  }

  isTreeViewMode(): boolean {
    return this.treeViewMode;
  }

  private async initializeServices(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return;
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;
    let workspaceService = new WorkspaceService(workspacePath);

    const gitRoot = await workspaceService.getGitRoot();
    if (!gitRoot) {
      return;
    }

    workspaceService = new WorkspaceService(gitRoot);
    this.workspaceService = workspaceService;

    const remoteUrl = await workspaceService.getRemoteOriginUrl();
    this.shadowGitService = new ShadowGitService(remoteUrl, gitRoot);
    this.snapshotContentProvider.setShadowGitService(this.shadowGitService);
  }

  refresh(): void {
    this.initializeServices().then(() => {
      this._onDidChangeTreeData.fire();
    });
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (!this.shadowGitService) {
      await this.initializeServices();
    }

    if (!this.shadowGitService) {
      return [];
    }

    try {
      // スナップショットの子要素
      if (element instanceof SnapshotTreeItem) {
        const diffFiles = await this.shadowGitService.getSnapshotDiffFiles(element.snapshot.id);

        if (this.treeViewMode) {
          return buildTreeItems(diffFiles, element.snapshot.id);
        } else {
          return diffFiles.map((diffFile) => new SnapshotFileTreeItem(diffFile.file, element.snapshot.id, true, diffFile));
        }
      }

      // フォルダの子要素（ツリーモード時のみ）
      if (element instanceof SnapshotFolderTreeItem) {
        return buildTreeItems(element.childDiffFiles, element.snapshotId, element.folderPath);
      }

      // スナップショット一覧を返す（ルート）
      const snapshots = await this.shadowGitService.listSnapshots();
      return snapshots.map(
        (snapshot) => new SnapshotTreeItem(snapshot, vscode.TreeItemCollapsibleState.Collapsed)
      );
    } catch {
      return [];
    }
  }

  getShadowGitService(): ShadowGitService | null {
    return this.shadowGitService;
  }

  getWorkspaceService(): WorkspaceService | null {
    return this.workspaceService;
  }
}
