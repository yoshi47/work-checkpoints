import * as vscode from 'vscode';
import * as path from 'path';
import { WorkspaceService } from '../services/workspaceService';
import { ShadowGitService } from '../services/shadowGitService';
import { SnapshotContentProvider } from '../providers/snapshotContentProvider';
import { SnapshotMetadata } from '../types';

export class SnapshotTreeItem extends vscode.TreeItem {
  constructor(
    public readonly snapshot: SnapshotMetadata,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(snapshot.description, collapsibleState);

    this.tooltip = `${snapshot.description}\n\nBranch: ${snapshot.branchName}\nDate: ${snapshot.timestamp.toLocaleString()}`;
    this.description = snapshot.id;
    this.contextValue = 'snapshot';
  }
}

export class SnapshotFileTreeItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly snapshotId: string,
    showPath: boolean = true
  ) {
    super(path.basename(filePath), vscode.TreeItemCollapsibleState.None);

    this.tooltip = filePath;
    this.description = showPath && path.dirname(filePath) !== '.' ? path.dirname(filePath) : '';
    this.contextValue = 'snapshotFile';

    this.iconPath = vscode.ThemeIcon.File;

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
    public readonly childPaths: string[]
  ) {
    super(path.basename(folderPath), vscode.TreeItemCollapsibleState.Expanded);
    this.tooltip = folderPath;
    this.contextValue = 'snapshotFolder';
    this.iconPath = vscode.ThemeIcon.Folder;
  }
}

type TreeItem = SnapshotTreeItem | SnapshotFolderTreeItem | SnapshotFileTreeItem;

const buildTreeItems = (
  filePaths: string[],
  snapshotId: string,
  parentPath: string = ''
): TreeItem[] => {
  const items: TreeItem[] = [];
  const folders = new Map<string, string[]>();
  const files: string[] = [];

  for (const filePath of filePaths) {
    const relativePath = parentPath ? filePath.slice(parentPath.length + 1) : filePath;
    const firstSlash = relativePath.indexOf('/');

    if (firstSlash === -1) {
      files.push(filePath);
    } else {
      const folderName = relativePath.slice(0, firstSlash);
      const folderPath = parentPath ? `${parentPath}/${folderName}` : folderName;
      if (!folders.has(folderPath)) {
        folders.set(folderPath, []);
      }
      folders.get(folderPath)!.push(filePath);
    }
  }

  for (const [folderPath, childPaths] of folders) {
    items.push(new SnapshotFolderTreeItem(folderPath, snapshotId, childPaths));
  }

  for (const filePath of files) {
    items.push(new SnapshotFileTreeItem(filePath, snapshotId, false));
  }

  return items;
};

export class SnapshotTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private shadowGitService: ShadowGitService | null = null;
  private workspaceService: WorkspaceService | null = null;
  private treeViewMode: boolean = false;

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
        const fileNames = await this.shadowGitService.getSnapshotDiffFiles(element.snapshot.id);

        if (this.treeViewMode) {
          return buildTreeItems(fileNames, element.snapshot.id);
        } else {
          return fileNames.map((filePath) => new SnapshotFileTreeItem(filePath, element.snapshot.id, true));
        }
      }

      // フォルダの子要素（ツリーモード時のみ）
      if (element instanceof SnapshotFolderTreeItem) {
        return buildTreeItems(element.childPaths, element.snapshotId, element.folderPath);
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
