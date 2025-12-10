export interface SnapshotMetadata {
  id: string;
  branchName: string;
  timestamp: Date;
  description: string;
  fullMessage?: string;
}

export interface ShadowRepoConfig {
  basePath: string;
  repoIdentifier: string;
  shadowRepoPath: string;
}

export type DiffFileStatus = 'added' | 'modified' | 'deleted';

export interface DiffFileInfo {
  file: string;
  status: DiffFileStatus;
  insertions: number;
  deletions: number;
}
