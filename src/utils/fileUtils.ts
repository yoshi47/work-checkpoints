import * as fs from 'fs/promises';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';

export const createIgnoreFilter = async (gitRoot: string): Promise<Ignore> => {
  const ig = ignore();

  const gitignorePath = path.join(gitRoot, '.gitignore');
  try {
    const content = await fs.readFile(gitignorePath, 'utf-8');
    ig.add(content);
  } catch {
    // .gitignore doesn't exist, continue without it
  }

  // Always ignore .git directory
  ig.add('.git');

  return ig;
};

export const copyFileToShadowRepo = async (
  sourceRoot: string,
  relativePath: string,
  targetRoot: string
): Promise<void> => {
  const sourcePath = path.join(sourceRoot, relativePath);
  const targetPath = path.join(targetRoot, relativePath);

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
};

export const clearDirectory = async (dirPath: string, excludeGit = true): Promise<void> => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (excludeGit && entry.name === '.git') {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);
      await fs.rm(fullPath, { recursive: true, force: true });
    }
  } catch {
    // Directory doesn't exist, nothing to clear
  }
};

export const getAllFiles = async (
  dirPath: string,
  ig: Ignore,
  baseDir: string = dirPath
): Promise<string[]> => {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (ig.ignores(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        const subFiles = await getAllFiles(fullPath, ig, baseDir);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  } catch {
    // Directory doesn't exist or permission denied
  }

  return files;
};
