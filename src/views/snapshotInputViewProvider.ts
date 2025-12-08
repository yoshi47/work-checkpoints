import * as vscode from 'vscode';

export class SnapshotInputViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'workCheckpointsInput';

  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    this._updateWebview();

    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('work-checkpoints.showDeleteAllButton')) {
        this._updateWebview();
      }
    });

    webviewView.webview.onDidReceiveMessage(async (data) => {
      if (data.type === 'saveSnapshot') {
        await vscode.commands.executeCommand(
          'work-checkpoints.saveSnapshotWithDescription',
          data.description
        );
        this.clearInput();
      } else if (data.type === 'deleteAll') {
        await vscode.commands.executeCommand('work-checkpoints.deleteAll');
      }
    });
  }

  public clearInput(): void {
    if (this._view) {
      this._view.webview.postMessage({ type: 'clearInput' });
    }
  }

  private _updateWebview(): void {
    if (this._view) {
      const config = vscode.workspace.getConfiguration('work-checkpoints');
      const showDeleteAllButton = config.get<boolean>('showDeleteAllButton', true);
      this._view.webview.html = this._getHtmlForWebview(showDeleteAllButton);
    }
  }

  private _getHtmlForWebview(showDeleteAllButton: boolean = true): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      padding: 8px 12px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .container {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    input {
      width: 100%;
      padding: 4px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      font-family: inherit;
      font-size: inherit;
      outline: none;
    }
    input:focus {
      border-color: var(--vscode-focusBorder);
    }
    input::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }
    button {
      width: 100%;
      padding: 6px 12px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button:active {
      background: var(--vscode-button-background);
    }
    .delete-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .delete-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
  </style>
</head>
<body>
  <div class="container">
    <input type="text" id="description" placeholder="Snapshot description (optional)">
    <button id="saveBtn">Save</button>
    ${showDeleteAllButton ? '<button id="deleteAllBtn" class="delete-btn">Delete All</button>' : ''}
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const input = document.getElementById('description');
    const saveBtn = document.getElementById('saveBtn');
    const deleteAllBtn = document.getElementById('deleteAllBtn');

    const save = () => {
      vscode.postMessage({
        type: 'saveSnapshot',
        description: input.value.trim() || undefined
      });
    };

    saveBtn.addEventListener('click', save);

    if (deleteAllBtn) {
      deleteAllBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'deleteAll' });
      });
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        save();
      }
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'clearInput') {
        input.value = '';
        input.focus();
      }
    });
  </script>
</body>
</html>`;
  }
}
