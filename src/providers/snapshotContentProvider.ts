import * as vscode from 'vscode';
import { ShadowGitService } from '../services/shadowGitService';

export class SnapshotContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'snapshot';
  static readonly EMPTY_SNAPSHOT_ID = '__empty__';

  private shadowGitService: ShadowGitService | null = null;

  setShadowGitService(service: ShadowGitService | null): void {
    this.shadowGitService = service;
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    if (!this.shadowGitService) {
      return '';
    }

    // URI format: snapshot:{snapshotId}/{filePath}
    // snapshotId may be EMPTY_SNAPSHOT_ID ('__empty__') to represent an empty file (e.g. for diffing against no parent)
    const [snapshotId, ...pathParts] = uri.path.split('/');
    const filePath = pathParts.join('/');

    if (snapshotId === SnapshotContentProvider.EMPTY_SNAPSHOT_ID) {
      return '';
    }

    return await this.shadowGitService.getSnapshotFileContent(snapshotId, filePath);
  }

  static createUri(snapshotId: string, filePath: string): vscode.Uri {
    return vscode.Uri.parse(`${SnapshotContentProvider.scheme}:${snapshotId}/${filePath}`);
  }
}
