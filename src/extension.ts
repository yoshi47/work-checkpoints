import * as vscode from 'vscode';
import { saveSnapshot } from './commands/saveSnapshot';
import { restoreSnapshot } from './commands/restoreSnapshot';
import { deleteSnapshots } from './commands/deleteSnapshots';

export const activate = (context: vscode.ExtensionContext) => {
  console.log('Work Checkpoints extension is now active!');

  context.subscriptions.push(
    vscode.commands.registerCommand('work-checkpoints.saveSnapshot', saveSnapshot),
    vscode.commands.registerCommand('work-checkpoints.restoreSnapshot', restoreSnapshot),
    vscode.commands.registerCommand('work-checkpoints.deleteSnapshots', deleteSnapshots)
  );
};

export const deactivate = () => {};
