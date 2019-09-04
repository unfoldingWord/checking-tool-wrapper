/* eslint-env jest */
import React from 'react';
import {connect} from 'react-redux';
import renderer from 'react-test-renderer';
import {shallow, mount, render} from 'enzyme';
import configureMockStore from 'redux-mock-store';
import thunk from 'redux-thunk';
import {Provider} from 'react-redux';
import toJson from 'enzyme-to-json';
// containers
import PlainContainer, { mapStateToProps } from '../src/Container';
import TranslationHelpsContainer from '../src/components/TranslationHelpsWrapper';
import CheckInfoCardWrapper from '../src/components/CheckInfoCardWrapper';
import {TRANSLATION_WORDS} from "../src/helpers/consts";

const Container = connect(mapStateToProps)(PlainContainer);

const middlewares = [thunk];
const mockStore = configureMockStore(middlewares);

const basicProps = require('./__fixtures__/basicProps.json');
const props = {
  ...basicProps,
  translate: k => k,
  tc: {
    ...basicProps.tc,
    project: {
      getBookName: () => () => "gen"
    }
  }
};

props.tc.actions = {
  showPopover: jest.fn(),
  editTargetVerse: jest.fn(),
  getLexiconData: jest.fn(),
  setToolSettings: jest.fn(),
  loadResourceArticle: jest.fn(),
  getGLQuote: jest.fn(),
  setFilter: jest.fn(),
  changeSelections: jest.fn(),
  goToNext: jest.fn(),
  goToPrevious: jest.fn(),
  getAvailableScripturePaneSelections: jest.fn(),
  makeSureBiblesLoadedForTool: jest.fn(),
  groupMenuChangeGroup: jest.fn(),
  groupMenuExpandSubMenu: jest.fn(),
  onInvalidCheck: jest.fn(),
  getSelectionsFromContextId: () => ''
};

const store = mockStore({});
describe.only('Container Tests', () => {
  it('Test Container', () => {
    const wrapper = render(
        <Provider store={store}>
          <Container {...props} />
        </Provider>
    );
    expect(toJson(wrapper)).toMatchSnapshot();
  });

  it('Test empty Container', () => {
    const myProps = {
      ...props,
      contextIdReducer: {
        contextId: null
      }
    };
    const wrapper = renderer.create(
        <Provider store={store}>
          <Container {...myProps} />
        </Provider>
    );
    expect(toJson(wrapper)).toMatchSnapshot();
  });

  it('Test has ScripturePane Panes', () => {
    const container = render(
      <Provider store={store}>
        <Container {...props} />
      </Provider>)
      //wierd stuff to get the inner component
      .find('.panes-container').children().length;
    expect(container).toBe(4);
  });

  it('Test does not have ScripturePane', () => {
    props.tc.bibles = {};
    const container = shallow(
      <Provider store={store}>
        <Container {...props} />
      </Provider>)
      //wierd stuff to get the inner component
      .find('.panes-container').children().length;
    expect(container).toBe(0);
  });

  it('Test CheckInfoCardWrapper.getNote() to remove (See: ...)', () => {
    const props = {
      showHelps: true,
      toggleHelps: jest.fn(),
      groupsIndex: [{id: 'figs-metaphor', name: 'Metaphor'}],
      contextId: {
        groupId: 'figs-metaphor',
        occurrenceNote: 'Paul speaks of God’s message as if it were an object (not abstract) ([Titus 2:11](rc://en/ult/book/tit/02/11)) that could be visibly shown to people. Alternate translation: “He caused me to understand his message” (See: [Idiom](rc://en/ta/man/translate/figs-idiom), [[rc://some/unknown/link]] and [Metaphor](rc://en/ta/man/translate/figs-metaphor)) ',
        tool: 'translationNotes',
      },
      resourcesReducer: {},
      translate: k => k,
    }
    const checkInfoCardWrapper = shallow(<CheckInfoCardWrapper {...props} />);
    const note = checkInfoCardWrapper.instance().getNote(props.contextId.occurrenceNote);
    const expectedNote = 'Paul speaks of God’s message as if it were an object (not abstract) ([Titus 2:11](rc://en/ult/book/tit/02/11)) that could be visibly shown to people. Alternate translation: “He caused me to understand his message”';
    expect(note).toEqual(expectedNote);
  });

  it('Test CheckInfoCardWrapper.getNote() where Bible verse at the end does NOT get removed, nothing should change', () => {
    const props = {
      showHelps: true,
      toggleHelps: jest.fn(),
      groupsIndex: [{id: 'figs-metaphor', name: 'Metaphor'}],
      contextId: {
        groupId: 'figs-metaphor',
        occurrenceNote: 'Paul said this in another verse ([Titus 1:5](rc://en/ult/book/tit/01/05))',
        tool: 'translationNotes',
      },
      resourcesReducer: {},
      translate: k => k,
    }
    const checkInfoCardWrapper = shallow(<CheckInfoCardWrapper {...props} />);
    const note = checkInfoCardWrapper.instance().getNote(props.contextId.occurrenceNote);
    expect(note).toEqual(props.contextId.occurrenceNote);
  });
});
