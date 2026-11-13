/* eslint-env jest */
import fs from 'fs-extra';
import path from 'path-extra';
import { readHelpsFolder } from '../src/helpers/fileHelpers';

const BIBLE_FOLDER = path.join('resources', 'en', 'bibles', 'ult', 'v91_unfoldingWord');

describe('readHelpsFolder', () => {
  beforeEach(() => {
    fs.__resetMockFS();
  });

  test('reads the JSON files of a folder', () => {
    const bookFolder = path.join(BIBLE_FOLDER, 'tit');
    fs.outputJsonSync(path.join(bookFolder, '1.json'), { 1: 'verse one' });

    expect(readHelpsFolder(bookFolder)).toEqual({ 1: { 1: 'verse one' } });
  });

  test('returns null for a folder that does not exist', () => {
    expect(readHelpsFolder(path.join(BIBLE_FOLDER, 'gal'))).toBeNull();
  });

  test('returns null for a file', () => {
    const file = path.join(BIBLE_FOLDER, 'manifest.json');
    fs.outputJsonSync(file, { id: 'ult' });

    expect(readHelpsFolder(file)).toBeNull();
  });

  test('returns null for an empty path', () => {
    expect(readHelpsFolder('')).toBeNull();
    expect(readHelpsFolder(undefined)).toBeNull();
  });

  test('leaves out a groups folder that has no folder for the filtered book', () => {
    const helpsFolder = path.join('resources', 'en', 'translationHelps', 'translationWords', 'v90_unfoldingWord', 'kt');
    fs.outputJsonSync(path.join(helpsFolder, 'groups', 'tit', 'faith.json'), [{ id: 'faith' }]);

    expect(readHelpsFolder(helpsFolder, 'tit')).toEqual({ groups: { faith: [{ id: 'faith' }] } });
    expect(readHelpsFolder(helpsFolder, 'gal')).toEqual({});
  });
});
