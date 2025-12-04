import * as assert from 'assert';
import { generateRepoIdentifier } from '../../utils/hashUtils';

suite('hashUtils', () => {
  suite('generateRepoIdentifier', () => {
    test('should generate consistent hash for same remote URL', () => {
      const remoteUrl = 'https://github.com/user/repo.git';
      const gitRoot = '/path/to/repo';

      const hash1 = generateRepoIdentifier(remoteUrl, gitRoot);
      const hash2 = generateRepoIdentifier(remoteUrl, gitRoot);

      assert.strictEqual(hash1, hash2);
    });

    test('should use remote URL when provided', () => {
      const remoteUrl = 'https://github.com/user/repo.git';
      const gitRoot1 = '/path/to/repo1';
      const gitRoot2 = '/path/to/repo2';

      const hash1 = generateRepoIdentifier(remoteUrl, gitRoot1);
      const hash2 = generateRepoIdentifier(remoteUrl, gitRoot2);

      // Same remote URL should produce same hash regardless of git root
      assert.strictEqual(hash1, hash2);
    });

    test('should use git root when remote URL is null', () => {
      const gitRoot1 = '/path/to/repo1';
      const gitRoot2 = '/path/to/repo2';

      const hash1 = generateRepoIdentifier(null, gitRoot1);
      const hash2 = generateRepoIdentifier(null, gitRoot2);

      // Different git roots should produce different hashes
      assert.notStrictEqual(hash1, hash2);
    });

    test('should return 12-character hash', () => {
      const hash = generateRepoIdentifier('https://github.com/user/repo.git', '/path');

      assert.strictEqual(hash.length, 12);
    });

    test('should only contain hex characters', () => {
      const hash = generateRepoIdentifier('https://github.com/user/repo.git', '/path');

      assert.match(hash, /^[0-9a-f]+$/);
    });
  });
});
