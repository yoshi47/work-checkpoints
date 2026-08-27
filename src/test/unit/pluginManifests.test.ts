import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';

// hooks.json のコマンドは Codex では ${PLUGIN_ROOT} 展開でしか解決できない。相対パス
// (./scripts/...) も絶対パス ($HOME/...) もインストール後に静かに失敗し、チェックポイントが
// 取られなくなるだけで誰も気づかないため、パスの形と実体をここで固定する。
const REPO_ROOT = path.resolve(__dirname, '../../..');

interface PluginFixture {
  label: string;
  root: string;
  manifest: string;
  marketplace: string;
  rootVar: string;
}

const PLUGINS: PluginFixture[] = [
  {
    label: 'claude-plugin',
    root: 'claude-plugin',
    manifest: 'claude-plugin/.claude-plugin/plugin.json',
    marketplace: '.claude-plugin/marketplace.json',
    rootVar: '${CLAUDE_PLUGIN_ROOT}',
  },
  {
    label: 'codex-plugin',
    root: 'codex-plugin',
    manifest: 'codex-plugin/.codex-plugin/plugin.json',
    marketplace: '.agents/plugins/marketplace.json',
    rootVar: '${PLUGIN_ROOT}',
  },
];

const readJson = async (relative: string): Promise<any> =>
  JSON.parse(await fs.readFile(path.join(REPO_ROOT, relative), 'utf-8'));

const exists = async (absolute: string): Promise<boolean> =>
  fs
    .access(absolute)
    .then(() => true)
    .catch(() => false);

const hookCommands = (hooks: any): string[] =>
  Object.values<any>(hooks.hooks).flatMap((entries) =>
    entries.flatMap((entry: any) => entry.hooks.map((hook: any) => hook.command as string)),
  );

suite('plugin manifests', () => {
  PLUGINS.forEach((plugin) => {
    test(`${plugin.label}: hook commands resolve to executable scripts`, async () => {
      const manifest = await readJson(plugin.manifest);
      const hooksPath = path.join(REPO_ROOT, plugin.root, manifest.hooks ?? 'hooks/hooks.json');
      assert.ok(await exists(hooksPath), `missing ${hooksPath}`);

      const commands = hookCommands(JSON.parse(await fs.readFile(hooksPath, 'utf-8')));
      assert.ok(commands.length > 0, 'no hook commands declared');

      for (const command of commands) {
        assert.ok(
          command.startsWith(plugin.rootVar),
          `${command} must start with ${plugin.rootVar}`,
        );
        assert.ok(!command.includes('$HOME'), `${command} must not hardcode $HOME`);

        const script = path.join(REPO_ROOT, plugin.root, command.slice(plugin.rootVar.length));
        const stats = await fs.stat(script);
        assert.ok(stats.mode & 0o111, `${script} is not executable`);
      }
    });

    test(`${plugin.label}: commands declared in the manifest exist`, async () => {
      const manifest = await readJson(plugin.manifest);

      for (const entry of manifest.commands ?? []) {
        assert.ok(
          await exists(path.join(REPO_ROOT, plugin.root, entry)),
          `${plugin.label} declares ${entry}, which does not exist`,
        );
      }
    });

    // skills はファイルの列挙ではなくディレクトリ指定なので、存在確認だけでは
    // SKILL.md の欠けた空ディレクトリも通ってしまう。中身まで見る。
    test(`${plugin.label}: every skill directory holds a SKILL.md named after it`, async () => {
      const manifest = await readJson(plugin.manifest);
      if (!manifest.skills) {
        return;
      }

      const skillsDir = path.join(REPO_ROOT, plugin.root, manifest.skills);
      const entries = (await fs.readdir(skillsDir, { withFileTypes: true })).filter((e) =>
        e.isDirectory(),
      );
      assert.ok(entries.length > 0, `${skillsDir} declares skills but holds none`);

      for (const entry of entries) {
        const skill = path.join(skillsDir, entry.name, 'SKILL.md');
        assert.ok(await exists(skill), `missing ${skill}`);

        const name = /^---\n(?:.*\n)*?name:\s*(\S+)\s*\n/.exec(await fs.readFile(skill, 'utf-8'));
        assert.ok(name, `${skill} has no name in its frontmatter`);
        assert.strictEqual(name[1], entry.name, `${skill} is named ${name[1]}`);
      }
    });

    test(`${plugin.label}: the marketplace entry points at this plugin`, async () => {
      const marketplace = await readJson(plugin.marketplace);
      assert.strictEqual(marketplace.name, 'work-checkpoints-plugin');

      const entry = marketplace.plugins.find((p: any) => p.name === 'work-checkpoints');
      assert.ok(entry, `no work-checkpoints entry in ${plugin.marketplace}`);

      // Claude はソースを文字列で、Codex は {source, path} オブジェクトで書く。
      const source: string = typeof entry.source === 'string' ? entry.source : entry.source.path;
      assert.strictEqual(path.normalize(source), path.join('.', plugin.root));

      const manifest = await readJson(plugin.manifest);
      assert.strictEqual(manifest.name, entry.name);
    });
  });

  test('the version is the same everywhere it is written down', async () => {
    const sources = [
      'package.json',
      'claude-plugin/.claude-plugin/plugin.json',
      'codex-plugin/.codex-plugin/plugin.json',
    ];
    const versions = await Promise.all(sources.map(async (s) => (await readJson(s)).version));

    const marketplace = await readJson('.claude-plugin/marketplace.json');
    versions.push(marketplace.plugins.find((p: any) => p.name === 'work-checkpoints').version);

    assert.strictEqual(new Set(versions).size, 1, `versions drifted: ${versions.join(', ')}`);
  });
});
