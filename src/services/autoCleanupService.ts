import * as vscode from 'vscode';
import { ShadowGitService } from './shadowGitService';

export class AutoCleanupService {
  private timer: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

  constructor(private readonly getShadowGitService: () => ShadowGitService | null) {}

  start = (): void => {
    // Run cleanup on start
    this.runCleanup();

    // Schedule periodic cleanup
    this.timer = setInterval(() => {
      this.runCleanup();
    }, this.CLEANUP_INTERVAL);
  };

  stop = (): void => {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  };

  private runCleanup = async (): Promise<void> => {
    const config = vscode.workspace.getConfiguration('work-checkpoints');
    const retentionDays = config.get<number>('retentionDays', 0);

    if (retentionDays <= 0) {
      return;
    }

    const shadowGitService = this.getShadowGitService();

    if (!shadowGitService) {
      return;
    }

    try {
      const deletedCount = await shadowGitService.deleteOldSnapshots(retentionDays);
      if (deletedCount > 0) {
        console.log(`Auto-cleanup: Deleted ${deletedCount} old snapshot(s)`);
      }
    } catch (error) {
      console.error('Auto-cleanup failed:', error);
    }
  };
}
