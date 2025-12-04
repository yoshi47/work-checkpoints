import * as os from 'os';
import * as path from 'path';

export const SHADOW_REPO_BASE_PATH = path.join(os.homedir(), '.work-checkpoints');
export const SNAPSHOT_BRANCH_NAME = 'main';
