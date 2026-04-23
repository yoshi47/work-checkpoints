import * as fs from 'fs/promises';
import * as path from 'path';

export interface WorkCheckpointsConfig {
  messageFormat?: string;
  dateFormat?: string;
  ignorePatterns?: string[];
  retentionDays?: number;
}

const DEFAULTS: Required<WorkCheckpointsConfig> = {
  messageFormat: '${branch} @ ${date}',
  dateFormat: 'yyyy/MM/dd HH:mm:ss',
  ignorePatterns: [],
  retentionDays: 0,
};

const getConfigFilePath = (shadowRepoPath: string): string =>
  path.join(shadowRepoPath, 'config.json');

const validateParsed = (raw: unknown): WorkCheckpointsConfig => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: WorkCheckpointsConfig = {};
  if (typeof r.messageFormat === 'string') out.messageFormat = r.messageFormat;
  if (typeof r.dateFormat === 'string') out.dateFormat = r.dateFormat;
  if (Array.isArray(r.ignorePatterns) && r.ignorePatterns.every((x) => typeof x === 'string')) {
    out.ignorePatterns = r.ignorePatterns as string[];
  }
  if (typeof r.retentionDays === 'number' && Number.isInteger(r.retentionDays) && r.retentionDays >= 0) {
    out.retentionDays = r.retentionDays;
  }
  return out;
};

export const readConfigFile = async (shadowRepoPath: string): Promise<Required<WorkCheckpointsConfig>> => {
  const filePath = getConfigFilePath(shadowRepoPath);
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[work-checkpoints] Failed to read config file ${filePath}:`, error);
    }
    return { ...DEFAULTS };
  }
  try {
    const parsed = JSON.parse(content);
    return { ...DEFAULTS, ...validateParsed(parsed) };
  } catch (error) {
    console.error('[work-checkpoints] config.json has invalid JSON, using defaults:', error);
    return { ...DEFAULTS };
  }
};

export const writeConfigFile = async (
  shadowRepoPath: string,
  config: WorkCheckpointsConfig
): Promise<void> => {
  const filtered: Record<string, unknown> = {};

  if (config.messageFormat !== undefined && config.messageFormat !== DEFAULTS.messageFormat) {
    filtered.messageFormat = config.messageFormat;
  }
  if (config.dateFormat !== undefined && config.dateFormat !== DEFAULTS.dateFormat) {
    filtered.dateFormat = config.dateFormat;
  }
  if (config.ignorePatterns !== undefined && config.ignorePatterns.length > 0) {
    filtered.ignorePatterns = config.ignorePatterns;
  }
  if (config.retentionDays !== undefined && config.retentionDays !== DEFAULTS.retentionDays) {
    filtered.retentionDays = config.retentionDays;
  }

  const filePath = getConfigFilePath(shadowRepoPath);
  const content = JSON.stringify(filtered, null, 2) + '\n';

  // Write to temp file then rename for atomicity
  const tmpPath = filePath + '.tmp';
  await fs.writeFile(tmpPath, content, 'utf-8');
  await fs.rename(tmpPath, filePath);
};
