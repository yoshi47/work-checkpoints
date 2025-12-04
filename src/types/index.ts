export interface SnapshotMetadata {
  id: string;
  branchName: string;
  timestamp: Date;
  description: string;
}

export interface ShadowRepoConfig {
  basePath: string;
  repoIdentifier: string;
  shadowRepoPath: string;
}
