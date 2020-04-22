/* eslint-env jest */
import { getNote } from '../src/helpers/checkInfoCardHelpers';


describe.only('checkInfoCardHelpers Tests', () => {
  describe('getNote', () => {
    it('calls the custom link renderer' ,() => {
      const note = 'This is a note [Title](/link)';
      const renderedNote = 'This is a note [Title](/link)';
      const spy = jest.fn();
      const newNote = getNote(note, spy);
      expect(spy).toBeCalledWith({ href: '/link', title: 'Title' });
      expect(newNote).toEqual(renderedNote);
    });

    it('re-writes a link' ,() => {
      const note = 'This is a note [Title](/link)';
      const renderedNote = 'This is a note [Custom Title](custom/href)';

      const linkRenderer = function () {
        return {
          href: 'custom/href',
          title: 'Custom Title',
        };
      };
      expect(getNote(note, linkRenderer)).toEqual(renderedNote);
    });

    it('converts nameless links to named links' ,() => {
      const note = 'This is a note [[some/link]]';
      const renderedNote = 'This is a note [some/link](some/link)';
      const newNote = getNote(note);
      expect(newNote).toEqual(renderedNote);
    });
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
    const expectedNote = 'both <strong>empty talkers</strong> and <strong>deceivers</strong> refer to the same people. They taught false, worthless things and wanted people to believe them. (See: [rc://en/ta/man/translate/figs-hendiadys](rc://en/ta/man/translate/figs-hendiadys))';

    // when
    const note = getNote(occurrenceNote);

    // then
    expect(note).toEqual(expectedNote);
  });
});
