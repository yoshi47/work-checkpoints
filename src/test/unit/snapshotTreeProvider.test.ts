import * as assert from 'assert';
import * as vscode from 'vscode';
import { SnapshotTreeItem } from '../../views/snapshotTreeProvider';
import { SnapshotMetadata } from '../../types';

suite('SnapshotTreeProvider', () => {
  suite('SnapshotTreeItem', () => {
    const createMockSnapshot = (overrides: Partial<SnapshotMetadata> = {}): SnapshotMetadata => ({
      id: 'abc1234',
      branchName: 'main',
      timestamp: new Date('2024-01-15T10:30:00'),
      description: 'Test snapshot description',
      ...overrides,
    });

    test('should display branch name in description', () => {
      const snapshot = createMockSnapshot();
      const item = new SnapshotTreeItem(snapshot, vscode.TreeItemCollapsibleState.Collapsed);

      assert.strictEqual(item.description, '[main] abc1234');
    });

    test('should display branch name with feature branch', () => {
      const snapshot = createMockSnapshot({
        branchName: 'feature/add-login',
        id: 'def5678',
      });
      const item = new SnapshotTreeItem(snapshot, vscode.TreeItemCollapsibleState.Collapsed);

      assert.strictEqual(item.description, '[feature/add-login] def5678');
    });

    test('should set label from snapshot description', () => {
      const snapshot = createMockSnapshot({ description: 'My custom description' });
      const item = new SnapshotTreeItem(snapshot, vscode.TreeItemCollapsibleState.Collapsed);

      assert.strictEqual(item.label, 'My custom description');
    });

    test('should set tooltip with branch and date info', () => {
      const snapshot = createMockSnapshot();
      const item = new SnapshotTreeItem(snapshot, vscode.TreeItemCollapsibleState.Collapsed);

      assert.ok(item.tooltip?.toString().includes('Test snapshot description'));
      assert.ok(item.tooltip?.toString().includes('Branch: main'));
      assert.ok(item.tooltip?.toString().includes('Date:'));
    });

    test('should set contextValue to snapshot', () => {
      const snapshot = createMockSnapshot();
      const item = new SnapshotTreeItem(snapshot, vscode.TreeItemCollapsibleState.Collapsed);

      assert.strictEqual(item.contextValue, 'snapshot');
    });

    test('should handle unknown branch name', () => {
      const snapshot = createMockSnapshot({ branchName: 'unknown' });
      const item = new SnapshotTreeItem(snapshot, vscode.TreeItemCollapsibleState.Collapsed);

      assert.strictEqual(item.description, '[unknown] abc1234');
    });
  });
});
