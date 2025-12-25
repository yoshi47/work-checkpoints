import * as vscode from 'vscode';
import { WorkspaceService } from '../services/workspaceService';
import { ShadowGitService } from '../services/shadowGitService';
import { SnapshotMetadata } from '../types';

interface SnapshotQuickPickItem extends vscode.QuickPickItem {
  snapshot: SnapshotMetadata;
}

const initializeServices = async (): Promise<{ workspaceService: WorkspaceService; shadowGitService: ShadowGitService } | null> => {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder is open.');
    return null;
  }

  const workspacePath = workspaceFolders[0].uri.fsPath;
  let workspaceService = new WorkspaceService(workspacePath);

  const gitRoot = await workspaceService.getGitRoot();
  if (!gitRoot) {
    vscode.window.showErrorMessage('No Git repository found in workspace.');
    return null;
  }

  workspaceService = new WorkspaceService(gitRoot);
  const remoteUrl = await workspaceService.getRemoteOriginUrl();
  const shadowGitService = new ShadowGitService(remoteUrl, gitRoot);

  return { workspaceService, shadowGitService };
};

export const deleteSnapshots = async (): Promise<void> => {
  const services = await initializeServices();
  if (!services) {
    return;
  }

  const { shadowGitService } = services;
  const snapshots = await shadowGitService.listSnapshots();
  if (snapshots.length === 0) {
    vscode.window.showInformationMessage('No snapshots available.');
    return;
  }

  const items: SnapshotQuickPickItem[] = snapshots.map((snapshot) => ({
    label: snapshot.description,
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
    'Delete'
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

export const deleteClaudeSnapshots = async (): Promise<void> => {
  const services = await initializeServices();
  if (!services) {
    return;
  }

  const { shadowGitService } = services;
  const allSnapshots = await shadowGitService.listSnapshots();
  const renamedIds = await shadowGitService.getRenamedIds();

  // フィルタ: Claude作成かつリネームされていないもの
  const claudeSnapshots = allSnapshots.filter(
    (s) => s.isClaudeCreated && !renamedIds.has(s.id)
  );

  if (claudeSnapshots.length === 0) {
    vscode.window.showInformationMessage('No Claude snapshots to delete.');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete ${claudeSnapshots.length} Claude snapshot(s)? (Renamed snapshots are preserved) This action cannot be undone.`,
    { modal: true },
    'Delete'
  );

  if (confirm !== 'Delete') {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Deleting Claude snapshots...',
      cancellable: false,
    },
    async () => {
      for (const snapshot of claudeSnapshots) {
        await shadowGitService.deleteSnapshot(snapshot.id);
      }

      vscode.window.showInformationMessage(
        `Deleted ${claudeSnapshots.length} Claude snapshot(s).`
      );
    }
  );
};
