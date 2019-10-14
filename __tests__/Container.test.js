/* eslint-env jest */
import React from 'react';
import { Provider } from 'react-redux';
import renderer from 'react-test-renderer';
import {
  shallow,
  render,
} from 'enzyme';
import configureMockStore from 'redux-mock-store';
import thunk from 'redux-thunk';

import toJson from 'enzyme-to-json';
// containers
import Container from '../src/Container';
import TranslationHelpsContainer from '../src/components/TranslationHelpsWrapper';
import CheckInfoCardWrapper from '../src/components/CheckInfoCardWrapper';

const middlewares = [thunk];
const mockStore = configureMockStore(middlewares);

const basicProps = require('./__fixtures__/basicProps.json');
const props = {
  ...basicProps,
  translate: k => k,
  tc: {
    ...basicProps.tc,
    project: { getBookName: () => () => 'gen' },
  },
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
  getSelectionsFromContextId: () => '',
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
      contextIdReducer: { contextId: null },
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

  it('Test TranslationHelpsContainer', () => {
    const root = render(
      <Provider store={store}>
        <Container {...props} />
      </Provider>)
      .find(TranslationHelpsContainer);
    expect(root).toBeTruthy();
  });
});
