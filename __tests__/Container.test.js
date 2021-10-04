/* eslint-env jest */
import React from 'react';
import { Provider } from 'react-redux';
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

const middlewares = [thunk];
const mockStore = configureMockStore(middlewares);

const basicProps = require('./__fixtures__/basicProps.json');
const toolProps = require('./__fixtures__/toolProps.json');
const props = {
  ...basicProps,
  translate: k => k,
  tc: {
    ...basicProps.tc,
    project: { getBookName: () => () => 'gen' },
    showPopover: jest.fn(),
    editTargetVerse: jest.fn(),
    getLexiconData: jest.fn(),
    setToolSettings: jest.fn(),
    loadResourceArticle: jest.fn(),
    setFilter: jest.fn(),
    changeSelections: jest.fn(),
    goToNext: jest.fn(),
    goToPrevious: jest.fn(),
    onInvalidCheck: jest.fn(),
    readProjectDataSync: jest.fn(),
  },
};

const store = mockStore(toolProps);

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
      contextId: null,
    };
    const wrapper = render(
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
