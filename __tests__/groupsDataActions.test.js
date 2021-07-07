/* eslint-env jest */
// helpers
import { readLatestChecks } from '../src/state/actions/groupsDataActions';

jest.unmock('fs-extra');

describe('readLatestChecks', () => {
  test('make sure new checks with checkId supersede older checks without checkId\'s - invalidations', () => {
    // given
    const testFolder = './__tests__/__fixtures__/invalidation/hasCheckIds';
    const expectedLen = 6;

    // when
    const latestChecks = readLatestChecks(testFolder);

    // then
    expect(latestChecks.length).toEqual(expectedLen);
    expect(latestChecks).toMatchSnapshot();
  });

  test('make sure newer checks without checkId supersede older checks without checkId\'s - invalidations', () => {
    // given
    const testFolder = './__tests__/__fixtures__/invalidation/noCheckIds';
    const expectedLen = 6;

    // when
    const latestChecks = readLatestChecks(testFolder);

    // then
    expect(latestChecks.length).toEqual(expectedLen);
    expect(latestChecks).toMatchSnapshot();
  });
});
