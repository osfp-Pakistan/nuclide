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

import invariant from 'assert';
import fs from 'fs';
import nuclideUri from 'nuclide-commons/nuclideUri';
import {_getReferences} from '../lib/PythonService';
import {getDefinition} from '../lib/DefinitionHelpers';
import {getCompletions} from '../lib/AutocompleteHelpers';
import JediServerManager from '../lib/JediServerManager';
import TextBuffer from 'simple-text-buffer';
import {Point} from 'simple-text-buffer';

jest.setTimeout(20000);

// make sure we don't save absolute paths in snapshots
const replacePath = str => str.replace(/.*__mocks__/, '<REPLACED>/__mocks__');

// Test python file located at fixtures/serverdummy.py
const TEST_FILE = nuclideUri.join(
  __dirname,
  '../__mocks__/fixtures',
  'serverdummy.py',
);
const FILE_CONTENTS = fs.readFileSync(TEST_FILE).toString('utf8');

// Disable buckd so it doesn't linger around after the test.
process.env.NO_BUCKD = '1';

function bufferOfContents(contents: string): simpleTextBuffer$TextBuffer {
  return new TextBuffer(contents);
}

// Line/column actual offsets are 0-indexed in this test, similar to what atom
// provides as input.
describe('PythonService', () => {
  let serverManager: JediServerManager = (null: any);

  beforeEach(function() {
    serverManager = new JediServerManager();
    // Don't try to retrieve additional paths from Buck/etc.
    jest.spyOn(serverManager, 'getSysPath').mockReturnValue([]);
  });

  afterEach(() => {
    serverManager.reset();
    serverManager = (null: any);
  });

  describe('Completions', () => {
    it('gives a rejected promise when an invalid request is given', async () => {
      // Basically everything is wrong here, but politely reject the promise.
      try {
        await getCompletions(serverManager, 'potato', 'tomato', 6, 15);
        // Fail - this line should not be reachable.
        invariant(false);
      } catch (e) {
        // Python process should respond with a Traceback for what went wrong while
        // processing the request.
        expect(e.startsWith('Traceback')).toBeTruthy();
      }
    });

    it('can make completion suggestions for imported module member functions', async () => {
      // line 12: def hello = os.path.isab
      const response = await getCompletions(
        serverManager,
        TEST_FILE,
        FILE_CONTENTS,
        11,
        20,
      );
      invariant(response);
      expect(response.length).toBeGreaterThan(0);

      const completion = response[0];
      expect(completion.text).toEqual('isabs');
      expect(completion.type).toEqual('function');
      // Check that description exists.
      expect(completion.description).toBeTruthy();
    });

    it('can make completion suggestions for locally defined variables', async () => {
      // line 14: potato2 = po
      const response = await getCompletions(
        serverManager,
        TEST_FILE,
        FILE_CONTENTS,
        13,
        12,
      );
      invariant(response);
      expect(response.length).toBeGreaterThan(0);

      const completion = response[0];
      expect(completion.text).toEqual('potato');
      expect(completion.type).toEqual('statement');
    });

    it('does not return params for @property methods', async () => {
      // line 18: a.t
      const response = await getCompletions(
        serverManager,
        TEST_FILE,
        FILE_CONTENTS,
        17,
        3,
      );
      invariant(response);
      expect(response.length).toBeGreaterThan(0);

      const completion = response[0];
      expect(completion.text).toEqual('test');
      expect(completion.type).toEqual('function');
      expect(completion.params).toBeFalsy();
    });

    it('includes parameters for assignment completions', async () => {
      // line 26: a = Tes
      const response = await getCompletions(
        serverManager,
        TEST_FILE,
        FILE_CONTENTS,
        25,
        7,
      );
      invariant(response);
      expect(response.length).toBeGreaterThan(0);

      const completion = response[0];
      expect(completion.text).toEqual('Test');
      expect(completion.type).toEqual('class');
      expect(completion.params).toEqual([]);
    });

    it('does not include parameters for import statement completions', async () => {
      // line 9: from decorated import Test
      const response = await getCompletions(
        serverManager,
        TEST_FILE,
        FILE_CONTENTS,
        8,
        26,
      );
      invariant(response);
      expect(response.length).toBeGreaterThan(0);

      const completion = response[0];
      expect(completion.text).toEqual('Test');
      expect(completion.type).toEqual('class');
      expect(completion.params).toBeFalsy();
    });
  });

  describe('Definitions', () => {
    it('gives a rejected promise when an invalid request is given', async () => {
      // Basically everything is wrong here, but politely reject the promise.
      try {
        const service = await serverManager.getJediService();
        await service.get_definitions('potato', 'tomato', [], 6, 15);
        // Fail - this line should not be reachable.
        invariant(false);
      } catch (e) {
        // Python process should respond with a Traceback for what went wrong while
        // processing the request.
        expect(e.startsWith('Traceback')).toBeTruthy();
      }
    });

    it('can find definitions for imported modules', async () => {
      // line 9: import os
      const response = await getDefinition(
        serverManager,
        TEST_FILE,
        bufferOfContents(FILE_CONTENTS),
        new Point(7, 8),
      );
      invariant(response != null);
      expect(response.definitions.length).toBeGreaterThan(0);

      const definition = response.definitions[0];
      expect(definition.name).toEqual('os');
      // Path is machine dependent, so just check that it exists and isn't empty.
      expect(definition.path.length).toBeGreaterThan(0);
    });

    it('follows imports until a non-import definition when possible', async () => {
      // line 17: a = Test()
      const response = await getDefinition(
        serverManager,
        TEST_FILE,
        bufferOfContents(FILE_CONTENTS),
        new Point(16, 7),
      );
      invariant(response != null);
      expect(response.definitions.length).toBeGreaterThan(0);

      const definition = response.definitions[0];
      expect(definition.name).toEqual('Test');
      // Result should be the class definition itself, not the import statement.
      expect(definition.path).toContain('decorated.py');
      expect(definition.position.row).toEqual(9);
      expect(definition.position.column).toEqual(6);
    });

    it('does not follow unresolvable imports', async () => {
      // line 27: b = Test2()
      const response = await getDefinition(
        serverManager,
        TEST_FILE,
        bufferOfContents(FILE_CONTENTS),
        new Point(26, 7),
      );
      expect(response).toBe(null);
    });

    it('can find the definitions of locally defined variables', async () => {
      // line 15: potato3 = potato
      const response = await getDefinition(
        serverManager,
        TEST_FILE,
        bufferOfContents(FILE_CONTENTS),
        new Point(14, 12),
      );
      invariant(response != null);
      expect(response.definitions.length).toBeGreaterThan(0);

      const definition = response.definitions[0];
      expect(definition.name).toEqual('potato');
      expect(definition.position.row).toEqual(12);
      // Local variable definition should be within the same file.
      expect(definition.path).toEqual(TEST_FILE);
    });
  });

  describe('References', () => {
    it('can find the references of locally defined variables', async () => {
      // line 13: potato = 5
      const response = await _getReferences(
        serverManager,
        TEST_FILE,
        FILE_CONTENTS,
        12,
        2,
      );
      invariant(response);

      expect(response).toEqual([
        {
          type: 'statement',
          text: 'potato',
          file: TEST_FILE,
          line: 12,
          column: 0,
        },
        {
          type: 'statement',
          text: 'potato',
          file: TEST_FILE,
          line: 14,
          column: 10,
        },
      ]);
    });

    it('can find the references of imported modules', async () => {
      // line 29: import decorated
      const response = await _getReferences(
        serverManager,
        TEST_FILE,
        FILE_CONTENTS,
        28,
        8,
      );
      invariant(response);

      expect(
        response.map(o => {
          o.file = replacePath(o.file);
          return o;
        }),
      ).toMatchSnapshot();
    });

    it('displays the caller name for references within functions', async () => {
      // line 13: potato = 5
      const response = await _getReferences(
        serverManager,
        TEST_FILE,
        FILE_CONTENTS,
        19,
        2,
      );
      invariant(response);

      expect(
        response.map(o => {
          o.file = replacePath(o.file);
          return o;
        }),
      ).toMatchSnapshot();
    });
  });

  describe('Outlines', () => {
    async function getOutline(src, contents) {
      const service = await serverManager.getJediService();
      return service.get_outline(src, contents);
    }

    async function checkOutlineTree(testName: string) {
      const dirName = nuclideUri.join(
        __dirname,
        '../__mocks__/fixtures',
        'outline-tests',
      );

      const srcPath = nuclideUri.join(dirName, testName + '.py');
      const srcContents = fs.readFileSync(srcPath).toString('utf8');

      const response = await getOutline(srcPath, srcContents);
      expect(response).toMatchSnapshot();
    }

    it('can generate an outline for a basic python script', async () => {
      await checkOutlineTree('1');
    });

    it('can generate an outline when minor syntax errors exist', async () => {
      await checkOutlineTree('2');
    });

    it('can generate an outline when decorated functions are present', async () => {
      await checkOutlineTree('3');
    });

    it('properly includes multiple assignments in the outline', async () => {
      await checkOutlineTree('4');
    });

    it('works with Python 3 features', async () => {
      await checkOutlineTree('5');
    });
  });

  describe('Module Resolution', () => {
    it('can resolve imports that are relative to the top-level module', async () => {
      const projectFile = nuclideUri.join(
        __dirname,
        '../__mocks__/fixtures/test-project/testdir/lib/test2.py',
      );
      const src = fs.readFileSync(projectFile).toString('utf8');

      // Test completion of a module name relative to the tlm.
      let response;
      // Top-level module path may take some (short) amount of time to be
      // found and added to paths.
      while (response == null || response.length === 0) {
        // line 7: from potato import h
        // eslint-disable-next-line no-await-in-loop
        response = await getCompletions(serverManager, projectFile, src, 6, 28);
      }

      invariant(response);
      const completion = response[0];
      expect(completion.text).toEqual('hello_world');
      expect(completion.type).toEqual('function');
    });
  });

  describe('Hover', () => {
    it('displays the docblock for a definition', async () => {
      const service = await serverManager.getJediService();
      const response = await service.get_hover(
        TEST_FILE,
        FILE_CONTENTS,
        [],
        'Test',
        30,
        16,
      );
      invariant(response != null);
      expect(response).toBe('This is a \\*test class.');
    });
  });
});
