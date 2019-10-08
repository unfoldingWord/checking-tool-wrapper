/* eslint-env jest */
import React from 'react';
import { connect ,Provider } from 'react-redux';
import renderer from 'react-test-renderer';
import {
  shallow, mount, render,
} from 'enzyme';
import configureMockStore from 'redux-mock-store';
import thunk from 'redux-thunk';

import toJson from 'enzyme-to-json';
// containers
import PlainContainer, { mapStateToProps } from '../src/Container';
import TranslationHelpsContainer from '../src/components/TranslationHelpsWrapper';
import { getNote } from '../src/helpers/checkInfoCardHelpers';

const Container = connect(mapStateToProps)(PlainContainer);

const middlewares = [thunk];

describe.only('checkInfoCardHelpers Tests', () => {
  it('Test checkInfoCardHelpers.getNote() to remove (See: ...)', () => {
    const occurrenceNote = 'Paul speaks of God’s message as if it were an object (not abstract) ([Titus 2:11](rc://en/ult/book/tit/02/11)) that could be visibly shown to people. Alternate translation: “He caused me to understand his message” (See: [Idiom](rc://en/ta/man/translate/figs-idiom), [[rc://some/unknown/link]] and [Metaphor](rc://en/ta/man/translate/figs-metaphor)) ';
    const note = getNote(occurrenceNote);
    const expectedNote = 'Paul speaks of God’s message as if it were an object (not abstract) ([Titus 2:11](rc://en/ult/book/tit/02/11)) that could be visibly shown to people. Alternate translation: “He caused me to understand his message”';
    expect(note).toEqual(expectedNote);
  });

  it('Test CheckInfoCardWrapper.getNote() where Bible verse at the end does NOT get removed, nothing should change', () => {
    const occurrenceNote = 'Paul said this in another verse ([Titus 1:5](rc://en/ult/book/tit/01/05))';
    const note = getNote(occurrenceNote);
    expect(note).toEqual(occurrenceNote);
  });
});
