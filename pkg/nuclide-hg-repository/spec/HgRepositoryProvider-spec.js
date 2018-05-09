/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 * @format
 */

import {Directory} from 'atom';
import nuclideUri from 'nuclide-commons/nuclideUri';
import HgRepositoryProvider from '../lib/HgRepositoryProvider';
import invariant from 'assert';
import {runCommand} from 'nuclide-commons/process';
import {generateFixture} from 'nuclide-commons/test-helpers';
import fsPromise from 'nuclide-commons/fsPromise';

describe('HgRepositoryProvider', () => {
  const provider = new HgRepositoryProvider();
  it('shares underlying repository for multiple directories in the same repo', () => {
    waitsForPromise(async () => {
      const tempDir = await generateFixture(
        'hg_repo_provider_test',
        new Map([['folder/foo', 'foo']]),
      );

      const repoPath = await fsPromise.realpath(tempDir);
      await runCommand('hg', ['init'], {cwd: repoPath}).toPromise();

      const folderPath = nuclideUri.join(repoPath, 'folder');

      const baseDirectory = new Directory(repoPath);
      const folderDirectory = new Directory(folderPath);

      const baseRepo = provider.repositoryForDirectorySync(baseDirectory);
      const folderRepo = provider.repositoryForDirectorySync(folderDirectory);
      invariant(baseRepo != null && folderRepo != null);

      expect(baseRepo.getProjectDirectory()).not.toBe(
        folderRepo.getProjectDirectory(),
      );

      // compare private members to guarantee they have the same underlying HgRepositoryClient
      // arbitrarily chose _emitter
      expect(baseRepo._sharedMembers).toBe(folderRepo._sharedMembers);

      folderRepo.destroy();
      expect(folderRepo._sharedMembers.isDestroyed).toBe(false);
      expect(baseRepo._sharedMembers.isDestroyed).toBe(false);

      const folderRepo2 = provider.repositoryForDirectorySync(folderDirectory);
      invariant(folderRepo2 != null);
      expect(baseRepo._sharedMembers).toBe(folderRepo2._sharedMembers);

      folderRepo2.destroy();
      baseRepo.destroy();
      // refCount should hit 0 and remove the original underlying HgRepositoryClient
      expect(baseRepo._sharedMembers.isDestroyed).toBe(true);

      const baseRepo2 = provider.repositoryForDirectorySync(baseDirectory);
      invariant(baseRepo2 != null);
      expect(baseRepo._sharedMembers).not.toBe(baseRepo2._sharedMembers);
      expect(baseRepo.getProjectDirectory()).toBe(
        baseRepo2.getProjectDirectory(),
      );

      baseRepo2.destroy();

      await fsPromise.rimraf(repoPath);
    });
  });
});
