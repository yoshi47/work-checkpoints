import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { saveSnapshot } from './commands/saveSnapshot';
import { restoreSnapshot } from './commands/restoreSnapshot';
import { deleteSnapshots, deleteClaudeSnapshots } from './commands/deleteSnapshots';
import { SnapshotTreeProvider, SnapshotTreeItem, SnapshotFileTreeItem, SnapshotFolderTreeItem } from './views/snapshotTreeProvider';
import { SnapshotInputViewProvider } from './views/snapshotInputViewProvider';
import { SnapshotContentProvider } from './providers/snapshotContentProvider';
import { AutoCleanupService } from './services/autoCleanupService';
import { FileHistoryTreeProvider } from './views/fileHistoryTreeProvider';

let snapshotTreeProvider: SnapshotTreeProvider;
let snapshotContentProvider: SnapshotContentProvider;
let autoCleanupService: AutoCleanupService;
let fileHistoryTreeProvider: FileHistoryTreeProvider;

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

  // Create and register File History TreeView
  fileHistoryTreeProvider = new FileHistoryTreeProvider();
  const fileHistoryTreeView = vscode.window.createTreeView('workCheckpointsFileHistory', {
    treeDataProvider: fileHistoryTreeProvider,
    showCollapseAll: false,
  });

  // Initialize context for tree view mode
  vscode.commands.executeCommand('setContext', 'workCheckpoints.treeViewMode', false);

  // Initialize context for group by branch mode
  const savedGroupByBranch = context.globalState.get('work-checkpoints.groupByBranch', false);
  if (savedGroupByBranch) {
    snapshotTreeProvider.setGroupByBranch(true);
  }
  vscode.commands.executeCommand('setContext', 'workCheckpoints.groupByBranch', savedGroupByBranch);

  // Initialize context for show Claude snapshots mode
  const savedShowClaude = context.globalState.get('work-checkpoints.showClaudeSnapshots', true);
  if (!savedShowClaude) {
    snapshotTreeProvider.setShowClaudeSnapshots(false);
  }
  vscode.commands.executeCommand('setContext', 'workCheckpoints.showClaudeSnapshots', savedShowClaude);

  // Initialize context for commit diff mode
  const setCommitDiffMode = (mode: boolean) => {
    fileHistoryTreeProvider.setCommitDiffMode(mode);
    vscode.commands.executeCommand('setContext', 'workCheckpoints.commitDiffMode', mode);
    context.globalState.update('work-checkpoints.commitDiffMode', mode);
  };
  const savedCommitDiffMode = context.globalState.get('work-checkpoints.commitDiffMode', false);
  fileHistoryTreeProvider.setCommitDiffMode(savedCommitDiffMode);
  vscode.commands.executeCommand('setContext', 'workCheckpoints.commitDiffMode', savedCommitDiffMode);

  // Initialize context for settings button visibility
  const showSettingsButton = vscode.workspace.getConfiguration('work-checkpoints').get('showSettingsButton', false);
  vscode.commands.executeCommand('setContext', 'workCheckpoints.showSettingsButton', showSettingsButton);

  // Update settings button visibility when configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('work-checkpoints.showSettingsButton')) {
        const show = vscode.workspace.getConfiguration('work-checkpoints').get('showSettingsButton', false);
        vscode.commands.executeCommand('setContext', 'workCheckpoints.showSettingsButton', show);
      }
    })
  );

  // Register WebView provider for input
  const snapshotInputViewProvider = new SnapshotInputViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SnapshotInputViewProvider.viewType,
      snapshotInputViewProvider
    )
  );

  // Initialize auto-cleanup service
  autoCleanupService = new AutoCleanupService(() => snapshotTreeProvider.getShadowGitService());
  autoCleanupService.start();

  // Register commands
  context.subscriptions.push(
    treeView,
    fileHistoryTreeView,
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
    vscode.commands.registerCommand('work-checkpoints.toggleFavorite', async (item: SnapshotTreeItem) => {
      await toggleFavoriteItem(item);
      snapshotTreeProvider.refresh();
    }),
    vscode.commands.registerCommand('work-checkpoints.removeFavorite', async (item: SnapshotTreeItem) => {
      await removeFavoriteItem(item);
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
    vscode.commands.registerCommand('work-checkpoints.restoreFolderItem', async (item: SnapshotFolderTreeItem) => {
      await restoreFolderItem(item);
    }),
    vscode.commands.registerCommand('work-checkpoints.deleteFolderItem', async (item: SnapshotFolderTreeItem) => {
      await deleteFolderItem(item);
    }),
    vscode.commands.registerCommand('work-checkpoints.viewAsTree', () => {
      snapshotTreeProvider.toggleViewMode();
      vscode.commands.executeCommand('setContext', 'workCheckpoints.treeViewMode', true);
    }),
    vscode.commands.registerCommand('work-checkpoints.viewAsList', () => {
      snapshotTreeProvider.toggleViewMode();
      vscode.commands.executeCommand('setContext', 'workCheckpoints.treeViewMode', false);
    }),
    vscode.commands.registerCommand('work-checkpoints.groupByBranch', () => {
      snapshotTreeProvider.setGroupByBranch(true);
      vscode.commands.executeCommand('setContext', 'workCheckpoints.groupByBranch', true);
      context.globalState.update('work-checkpoints.groupByBranch', true);
    }),
    vscode.commands.registerCommand('work-checkpoints.flatList', () => {
      snapshotTreeProvider.setGroupByBranch(false);
      vscode.commands.executeCommand('setContext', 'workCheckpoints.groupByBranch', false);
      context.globalState.update('work-checkpoints.groupByBranch', false);
    }),
    vscode.commands.registerCommand('work-checkpoints.showClaudeSnapshots', () => {
      snapshotTreeProvider.setShowClaudeSnapshots(true);
      vscode.commands.executeCommand('setContext', 'workCheckpoints.showClaudeSnapshots', true);
      context.globalState.update('work-checkpoints.showClaudeSnapshots', true);
    }),
    vscode.commands.registerCommand('work-checkpoints.hideClaudeSnapshots', () => {
      snapshotTreeProvider.setShowClaudeSnapshots(false);
      vscode.commands.executeCommand('setContext', 'workCheckpoints.showClaudeSnapshots', false);
      context.globalState.update('work-checkpoints.showClaudeSnapshots', false);
    }),
    vscode.commands.registerCommand('work-checkpoints.deleteAll', async () => {
      await deleteAllSnapshots();
      snapshotTreeProvider.refresh();
    }),
    vscode.commands.registerCommand('work-checkpoints.deleteClaudeSnapshots', async () => {
      await deleteClaudeSnapshots();
      snapshotTreeProvider.refresh();
    }),
    vscode.commands.registerCommand('work-checkpoints.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:kururu6966.work-checkpoints');
    }),
    vscode.commands.registerCommand('work-checkpoints.showFileHistory', async (uri?: vscode.Uri) => {
      await showFileHistory(uri);
    }),
    vscode.commands.registerCommand('work-checkpoints.diffCommitChanges', () => {
      setCommitDiffMode(true);
    }),
    vscode.commands.registerCommand('work-checkpoints.diffWithCurrent', () => {
      setCommitDiffMode(false);
    }),
  );

  // Refresh when workspace changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      snapshotTreeProvider.refresh();
    })
  );

  // Auto-update file history when active editor changes
  let fileHistoryDebounceTimer: NodeJS.Timeout | undefined;
  let lastFileHistoryPath: string | undefined;

  const updateFileHistoryForEditor = (editor: vscode.TextEditor | undefined) => {
    if (fileHistoryDebounceTimer) {
      clearTimeout(fileHistoryDebounceTimer);
    }
    fileHistoryDebounceTimer = setTimeout(async () => {
      try {
        if (!editor || editor.document.uri.scheme !== 'file') {
          return;
        }

        const ctx = await resolveFileContext(editor.document.uri);
        if (!ctx) {
          return;
        }

        if (lastFileHistoryPath === ctx.relativePath) {
          return;
        }
        lastFileHistoryPath = ctx.relativePath;

        const snapshots = await ctx.shadowGitService.getFileHistory(ctx.relativePath);
        fileHistoryTreeProvider.setFile(ctx.relativePath, ctx.gitRoot, snapshots);
      } catch (error) {
        console.error('[updateFileHistoryForEditor] Failed to update file history:', error);
      }
    }, 300);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateFileHistoryForEditor)
  );

  // Show history for the current active editor on activation
  if (vscode.window.activeTextEditor) {
    snapshotTreeProvider.ensureInitialized().then(() => {
      updateFileHistoryForEditor(vscode.window.activeTextEditor);
    }).catch((error) => {
      console.error('[activate] Failed to initialize file history:', error);
    });
  }
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

const toggleFavoriteItem = async (item: SnapshotTreeItem): Promise<void> => {
  const shadowGitService = snapshotTreeProvider.getShadowGitService();

  if (!shadowGitService) {
    vscode.window.showErrorMessage('No Git repository found in workspace.');
    return;
  }

  const isFavorite = await shadowGitService.toggleFavorite(item.snapshot.id);
  const message = isFavorite
    ? `Added to favorites: ${item.snapshot.description}`
    : `Removed from favorites: ${item.snapshot.description}`;
  vscode.window.showInformationMessage(message);
};

const removeFavoriteItem = async (item: SnapshotTreeItem): Promise<void> => {
  const shadowGitService = snapshotTreeProvider.getShadowGitService();

  if (!shadowGitService) {
    vscode.window.showErrorMessage('No Git repository found in workspace.');
    return;
  }

  await shadowGitService.toggleFavorite(item.snapshot.id);
  vscode.window.showInformationMessage(`Removed from favorites: ${item.snapshot.description}`);
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
  try {
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

    const snapshotUri = SnapshotContentProvider.createUri(item.snapshotId, item.filePath);

    if (fileHistoryTreeProvider.getCommitDiffMode()) {
      // Use getFileHistory for chronological order (listSnapshots reorders favorites to top)
      const snapshots = await shadowGitService.getFileHistory(item.filePath);
      const index = snapshots.findIndex((s) => s.id === item.snapshotId);
      if (index < 0) {
        vscode.window.showErrorMessage('Snapshot not found in file history.');
        return;
      }
      const parentSnapshotId = index < snapshots.length - 1
        ? snapshots[index + 1].id
        : null;
      const parentUri = parentSnapshotId
        ? SnapshotContentProvider.createUri(parentSnapshotId, item.filePath)
        : SnapshotContentProvider.createUri(SnapshotContentProvider.EMPTY_SNAPSHOT_ID, item.filePath);

      const snapshot = snapshots[index];
      const label = `${item.filePath} (${snapshot.description})`;

      await vscode.commands.executeCommand('vscode.diff', parentUri, snapshotUri, label);
    } else {
      const currentFileUri = vscode.Uri.file(path.join(gitRoot, item.filePath));
      await vscode.commands.executeCommand(
        'vscode.diff',
        snapshotUri,
        currentFileUri,
        `${item.filePath} (Snapshot vs Current)`
      );
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to show diff: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const restoreFileItem = async (item: SnapshotFileTreeItem): Promise<void> => {
  try {
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

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Restoring file: ${item.filePath}`,
        cancellable: false,
      },
      async () => {
        const content = await shadowGitService.getSnapshotFileContent(item.snapshotId, item.filePath);

        if (!content) {
          vscode.window.showErrorMessage('File not found in snapshot.');
          return;
        }

        const fullPath = path.join(gitRoot, item.filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content);

        vscode.window.showInformationMessage(`File restored: ${item.filePath}`);
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to restore file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
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

const restoreFolderItem = async (item: SnapshotFolderTreeItem): Promise<void> => {
  try {
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
      `Restore folder "${item.folderPath}" (${item.childPaths.length} files) from snapshot? This will overwrite current files.`,
      { modal: true },
      'Restore'
    );

    if (confirm !== 'Restore') {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Restoring folder: ${item.folderPath}`,
        cancellable: false,
      },
      async (progress) => {
        let restoredCount = 0;
        for (let i = 0; i < item.childPaths.length; i++) {
          const filePath = item.childPaths[i];

          progress.report({
            message: `Restoring folder: ${item.folderPath} (${i + 1}/${item.childPaths.length})`,
            increment: (100 / item.childPaths.length)
          });

          try {
            const content = await shadowGitService.getSnapshotFileContent(item.snapshotId, filePath);
            if (content) {
              const fullPath = path.join(gitRoot, filePath);
              await fs.mkdir(path.dirname(fullPath), { recursive: true });
              await fs.writeFile(fullPath, content);
              restoredCount++;
            }
          } catch (error) {
            // Continue with other files if one fails
          }
        }
      }
    );

    vscode.window.showInformationMessage(`Folder restored: ${item.folderPath} (${item.childPaths.length} files)`);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to restore folder: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const deleteFolderItem = async (item: SnapshotFolderTreeItem): Promise<void> => {
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

  const fullPath = path.join(gitRoot, item.folderPath);

  try {
    await fs.access(fullPath);
  } catch {
    vscode.window.showWarningMessage(`Folder does not exist: ${item.folderPath}`);
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete folder "${item.folderPath}" from workspace? This action cannot be undone.`,
    { modal: true },
    'Delete'
  );

  if (confirm !== 'Delete') {
    return;
  }

  await fs.rm(fullPath, { recursive: true });
  vscode.window.showInformationMessage(`Folder deleted: ${item.folderPath}`);
};

const resolveFileContext = async (fileUri: vscode.Uri) => {
  const shadowGitService = snapshotTreeProvider.getShadowGitService();
  const workspaceService = snapshotTreeProvider.getWorkspaceService();
  if (!shadowGitService || !workspaceService) {
    return null;
  }

  const gitRoot = await workspaceService.getGitRoot();
  if (!gitRoot) {
    return null;
  }

  const relativePath = path.relative(gitRoot, fileUri.fsPath);
  if (relativePath.startsWith('..')) {
    return null;
  }

  return { shadowGitService, gitRoot, relativePath };
};

const showFileHistory = async (uri?: vscode.Uri): Promise<void> => {
  const fileUri = uri || vscode.window.activeTextEditor?.document.uri;
  if (!fileUri || fileUri.scheme !== 'file') {
    vscode.window.showErrorMessage('No file selected.');
    return;
  }

  const ctx = await resolveFileContext(fileUri);
  if (!ctx) {
    vscode.window.showErrorMessage('No Git repository found in workspace.');
    return;
  }

  const snapshots = await ctx.shadowGitService.getFileHistory(ctx.relativePath);

  if (snapshots.length === 0) {
    vscode.window.showInformationMessage(`No checkpoint history found for ${ctx.relativePath}`);
    return;
  }

  fileHistoryTreeProvider.setFile(ctx.relativePath, ctx.gitRoot, snapshots);
  vscode.commands.executeCommand('workCheckpointsFileHistory.focus');
};

export const deactivate = () => {
  if (autoCleanupService) {
    autoCleanupService.stop();
  }
};
