import * as vscode from 'vscode';
import { WorkspaceService } from '../services/workspaceService';
import { ShadowGitService, WorktreeMismatchError } from '../services/shadowGitService';
import { SnapshotMetadata } from '../types';

interface SnapshotQuickPickItem extends vscode.QuickPickItem {
  snapshot: SnapshotMetadata;
}

// core.worktree の不一致で restore が拒否されたときだけ、追跡先を提示して明示的な確認を取る。
// 拒否の理由は「このスナップショットは別のワークスペースの内容かもしれない」であり、
// 未コミット変更の警告とは別物なので確認を分けている。
export const restoreWithWorktreeGuard = async (
  shadowGitService: ShadowGitService,
  snapshotId: string,
  description: string
): Promise<void> => {
  const run = async (force: boolean): Promise<void> => {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Restoring snapshot...',
        cancellable: false,
      },
      async () => {
        await shadowGitService.restoreSnapshot(snapshotId, force);

        vscode.window.showInformationMessage(`Snapshot restored: ${description}`);
      }
    );
  };

  try {
    await run(false);
  } catch (error) {
    if (!(error instanceof WorktreeMismatchError)) {
      throw error;
    }

    const tracked = error.trackedPath;
    const confirm = await vscode.window.showWarningMessage(
      `This checkpoint repository last tracked a different workspace (${tracked}). ` +
        'Its snapshots may contain that workspace\'s files, and restoring will overwrite this workspace with them.',
      { modal: true },
      'Restore Anyway'
    );

    if (confirm !== 'Restore Anyway') {
      return;
    }

    await run(true);
  }
};

export const restoreSnapshot = async (): Promise<void> => {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder is open.');
    return;
  }

  const workspacePath = workspaceFolders[0].uri.fsPath;
  let workspaceService = new WorkspaceService(workspacePath);

  const gitRoot = await workspaceService.getGitRoot();
  if (!gitRoot) {
    vscode.window.showErrorMessage('No Git repository found in workspace.');
    return;
  }

  // Re-initialize with git root to ensure correct git operations
  workspaceService = new WorkspaceService(gitRoot);

  const remoteUrl = await workspaceService.getRemoteOriginUrl();
  const shadowGitService = new ShadowGitService(remoteUrl, gitRoot);

  const snapshots = await shadowGitService.listSnapshots();
  if (snapshots.length === 0) {
    vscode.window.showInformationMessage('No snapshots available.');
    return;
  }

  const items: SnapshotQuickPickItem[] = snapshots.map((snapshot) => ({
    label: snapshot.description,
    detail: `ID: ${snapshot.id}`,
    snapshot,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a snapshot to restore',
    matchOnDetail: true,
  });

  if (!selected) {
    return;
  }

  // Check for uncommitted changes
  const hasChanges = await workspaceService.hasUncommittedChanges();
  if (hasChanges) {
    const confirm = await vscode.window.showWarningMessage(
      'You have uncommitted changes. Restoring will overwrite your current work.',
      { modal: true },
      'Restore Anyway'
    );

    if (confirm !== 'Restore Anyway') {
      return;
    }
  }

  await restoreWithWorktreeGuard(
    shadowGitService,
    selected.snapshot.id,
    selected.snapshot.description
  );
};
