import * as vscode from 'vscode';
import * as path from 'path';
import { SnapshotMetadata } from '../types';
import { SnapshotContentProvider } from '../providers/snapshotContentProvider';

export class FileHistorySnapshotItem extends vscode.TreeItem {
  constructor(
    public readonly snapshot: SnapshotMetadata,
    public readonly filePath: string,
    public readonly gitRoot: string
  ) {
    const favorite = snapshot.isFavorite ? '$(star-full) ' : '';
    super(`${favorite}${snapshot.description}`, vscode.TreeItemCollapsibleState.None);

    const date = snapshot.timestamp.toLocaleString();
    this.description = `[${snapshot.branchName}] ${snapshot.id.substring(0, 7)}`;
    this.tooltip = `${snapshot.description}\n${date}\nBranch: ${snapshot.branchName}`;
    this.contextValue = 'fileHistorySnapshot';
    this.iconPath = new vscode.ThemeIcon('git-commit');

    const snapshotUri = SnapshotContentProvider.createUri(snapshot.id, filePath);
    const currentFileUri = vscode.Uri.file(path.join(gitRoot, filePath));

    this.command = {
      command: 'vscode.diff',
      title: 'Compare with Current',
      arguments: [
        snapshotUri,
        currentFileUri,
        `${filePath} (${snapshot.description} vs Current)`,
      ],
    };
  }
}

export class FileHistoryTreeProvider implements vscode.TreeDataProvider<FileHistorySnapshotItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FileHistorySnapshotItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private filePath: string | null = null;
  private gitRoot: string | null = null;
  private snapshots: SnapshotMetadata[] = [];

  setFile(filePath: string, gitRoot: string, snapshots: SnapshotMetadata[]): void {
    this.filePath = filePath;
    this.gitRoot = gitRoot;
    this.snapshots = snapshots;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FileHistorySnapshotItem): vscode.TreeItem {
    return element;
  }

  getChildren(): FileHistorySnapshotItem[] {
    const { filePath, gitRoot, snapshots } = this;
    if (!filePath || !gitRoot) {
      return [];
    }

    return snapshots.map(
      (snapshot) => new FileHistorySnapshotItem(snapshot, filePath, gitRoot)
    );
  }
}
