import * as vscode from 'vscode';
import { ShadowGitService } from '../services/shadowGitService';

export class SnapshotContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'snapshot';

  private shadowGitService: ShadowGitService | null = null;

  setShadowGitService(service: ShadowGitService | null): void {
    this.shadowGitService = service;
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    if (!this.shadowGitService) {
      return '';
    }

    // URI format: snapshot:{snapshotId}/{filePath}
    const [snapshotId, ...pathParts] = uri.path.split('/');
    const filePath = pathParts.join('/');

    try {
      const files = await this.shadowGitService.getSnapshotFiles(snapshotId);
      const content = files.get(filePath);
      return content?.toString('utf-8') ?? '';
    } catch {
      return '';
    }
  }

  static createUri(snapshotId: string, filePath: string): vscode.Uri {
    return vscode.Uri.parse(`${SnapshotContentProvider.scheme}:${snapshotId}/${filePath}`);
  }
}
