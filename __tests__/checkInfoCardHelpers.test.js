/* eslint-env jest */
import { getNote } from '../src/helpers/checkInfoCardHelpers';


describe.only('checkInfoCardHelpers Tests', () => {
  it('Test checkInfoCardHelpers.getNote() to remove (See: ...)', () => {
    // given
    const occurrenceNote = 'Paul speaks of God’s message as if it were an object (not abstract) ([Titus 2:11](rc://en/ult/book/tit/02/11)) that could be visibly shown to people. Alternate translation: “He caused me to understand his message” (See: [Idiom](rc://en/ta/man/translate/figs-idiom), [[rc://some/unknown/link]] and [Metaphor](rc://en/ta/man/translate/figs-metaphor)) ';
    const expectedNote = 'Paul speaks of God’s message as if it were an object (not abstract) ([Titus 2:11](rc://en/ult/book/tit/02/11)) that could be visibly shown to people. Alternate translation: “He caused me to understand his message”';

    // when
    const note = getNote(occurrenceNote);

    // then
    expect(note).toEqual(expectedNote);
  });

  it('Test CheckInfoCardWrapper.getNote() where Bible verse at the end does NOT get removed, nothing should change', () => {
    // given
    const occurrenceNote = 'Paul said this in another verse ([Titus 1:5](rc://en/ult/book/tit/01/05))';

    // when
    const note = getNote(occurrenceNote);

    // then
    expect(note).toEqual(occurrenceNote);
  });

  it('Test CheckInfoCardWrapper.getNote() with Markdown', () => {
    // given
    const occurrenceNote = 'both **empty talkers** and **deceivers** refer to the same people. They taught false, worthless things and wanted people to believe them. (See: [[rc://en/ta/man/translate/figs-hendiadys]])';
    const expectedNote = 'both <strong>empty talkers</strong> and <strong>deceivers</strong> refer to the same people. They taught false, worthless things and wanted people to believe them.';

    // when
    const note = getNote(occurrenceNote);

    // then
    expect(note).toEqual(expectedNote);
  });
});
