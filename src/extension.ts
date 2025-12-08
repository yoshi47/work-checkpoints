import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { saveSnapshot } from './commands/saveSnapshot';
import { restoreSnapshot } from './commands/restoreSnapshot';
import { deleteSnapshots } from './commands/deleteSnapshots';
import { SnapshotTreeProvider, SnapshotTreeItem, SnapshotFileTreeItem } from './views/snapshotTreeProvider';
import { SnapshotInputViewProvider } from './views/snapshotInputViewProvider';
import { SnapshotContentProvider } from './providers/snapshotContentProvider';

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

  // Initialize context for tree view mode
  vscode.commands.executeCommand('setContext', 'workCheckpoints.treeViewMode', false);

  // Register WebView provider for input
  const snapshotInputViewProvider = new SnapshotInputViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SnapshotInputViewProvider.viewType,
      snapshotInputViewProvider
    )
  );

  // Register commands
  context.subscriptions.push(
    treeView,
    vscode.commands.registerCommand('work-checkpoints.saveSnapshot', async () => {
      await saveSnapshot();
      snapshotTreeProvider.refresh();
    }),
    vscode.commands.registerCommand('work-checkpoints.saveSnapshotWithDescription', async (description?: string) => {
      await saveSnapshot(description);
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
    vscode.commands.registerCommand('work-checkpoints.renameItem', async (item: SnapshotTreeItem) => {
      await renameSnapshotItem(item);
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
    }),
    vscode.commands.registerCommand('work-checkpoints.viewAsTree', () => {
      snapshotTreeProvider.toggleViewMode();
      vscode.commands.executeCommand('setContext', 'workCheckpoints.treeViewMode', true);
    }),
    vscode.commands.registerCommand('work-checkpoints.viewAsList', () => {
      snapshotTreeProvider.toggleViewMode();
      vscode.commands.executeCommand('setContext', 'workCheckpoints.treeViewMode', false);
    }),
    vscode.commands.registerCommand('work-checkpoints.deleteAll', async () => {
      await deleteAllSnapshots();
      snapshotTreeProvider.refresh();
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

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Restoring snapshot...',
      cancellable: false,
    },
    async () => {
      await shadowGitService.restoreSnapshot(item.snapshot.id);

      vscode.window.showInformationMessage(
        `Snapshot restored: ${item.snapshot.description}`
      );
    }
  );
};

const renameSnapshotItem = async (item: SnapshotTreeItem): Promise<void> => {
  const shadowGitService = snapshotTreeProvider.getShadowGitService();

  if (!shadowGitService) {
    vscode.window.showErrorMessage('No Git repository found in workspace.');
    return;
  }

  const newName = await vscode.window.showInputBox({
    prompt: 'Enter new name for snapshot',
    value: item.snapshot.description,
  });

  if (!newName) {
    return;
  }

  await shadowGitService.renameSnapshot(item.snapshot.id, newName);
  vscode.window.showInformationMessage(`Snapshot renamed to: ${newName}`);
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
    'Delete'
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

const deleteAllSnapshots = async (): Promise<void> => {
  const shadowGitService = snapshotTreeProvider.getShadowGitService();

  if (!shadowGitService) {
    vscode.window.showErrorMessage('No Git repository found in workspace.');
    return;
  }

  const snapshots = await shadowGitService.listSnapshots();
  if (snapshots.length === 0) {
    vscode.window.showInformationMessage('No snapshots to delete.');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete all ${snapshots.length} snapshot(s)? This action cannot be undone.`,
    { modal: true },
    'Delete All'
  );

  if (confirm !== 'Delete All') {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Deleting all snapshots...',
      cancellable: false,
    },
    async () => {
      for (const snapshot of snapshots) {
        await shadowGitService.deleteSnapshot(snapshot.id);
      }
    }
  );

  vscode.window.showInformationMessage(`Deleted ${snapshots.length} snapshot(s).`);
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
    'Restore'
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
    'Delete'
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
