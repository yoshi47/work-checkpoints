import * as vscode from 'vscode';
import { WorkspaceService } from '../services/workspaceService';
import { ShadowGitService } from '../services/shadowGitService';
import { SnapshotMetadata } from '../types';

interface SnapshotQuickPickItem extends vscode.QuickPickItem {
  snapshot: SnapshotMetadata;
}

export const deleteSnapshots = async (): Promise<void> => {
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
    placeHolder: 'Select snapshots to delete',
    canPickMany: true,
  });

  if (!selected || selected.length === 0) {
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete ${selected.length} snapshot(s)? This action cannot be undone.`,
    { modal: true },
    'Delete',
    'Cancel'
  );

  if (confirm !== 'Delete') {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Deleting snapshots...',
      cancellable: false,
    },
    async () => {
      for (const item of selected) {
        await shadowGitService.deleteSnapshot(item.snapshot.id);
      }

      vscode.window.showInformationMessage(
        `Deleted ${selected.length} snapshot(s).`
      );
    }
  );
};
