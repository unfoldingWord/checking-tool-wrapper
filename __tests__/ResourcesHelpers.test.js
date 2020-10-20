/* eslint-env jest */
import path from 'path';
import fs from 'fs-extra';
// helpers
import { getThelpsManifestRelation } from '../src/helpers/resourcesHelpers';
// constants
import {
  TRANSLATION_WORDS,
  TRANSLATION_NOTES,
  USER_RESOURCES_PATH,
} from '../src/common/constants';
jest.mock('fs-extra');



describe('getThelpsManifest()', () => {
  beforeEach(() => {
    // reset mock filesystem data
    fs.__resetMockFS();
  });

  it('getThelpsManifest should return null if manifest not found', () => {
    // given
    const glID = 'en';
    const toolName = TRANSLATION_WORDS;
    const expectedRelation = null;

    // when
    const tsvRelation = getThelpsManifestRelation(glID, toolName);

    // then
    expect(tsvRelation).toEqual(expectedRelation);
  });

  it('getThelpsManifest should return null if glID is empty', () => {
    // given
    const sourceResourcesPath = path.join( '__tests__/__fixtures__' );
    const copyResourceFiles = [TRANSLATION_WORDS];
    const destFolder = path.join(USER_RESOURCES_PATH, 'en', 'translationHelps');
    fs.__loadFilesIntoMockFs(copyResourceFiles, sourceResourcesPath, destFolder);
    const glID = '';
    const toolName = TRANSLATION_WORDS;
    const expectedRelation = null;

    // when
    const tsvRelation = getThelpsManifestRelation(glID, toolName);

    // then
    expect(tsvRelation).toEqual(expectedRelation);
  });

  it('getThelpsManifest should return null if tooName is empty', () => {
    // given
    const sourceResourcesPath = path.join( '__tests__/__fixtures__' );
    const copyResourceFiles = [TRANSLATION_WORDS];
    const destFolder = path.join(USER_RESOURCES_PATH, 'en', 'translationHelps');
    fs.__loadFilesIntoMockFs(copyResourceFiles, sourceResourcesPath, destFolder);
    const glID = 'en';
    const toolName = '';
    const expectedRelation = null;

    // when
    const tsvRelation = getThelpsManifestRelation(glID, toolName);

    // then
    expect(tsvRelation).toEqual(expectedRelation);
  });

  it('getThelpsManifest should work for TW', () => {
    // given
    const sourceResourcesPath = path.join( '__tests__/__fixtures__' );
    const copyResourceFiles = [TRANSLATION_WORDS];
    const destFolder = path.join(USER_RESOURCES_PATH, 'en', 'translationHelps');
    fs.__loadFilesIntoMockFs(copyResourceFiles, sourceResourcesPath, destFolder);
    const glID = 'en';
    const toolName = TRANSLATION_WORDS;
    const expectedRelation = [
      'en/ult',
      'en/ust',
      'en/obs',
      'en/tn',
      'en/tq',
    ];

    // when
    const tsvRelation = getThelpsManifestRelation(glID, toolName);

    // then
    expect(tsvRelation).toEqual(expectedRelation);
  });

  it('getThelpsManifest should work for TN', () => {
    // given
    const sourceResourcesPath = path.join( '__tests__/__fixtures__' );
    const copyResourceFiles = [TRANSLATION_NOTES];
    const destFolder = path.join(USER_RESOURCES_PATH, 'en', 'translationHelps');
    fs.__loadFilesIntoMockFs(copyResourceFiles, sourceResourcesPath, destFolder);
    const glID = 'en';
    const toolName = TRANSLATION_NOTES;
    const expectedRelation = [
      'en/ult',
      'en/ust',
    ];

    // when
    const tsvRelation = getThelpsManifestRelation(glID, toolName);

    // then
    expect(tsvRelation).toEqual(expectedRelation);
  });
});

//
// helpers
//

