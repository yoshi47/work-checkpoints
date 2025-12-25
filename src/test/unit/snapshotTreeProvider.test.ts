import * as assert from 'assert';
import * as vscode from 'vscode';
import { SnapshotTreeItem, BranchTreeItem } from '../../views/snapshotTreeProvider';
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

  suite('BranchTreeItem', () => {
    test('should display branch name and snapshot count', () => {
      const item = new BranchTreeItem('main', 5, vscode.TreeItemCollapsibleState.Collapsed);

      assert.strictEqual(item.label, 'main');
      assert.strictEqual(item.description, '5 snapshots');
      assert.strictEqual(item.contextValue, 'branch');
    });

    test('should handle singular snapshot count', () => {
      const item = new BranchTreeItem('feature/test', 1, vscode.TreeItemCollapsibleState.Collapsed);

      assert.strictEqual(item.description, '1 snapshot');
    });

    test('should display unknown branch with special formatting', () => {
      const item = new BranchTreeItem('unknown', 3, vscode.TreeItemCollapsibleState.Collapsed);

      assert.strictEqual(item.label, '(unknown branch)');
      assert.strictEqual(item.description, '3 snapshots');
    });

    test('should set tooltip with branch name and count', () => {
      const item = new BranchTreeItem('develop', 10, vscode.TreeItemCollapsibleState.Collapsed);

      assert.ok(item.tooltip?.toString().includes('Branch: develop'));
      assert.ok(item.tooltip?.toString().includes('Snapshots: 10'));
    });

    test('should use git-branch icon for normal branches', () => {
      const item = new BranchTreeItem('main', 1, vscode.TreeItemCollapsibleState.Collapsed);

      assert.ok(item.iconPath instanceof vscode.ThemeIcon);
      assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'git-branch');
    });

    test('should use question icon for unknown branch', () => {
      const item = new BranchTreeItem('unknown', 1, vscode.TreeItemCollapsibleState.Collapsed);

      assert.ok(item.iconPath instanceof vscode.ThemeIcon);
      assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'question');
    });
  });
});
