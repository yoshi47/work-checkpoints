import * as vscode from 'vscode';
import { WorkspaceService } from '../services/workspaceService';
import { ShadowGitService } from '../services/shadowGitService';

export const saveSnapshot = async (): Promise<void> => {
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

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Saving snapshot...',
      cancellable: false,
    },
    async () => {
      const [branchName, remoteUrl, files] = await Promise.all([
        workspaceService.getCurrentBranch(),
        workspaceService.getRemoteOriginUrl(),
        workspaceService.getWorkspaceFiles(),
      ]);

      if (files.length === 0) {
        vscode.window.showWarningMessage('No files to snapshot.');
        return;
      }

      const shadowGitService = new ShadowGitService(remoteUrl, gitRoot);
      const snapshot = await shadowGitService.createSnapshot(gitRoot, branchName, files);

      vscode.window.showInformationMessage(
        `Snapshot saved: ${snapshot.description} (${files.length} files)`
      );
    }
  );
};
