/* eslint-env jest */
import * as selectionHelpers from '../src/helpers/selectionHelpers';
import {DEFAULT_MAX_SELECTIONS, TN_MAX_SELECTIONS, TRANSLATION_NOTES, TRANSLATION_WORDS} from "../src/helpers/consts";

describe('selectionHelpers.getMaximumSelections', () => {
  test('Should set TN to max for TN', () => {
    // given
    const toolName = TRANSLATION_NOTES;
    const expectedResult = TN_MAX_SELECTIONS;

    // when
    const results = selectionHelpers.getMaximumSelections(toolName);

    // then
    expect(results).toEqual(expectedResult);
  });

  test('Should set TW to default max', () => {
    // given
    const toolName = TRANSLATION_WORDS;
    const expectedResult = DEFAULT_MAX_SELECTIONS;

    // when
    const results = selectionHelpers.getMaximumSelections(toolName);

    // then
    expect(results).toEqual(expectedResult);
  });

  test('Should any other tool to default max', () => {
    // given
    const toolName = null;
    const expectedResult = DEFAULT_MAX_SELECTIONS;

    // when
    const results = selectionHelpers.getMaximumSelections(toolName);

    // then
    expect(results).toEqual(expectedResult);
  });

});
