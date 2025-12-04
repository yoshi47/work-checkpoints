import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  createIgnoreFilter,
  getAllFiles,
  copyFileToShadowRepo,
  clearDirectory,
} from '../../utils/fileUtils';

suite('fileUtils', () => {
  let tempDir: string;

  setup(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'work-checkpoints-test-'));
  });

  teardown(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  suite('createIgnoreFilter', () => {
    test('should always ignore .git directory', async () => {
      const ig = await createIgnoreFilter(tempDir);

      assert.strictEqual(ig.ignores('.git'), true);
      assert.strictEqual(ig.ignores('.git/config'), true);
    });

    test('should respect .gitignore patterns', async () => {
      await fs.writeFile(path.join(tempDir, '.gitignore'), 'node_modules\n*.log\n');

      const ig = await createIgnoreFilter(tempDir);

      assert.strictEqual(ig.ignores('node_modules'), true);
      assert.strictEqual(ig.ignores('node_modules/package/index.js'), true);
      assert.strictEqual(ig.ignores('error.log'), true);
      assert.strictEqual(ig.ignores('src/index.ts'), false);
    });

    test('should work without .gitignore', async () => {
      const ig = await createIgnoreFilter(tempDir);

      assert.strictEqual(ig.ignores('.git'), true);
      assert.strictEqual(ig.ignores('src/index.ts'), false);
    });
  });

  suite('getAllFiles', () => {
    test('should return all files in directory', async () => {
      await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1');
      await fs.writeFile(path.join(tempDir, 'src', 'file2.ts'), 'content2');

      const ig = await createIgnoreFilter(tempDir);
      const files = await getAllFiles(tempDir, ig);

      assert.strictEqual(files.length, 2);
      assert.ok(files.includes('file1.txt'));
      assert.ok(files.includes(path.join('src', 'file2.ts')));
    });

    test('should ignore files matching .gitignore', async () => {
      await fs.mkdir(path.join(tempDir, 'node_modules'), { recursive: true });
      await fs.writeFile(path.join(tempDir, '.gitignore'), 'node_modules\n');
      await fs.writeFile(path.join(tempDir, 'index.ts'), 'content');
      await fs.writeFile(path.join(tempDir, 'node_modules', 'pkg.js'), 'content');

      const ig = await createIgnoreFilter(tempDir);
      const files = await getAllFiles(tempDir, ig);

      assert.strictEqual(files.length, 2); // .gitignore and index.ts
      assert.ok(files.includes('index.ts'));
      assert.ok(!files.some((f) => f.includes('node_modules')));
    });

    test('should ignore .git directory', async () => {
      await fs.mkdir(path.join(tempDir, '.git'), { recursive: true });
      await fs.writeFile(path.join(tempDir, '.git', 'config'), 'content');
      await fs.writeFile(path.join(tempDir, 'index.ts'), 'content');

      const ig = await createIgnoreFilter(tempDir);
      const files = await getAllFiles(tempDir, ig);

      assert.strictEqual(files.length, 1);
      assert.ok(files.includes('index.ts'));
    });
  });

  suite('copyFileToShadowRepo', () => {
    test('should copy file preserving relative path', async () => {
      const sourceDir = path.join(tempDir, 'source');
      const targetDir = path.join(tempDir, 'target');
      await fs.mkdir(path.join(sourceDir, 'nested'), { recursive: true });
      await fs.writeFile(path.join(sourceDir, 'nested', 'file.txt'), 'test content');

      await copyFileToShadowRepo(sourceDir, path.join('nested', 'file.txt'), targetDir);

      const copiedContent = await fs.readFile(path.join(targetDir, 'nested', 'file.txt'), 'utf-8');
      assert.strictEqual(copiedContent, 'test content');
    });

    test('should create intermediate directories', async () => {
      const sourceDir = path.join(tempDir, 'source');
      const targetDir = path.join(tempDir, 'target');
      await fs.mkdir(path.join(sourceDir, 'a', 'b', 'c'), { recursive: true });
      await fs.writeFile(path.join(sourceDir, 'a', 'b', 'c', 'file.txt'), 'content');

      await copyFileToShadowRepo(sourceDir, path.join('a', 'b', 'c', 'file.txt'), targetDir);

      const exists = await fs
        .access(path.join(targetDir, 'a', 'b', 'c', 'file.txt'))
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(exists, true);
    });
  });

  suite('clearDirectory', () => {
    test('should clear all files and directories', async () => {
      await fs.mkdir(path.join(tempDir, 'subdir'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content');
      await fs.writeFile(path.join(tempDir, 'subdir', 'nested.txt'), 'content');

      await clearDirectory(tempDir, false);

      const entries = await fs.readdir(tempDir);
      assert.strictEqual(entries.length, 0);
    });

    test('should preserve .git directory when excludeGit is true', async () => {
      await fs.mkdir(path.join(tempDir, '.git'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(tempDir, '.git', 'config'), 'content');
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'content');

      await clearDirectory(tempDir, true);

      const entries = await fs.readdir(tempDir);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0], '.git');
    });

    test('should not throw for non-existent directory', async () => {
      const nonExistent = path.join(tempDir, 'non-existent');

      await assert.doesNotReject(async () => {
        await clearDirectory(nonExistent, false);
      });
    });
  });
});
