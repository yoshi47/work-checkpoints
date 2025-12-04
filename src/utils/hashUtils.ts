import * as crypto from 'crypto';

export const generateRepoIdentifier = (remoteUrl: string | null, gitRoot: string): string => {
  const source = remoteUrl ?? gitRoot;
  return crypto.createHash('sha256').update(source).digest('hex').substring(0, 12);
};
