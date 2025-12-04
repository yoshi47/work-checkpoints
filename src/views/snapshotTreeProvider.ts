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

    this.tooltip = `ID: ${snapshot.id}\nBranch: ${snapshot.branchName}\nDate: ${snapshot.timestamp.toLocaleString()}`;
    this.description = snapshot.id;
    this.contextValue = 'snapshot';
  }
}

export class SnapshotFileTreeItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly snapshotId: string
  ) {
    super(path.basename(filePath), vscode.TreeItemCollapsibleState.None);

    this.tooltip = filePath;
    this.description = path.dirname(filePath) === '.' ? '' : path.dirname(filePath);
    this.contextValue = 'snapshotFile';

    this.iconPath = vscode.ThemeIcon.File;

    this.command = {
      command: 'work-checkpoints.showFileDiff',
      title: 'Show Diff',
      arguments: [this],
    };
  }
}

type TreeItem = SnapshotTreeItem | SnapshotFileTreeItem;

export class SnapshotTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private shadowGitService: ShadowGitService | null = null;
  private workspaceService: WorkspaceService | null = null;

  constructor(private readonly snapshotContentProvider: SnapshotContentProvider) {
    this.initializeServices();
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
      // ファイル一覧を返す（スナップショットの子要素）
      if (element instanceof SnapshotTreeItem) {
        const fileNames = await this.shadowGitService.getSnapshotFileNames(element.snapshot.id);
        return fileNames.map((filePath) => new SnapshotFileTreeItem(filePath, element.snapshot.id));
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
