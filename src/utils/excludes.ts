import * as fs from 'fs/promises';
import * as path from 'path';

// ビルド成果物
const buildArtifactPatterns = [
  'node_modules/',
  'dist/',
  'build/',
  '.next/',
  'out/',
  '.nuxt/',
  'coverage/',
  '.turbo/',
  '.vercel/',
  '__pycache__/',
  '*.pyc',
  'target/',
  'vendor/',
];

// メディアファイル
const mediaFilePatterns = [
  '*.png',
  '*.jpg',
  '*.jpeg',
  '*.gif',
  '*.bmp',
  '*.ico',
  '*.svg',
  '*.webp',
  '*.mp4',
  '*.mov',
  '*.avi',
  '*.webm',
  '*.mp3',
  '*.wav',
  '*.flac',
  '*.ogg',
  '*.pdf',
];

// キャッシュ・一時ファイル
const cacheFilePatterns = [
  '.DS_Store',
  'Thumbs.db',
  '*.log',
  '*.tmp',
  '*.temp',
  '*.cache',
  '.eslintcache',
  '.stylelintcache',
  '.prettiercache',
  '*.swp',
  '*.swo',
  '*~',
];

// 圧縮ファイル
const archivePatterns = ['*.zip', '*.tar', '*.tar.gz', '*.tgz', '*.rar', '*.7z'];

// データベース・大容量データ
const dataPatterns = ['*.sql', '*.sqlite', '*.sqlite3', '*.db', '*.mdb'];

// 環境・秘密情報
const secretPatterns = ['.env', '.env.*', '*.pem', '*.key', '*.crt', 'credentials.json'];

export const getDefaultExcludePatterns = (): string[] => {
  return [
    ...buildArtifactPatterns,
    ...mediaFilePatterns,
    ...cacheFilePatterns,
    ...archivePatterns,
    ...dataPatterns,
    ...secretPatterns,
  ];
};

export const writeExcludePatterns = async (
  shadowGitPath: string,
  additionalPatterns: string[] = []
): Promise<void> => {
  const excludePath = path.join(shadowGitPath, '.git', 'info', 'exclude');
  const patterns = [...getDefaultExcludePatterns(), ...additionalPatterns];

  // .git/info ディレクトリが存在することを確認
  await fs.mkdir(path.dirname(excludePath), { recursive: true });
  await fs.writeFile(excludePath, patterns.join('\n') + '\n', 'utf-8');
};
