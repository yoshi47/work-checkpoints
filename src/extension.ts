import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { saveSnapshot } from './commands/saveSnapshot';
import { restoreSnapshot } from './commands/restoreSnapshot';
import { deleteSnapshots } from './commands/deleteSnapshots';
import { SnapshotTreeProvider, SnapshotTreeItem, SnapshotFileTreeItem } from './views/snapshotTreeProvider';
import { SnapshotContentProvider } from './providers/snapshotContentProvider';
import { clearDirectory } from './utils/fileUtils';

let snapshotTreeProvider: SnapshotTreeProvider;
let snapshotContentProvider: SnapshotContentProvider;

export const activate = (context: vscode.ExtensionContext) => {
  console.log('Work Checkpoints extension is now active!');

  // Create and register ContentProvider
  snapshotContentProvider = new SnapshotContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      SnapshotContentProvider.scheme,
      snapshotContentProvider
    )
  );

  // Create and register TreeView
  snapshotTreeProvider = new SnapshotTreeProvider(snapshotContentProvider);
  const treeView = vscode.window.createTreeView('workCheckpointsView', {
    treeDataProvider: snapshotTreeProvider,
    showCollapseAll: false,
  });

  // Register commands
  context.subscriptions.push(
    treeView,
    vscode.commands.registerCommand('work-checkpoints.saveSnapshot', async () => {
      await saveSnapshot();
      snapshotTreeProvider.refresh();
    }),
    vscode.commands.registerCommand('work-checkpoints.restoreSnapshot', restoreSnapshot),
    vscode.commands.registerCommand('work-checkpoints.deleteSnapshots', async () => {
      await deleteSnapshots();
      snapshotTreeProvider.refresh();
    }),
    vscode.commands.registerCommand('work-checkpoints.refresh', () => {
      snapshotTreeProvider.refresh();
    }),
    vscode.commands.registerCommand('work-checkpoints.restoreItem', async (item: SnapshotTreeItem) => {
      await restoreSnapshotItem(item);
    }),
    vscode.commands.registerCommand('work-checkpoints.deleteItem', async (item: SnapshotTreeItem) => {
      await deleteSnapshotItem(item);
      snapshotTreeProvider.refresh();
    }),
    vscode.commands.registerCommand('work-checkpoints.showFileDiff', async (item: SnapshotFileTreeItem) => {
      await showFileDiff(item);
    }),
    vscode.commands.registerCommand('work-checkpoints.restoreFileItem', async (item: SnapshotFileTreeItem) => {
      await restoreFileItem(item);
    }),
    vscode.commands.registerCommand('work-checkpoints.deleteFileItem', async (item: SnapshotFileTreeItem) => {
      await deleteFileItem(item);
    }),
    vscode.commands.registerCommand('work-checkpoints.openFileAtRevision', async (item: SnapshotFileTreeItem) => {
      await openFileAtRevision(item);
    })
  );

  // Refresh when workspace changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      snapshotTreeProvider.refresh();
    })
  );
};

const restoreSnapshotItem = async (item: SnapshotTreeItem): Promise<void> => {
  const shadowGitService = snapshotTreeProvider.getShadowGitService();
  const workspaceService = snapshotTreeProvider.getWorkspaceService();

  if (!shadowGitService || !workspaceService) {
    vscode.window.showErrorMessage('No Git repository found in workspace.');
    return;
  }

  const gitRoot = await workspaceService.getGitRoot();
  if (!gitRoot) {
    vscode.window.showErrorMessage('No Git repository found in workspace.');
    return;
  }

  // Check for uncommitted changes
  const hasChanges = await workspaceService.hasUncommittedChanges();
  if (hasChanges) {
    const confirm = await vscode.window.showWarningMessage(
      'You have uncommitted changes. Restoring will overwrite your current work.',
      { modal: true },
      'Restore Anyway',
      'Cancel'
    );

    if (confirm !== 'Restore Anyway') {
      return;
    }
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Restoring snapshot...',
      cancellable: false,
    },
    async () => {
      const files = await shadowGitService.getSnapshotFiles(item.snapshot.id);

      // Clear workspace files (except .git)
      await clearDirectory(gitRoot, true);

      // Restore files from snapshot
      for (const [filePath, content] of files) {
        const fullPath = path.join(gitRoot, filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content);
      }

      vscode.window.showInformationMessage(
        `Snapshot restored: ${item.snapshot.description} (${files.size} files)`
      );
    }
  );
};

const deleteSnapshotItem = async (item: SnapshotTreeItem): Promise<void> => {
  const shadowGitService = snapshotTreeProvider.getShadowGitService();

  if (!shadowGitService) {
    vscode.window.showErrorMessage('No Git repository found in workspace.');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete snapshot "${item.snapshot.description}"? This action cannot be undone.`,
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
      title: 'Deleting snapshot...',
      cancellable: false,
    },
    async () => {
      await shadowGitService.deleteSnapshot(item.snapshot.id);
      vscode.window.showInformationMessage('Snapshot deleted.');
    }
  );
};

const showFileDiff = async (item: SnapshotFileTreeItem): Promise<void> => {
  const workspaceService = snapshotTreeProvider.getWorkspaceService();

  if (!workspaceService) {
    vscode.window.showErrorMessage('No Git repository found in workspace.');
    return;
  }

  const gitRoot = await workspaceService.getGitRoot();
  if (!gitRoot) {
    vscode.window.showErrorMessage('No Git repository found in workspace.');
    return;
  }

  const snapshotUri = SnapshotContentProvider.createUri(item.snapshotId, item.filePath);
  const currentFileUri = vscode.Uri.file(path.join(gitRoot, item.filePath));

  await vscode.commands.executeCommand(
    'vscode.diff',
    snapshotUri,
    currentFileUri,
    `${item.filePath} (Snapshot vs Current)`
  );
};

const restoreFileItem = async (item: SnapshotFileTreeItem): Promise<void> => {
  const shadowGitService = snapshotTreeProvider.getShadowGitService();
  const workspaceService = snapshotTreeProvider.getWorkspaceService();

  if (!shadowGitService || !workspaceService) {
    vscode.window.showErrorMessage('No Git repository found in workspace.');
    return;
  }

  const gitRoot = await workspaceService.getGitRoot();
  if (!gitRoot) {
    vscode.window.showErrorMessage('No Git repository found in workspace.');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Restore "${item.filePath}" from snapshot? This will overwrite the current file.`,
    { modal: true },
    'Restore',
    'Cancel'
  );

  if (confirm !== 'Restore') {
    return;
  }

  const files = await shadowGitService.getSnapshotFiles(item.snapshotId);
  const content = files.get(item.filePath);

  if (!content) {
    vscode.window.showErrorMessage('File not found in snapshot.');
    return;
  }

  const fullPath = path.join(gitRoot, item.filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content);

  vscode.window.showInformationMessage(`File restored: ${item.filePath}`);
};

const deleteFileItem = async (item: SnapshotFileTreeItem): Promise<void> => {
  const workspaceService = snapshotTreeProvider.getWorkspaceService();

  if (!workspaceService) {
    vscode.window.showErrorMessage('No Git repository found in workspace.');
    return;
  }

  const gitRoot = await workspaceService.getGitRoot();
  if (!gitRoot) {
    vscode.window.showErrorMessage('No Git repository found in workspace.');
    return;
  }

  const fullPath = path.join(gitRoot, item.filePath);

  try {
    await fs.access(fullPath);
  } catch {
    vscode.window.showWarningMessage(`File does not exist: ${item.filePath}`);
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete "${item.filePath}" from workspace? This action cannot be undone.`,
    { modal: true },
    'Delete',
    'Cancel'
  );

  if (confirm !== 'Delete') {
    return;
  }

  await fs.unlink(fullPath);
  vscode.window.showInformationMessage(`File deleted: ${item.filePath}`);
};

const openFileAtRevision = async (item: SnapshotFileTreeItem): Promise<void> => {
  const snapshotUri = SnapshotContentProvider.createUri(item.snapshotId, item.filePath);
  const doc = await vscode.workspace.openTextDocument(snapshotUri);
  await vscode.window.showTextDocument(doc, { preview: true });
};

export const deactivate = () => {};
