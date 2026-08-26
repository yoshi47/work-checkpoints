#!/usr/bin/env node
// VS Code 拡張と Claude プラグインを、ローカルの作業ツリー版と公開版の間で切り替える。
// 拡張はその都度パッケージし直したスナップショットで、以後の編集は on を打ち直すまで届かない。
// プラグインは作業ツリーを直接参照する。

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const PKG_PATH = path.join(REPO, 'package.json');
const VSIX = path.join(os.tmpdir(), 'work-checkpoints-dev.vsix');
const MARKETPLACE = 'work-checkpoints-plugin';
const PLUGIN = `work-checkpoints@${MARKETPLACE}`;
const PUBLIC_SOURCE = 'yoshi47/work-checkpoints';
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude/settings.json');
const DEV_MARK = '-dev.';

const HINTS = {
  code: "VS Code のコマンドパレットで Shell Command: Install 'code' command in PATH を実行してください。",
  claude: 'Claude Code CLI をインストールしてください。',
};

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
const EXT_ID = `${pkg.publisher}.${pkg.name}`;

function run(command, args) {
  execFileSync(command, args, { cwd: REPO, stdio: 'inherit' });
}

// 撤去系は対象が無いときも exit 1 を返す。初回や中断後の再実行を通したいので続行するが、
// 何を飛ばしたかは必ず出す。
function runOptional(command, args, reason) {
  try {
    run(command, args);
  } catch (error) {
    console.log(`  skip: ${command} ${args.join(' ')} (exit ${error.status}) — ${reason}`);
  }
}

function capture(command, args) {
  try {
    return execFileSync(command, args, { cwd: REPO, encoding: 'utf8' }).trim();
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`${command} が PATH にありません。${HINTS[command] ?? ''}`, { cause: error });
    }
    throw new Error(`${command} ${args.join(' ')} が失敗しました (exit ${error.status})`, { cause: error });
  }
}

// 途中で落ちると拡張とプラグインが食い違った状態が残るため、変更を始める前に潰す。
function preflight(commands) {
  const missing = commands.filter((command) => {
    try {
      execFileSync(command, ['--version'], { stdio: 'ignore' });
      return false;
    } catch {
      return true;
    }
  });
  if (missing.length) {
    throw new Error(
      [`必要なコマンドが見つかりません: ${missing.join(', ')}`, ...missing.map((c) => `  ${c}: ${HINTS[c] ?? ''}`)].join('\n'),
      { cause: missing },
    );
  }
}

function installedExtension() {
  const line = capture('code', ['--list-extensions', '--show-versions'])
    .split('\n')
    .find((entry) => entry.startsWith(`${EXT_ID}@`));
  return line ? line.slice(EXT_ID.length + 1) : null;
}

// known_marketplaces.json / installed_plugins.json は CLI が書き出す実体側の状態で、
// 宣言と一致しないまま残ることがある。どちらを向いているかの真実は settings.json にある。
function marketplaceSource() {
  let raw;
  try {
    raw = fs.readFileSync(CLAUDE_SETTINGS, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { kind: 'unknown', reason: `${CLAUDE_SETTINGS} がありません` };
    throw new Error(`${CLAUDE_SETTINGS} を読めません: ${error.code ?? error.message}`, { cause: error });
  }

  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (error) {
    // 壊れた settings.json は「公開版」ではなく、利用者が直すべき障害。
    return { kind: 'unknown', reason: `settings.json が JSON として壊れています: ${error.message}` };
  }

  const entry = settings.extraKnownMarketplaces?.[MARKETPLACE]?.source;
  if (!entry) return { kind: 'unknown', reason: `extraKnownMarketplaces に ${MARKETPLACE} の登録がありません` };
  if (entry.source === 'directory') return { kind: 'directory', path: entry.path };
  return { kind: 'github', repo: entry.repo };
}

// dev 版は version に `-dev.<sha>` を付ける。status() がこの接頭辞だけでローカル版を
// 判定するため、書式を変えると判定が黙って壊れる。vsce package は package.json の
// version をそのまま焼き込むので、一時書き換え以外に付ける手段がない。
function packageDev() {
  if (pkg.version.includes(DEV_MARK) || pkg.displayName.endsWith('(dev)')) {
    throw new Error(
      [
        `package.json が dev 版のまま残っています (version=${pkg.version}, displayName=${pkg.displayName})。`,
        '前回の dev:on が中断された可能性があります。元に戻してから再実行してください:',
        `  git checkout -- ${path.relative(REPO, PKG_PATH)}`,
      ].join('\n'),
      { cause: pkg.version },
    );
  }

  const original = fs.readFileSync(PKG_PATH, 'utf8');
  const sha = capture('git', ['rev-parse', '--short', 'HEAD']);
  const dev = { ...pkg, version: `${pkg.version}${DEV_MARK}${sha}`, displayName: `${pkg.displayName} (dev)` };
  const restore = () => fs.writeFileSync(PKG_PATH, original);
  // finally はシグナルでは走らない。vsce package は数十秒かかり、その間の Ctrl-C で
  // 追跡ファイルである package.json が dev 版のまま残る。
  const onSignal = (signal) => {
    restore();
    console.error(`\n${signal} を受けたので package.json を復元しました。`);
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  fs.writeFileSync(PKG_PATH, `${JSON.stringify(dev, null, 2)}\n`);
  try {
    run('npx', ['vsce', 'package', '--allow-missing-repository', '-o', VSIX]);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    restore();
  }
  return dev.version;
}

// marketplace の name は marketplace.json 由来でローカル版と公開版が同一なので、
// 差し替えではなく一度外してから入れ直すしかない。プラグインを先に外さないと
// marketplace の撤去が拒否される。
function reinstallPlugin(source) {
  runOptional('claude', ['plugin', 'uninstall', PLUGIN, '-y'], '未インストールなら不要');
  runOptional('claude', ['plugin', 'marketplace', 'remove', MARKETPLACE], '未登録なら不要');
  run('claude', ['plugin', 'marketplace', 'add', source]);
  run('claude', ['plugin', 'install', PLUGIN, '-y']);
}

function on() {
  preflight(['code', 'claude', 'git', 'npx']);
  const version = packageDev();
  run('code', ['--install-extension', VSIX, '--force']);
  reinstallPlugin(REPO);

  const actual = installedExtension();
  if (actual !== version) {
    console.error(`\n警告: 期待した ${version} に対し、実際に入っているのは ${actual ?? '（無し）'} です。`);
    console.error('VS Code を完全に終了してから再実行してください。');
  }
  report();
}

function off() {
  preflight(['code', 'claude']);
  // --force は dev 版から公開版へのダウングレードもこなす（実測）。事前の uninstall は
  // 失敗したときに戻り道を失うだけなので置かない。
  run('code', ['--install-extension', EXT_ID, '--force']);
  reinstallPlugin(PUBLIC_SOURCE);
  report();
}

function report() {
  console.log('\n切り替え後の実測:');
  status();
  console.log('\nVS Code とセッションの再起動が必要です。');
}

function status() {
  let version;
  try {
    version = installedExtension();
    if (version === null) {
      console.log('拡張:       未インストール');
    } else {
      console.log(`拡張:       ${EXT_ID}@${version} ${version.includes(DEV_MARK) ? '← ローカル' : '← 公開版'}`);
    }
  } catch (error) {
    console.log(`拡張:       判定不能（${error.message}）`);
  }

  const source = marketplaceSource();
  if (source.kind === 'unknown') {
    console.log(`プラグイン: 判定不能（${source.reason}）`);
  } else if (source.kind === 'directory') {
    console.log(`プラグイン: ${source.path} ← ローカル${source.path === REPO ? '' : '（このリポジトリとは別のパス）'}`);
  } else {
    console.log(`プラグイン: ${source.repo} ← 公開版`);
  }
}

try {
  const command = process.argv[2];
  if (command === 'on') on();
  else if (command === 'off') off();
  else if (command === 'status') status();
  else {
    console.error('usage: node scripts/dev-channel.js <on|off|status>');
    process.exit(1);
  }
} catch (error) {
  console.error(`\n${error.message}`);
  if (!error.cause) console.error(error.stack);
  process.exit(1);
}
