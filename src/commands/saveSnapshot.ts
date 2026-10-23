import * as vscode from 'vscode';
import { WorkspaceService } from '../services/workspaceService';
import { ShadowGitService } from '../services/shadowGitService';

// コマンドハンドラからワークスペース解決だけを切り離す。拡張ホストのテストでは
// workspaceFolders に依存した経路を再現できない（updateWorkspaceFolders が効かない）ため、
// 保存処理そのものはパスを受け取る形にして直接テストできるようにしている。
export const saveSnapshotInWorkspace = async (
  workspacePath: string,
  customDescription?: string
): Promise<void> => {
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
      const [branchName, remoteUrl] = await Promise.all([
        workspaceService.getCurrentBranch(),
        workspaceService.getRemoteOriginUrl(),
      ]);

      const config = vscode.workspace.getConfiguration('work-checkpoints');
      const messageFormat = config.get<string>('messageFormat');
      const dateFormat = config.get<string>('dateFormat');

      const shadowGitService = new ShadowGitService(remoteUrl, gitRoot);

      try {
        const snapshot = await shadowGitService.createSnapshot(branchName, messageFormat, dateFormat, customDescription);
        vscode.window.showInformationMessage(`Snapshot saved: ${snapshot.description}`);
      } catch (error) {
        if (error instanceof Error && error.message === 'No changes to save') {
          vscode.window.showWarningMessage('No change detected. Snapshot was not created.');
        } else {
          throw error;
        }
      }
    }
  );
};

export const saveSnapshot = async (customDescription?: string): Promise<void> => {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder is open.');
    return;
  }

  await saveSnapshotInWorkspace(workspaceFolders[0].uri.fsPath, customDescription);
};
