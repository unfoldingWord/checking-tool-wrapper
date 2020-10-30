/* eslint-disable quotes,object-curly-newline */
/* eslint-env jest */

import { TRANSLATION_WORDS } from '../src/common/constants';
import Api from '../src/Api';

jest.mock('../src/helpers/validationHelpers', () => ({
  ...require.requireActual('../src/helpers/validationHelpers'),
  getSelectionsFromChapterAndVerseCombo: () => require('./__fixtures__/selectionObject.json'),
}));

jest.mock('fs-extra', () => ({ outputJSONSync: jest.fn() }));

describe('api.validateBook', () => {
  const projectPath = 'users/john/translationCore/projects/my_en_project';

  it('should find that a verse has invalidated checks', () => {
    const props = {
      tool: {
        name: TRANSLATION_WORDS,
        translate: key => key,
      },
      tc: {
        bookId: 'tit',
        targetBook: { '2': { '12': 'It trains us, so that, rejecting asjfdas and worldly passions, we might live in a self-controlled and righteous and godly way in the present age, ' } },
        contextId: { reference: { bookId: 'tit' } },
        username: 'royalsix',
        project: {
          _projectPath: projectPath,
          getGroupData: jest.fn(() => {}),
          getCategoryGroupIds: jest.fn(() => {}),
        },
        showIgnorableDialog: jest.fn(() => {}),
      },
      contextId: { reference: { bookId: 'tit' } },
      changeSelections: jest.fn(() => {}),
    };
    const state = {
      tool: {
        groupsDataReducer: {
          groupsData: {
            accuse:
              [{
                'priority': 1, 'comments': false, 'reminders': false, 'selections': [{
                  'text': 'godlessness ', 'occurrence': 1, 'occurrences': 1,
                }], 'verseEdits': false, 'contextId': {
                  'reference': {
                    'bookId': 'tit', 'chapter': 2, 'verse': 12,
                  }, 'tool': TRANSLATION_WORDS, 'groupId': 'age', 'quote': 'αἰῶνι', 'strong': ['G01650'], 'occurrence': 1,
                }, 'invalidated': false,
              }],
          },
          loadedFromFileSystem: true,
        },
      },
    };
    const api = new Api();
    api.props = props;
    api.context = {
      store: {
        getState: jest.fn(() => (state)),
      },
    };
    api.validateBook();
    // expect(props.tc.showIgnorableDialog).toHaveBeenCalled();
    expect(api.props.changeSelections).toHaveBeenCalledWith(
      // eslint-disable-next-line quotes
      [], true, {
        "groupId": "accuse",
        "occurrence": 1,
        "quote": "κατηγορίᾳ",
        "reference": { "bookId": "tit", "chapter": 1, "verse": 6 },
        "strong": ["G27240"],
        "tool": "translationWords",
      },
      null,
      false,
      "royalsix",
      "translationWords",
      undefined,
      "κατηγορίᾳ",
      "users/john/translationCore/projects/my_en_project",
    );
  });
});


describe('load check data', () => {
  it('returns older data in favor of context match', () => {
    const api = new Api();
    const contextId = {
      reference: {
        bookId: 'tit', chapter: 1, verse: 1,
      },
      checkId: '2fd8',
      groupId: 'figs_metaphor',
      quote: 'that he put before them',
      occurrence: 1,
    };
    const project = {
      dataPathExistsSync: jest.fn(),
      readDataDirSync: jest.fn(),
      readDataFileSync: jest.fn(),
    };

    api.props = { tc: { project } };

    project.dataPathExistsSync.mockReturnValueOnce(true);
    project.readDataDirSync.mockReturnValueOnce(
      ['2018-12-18T21_28_18.837Z.json', '2019-01-10T03_59_47.588Z.json']);
    project.readDataFileSync.mockReturnValueOnce(
      JSON.stringify(
        {
          contextId: {
            groupId: 'hmmm', quote: 'hello', occurrence: 2,
          },
        }));
    project.readDataFileSync.mockReturnValueOnce(
      JSON.stringify(
        {
          contextId: {
            groupId: 'figs_metaphor',
            quote: 'that he put before them',
            occurrence: 1,
          },
        }));

    const data = api._loadCheckData('invalidated', contextId);
    expect(data).toMatchSnapshot();
    expect(project.readDataFileSync.mock.calls[0]).
      toEqual(
        ['checkData/invalidated/tit/1/1/2fd8/2019-01-10T03_59_47.588Z.json']);
  });

  it('returns latest data in favor of context match', () => {
    const api = new Api();
    const contextId = {
      reference: {
        bookId: 'tit', chapter: 1, verse: 1,
      },
      checkId: '2fd8',
      groupId: 'figs_metaphor',
      quote: 'that he put before them',
      occurrence: 1,
    };
    const project = {
      dataPathExistsSync: jest.fn(),
      readDataDirSync: jest.fn(),
      readDataFileSync: jest.fn(),
    };

    api.props = { tc: { project } };

    project.dataPathExistsSync.mockReturnValueOnce(true);
    project.readDataDirSync.mockReturnValueOnce(
      ['2018-12-18T21_28_18.837Z.json', '2019-01-10T03_59_47.588Z.json']);
    project.readDataFileSync.mockReturnValueOnce(
      JSON.stringify(
        {
          contextId: {
            groupId: 'figs_metaphor',
            quote: 'that he put before them',
            occurrence: 1,
          },
        }));
    project.readDataFileSync.mockReturnValueOnce(
      JSON.stringify(
        {
          contextId: {
            groupId: 'hmmm', quote: 'hello', occurrence: 2,
          },
        }));

    const data = api._loadCheckData('invalidated', contextId);
    expect(data).toMatchSnapshot();
    expect(project.readDataFileSync.mock.calls[0]).
      toEqual(
        ['checkData/invalidated/tit/1/1/2fd8/2019-01-10T03_59_47.588Z.json']);
  });
});

describe('alignment memory', () => {
  it('returns the alignment memory', () => {
    const api = new Api();

    api._loadBookSelections = jest.fn(() => ({
      '1': {
        '1': [
          {
            contextId: { quote: 'hello' },
            selections: [
              { text: 'world' },
            ],
          },
        ],
      },
    }));

    const memory = api.getAlignmentMemory();

    expect(memory).toEqual([
      {
        sourceText: 'hello',
        targetText: 'world',
      },
    ]);
  });
});

describe('selection data', () => {
  it('loads selection data from the disk', () => {
    // Replicates the file reader
    function* dataGenerator() {
      const data2 = JSON.stringify({
        contextId: {
          groupId: 'word',
          quote: 'hi',
        },
        selections: [
          { text: 'world' },
        ],
      });

      const data1 = JSON.stringify({
        contextId: {
          groupId: 'word',
          quote: 'hello',
        },
        selections: [
          { text: 'world' },
        ],
      });
      // TRICKY: files will be sorted in ascending order
      yield data2;
      yield data1;
      yield data1;
    }

    const api = new Api();
    const generator = dataGenerator();
    const props = {
      tc: {
        bookId: 'book',
        contextId: {
          reference: {
            bookId: 'book', chapter: 1, verse: 1,
          },
        },
        projectDataPathExistsSync: jest.fn(() => true),
        readProjectDataSync: jest.fn(() => generator.next().value),
        readProjectDataDirSync: jest.fn(() => ['1.json', '1_dup.json', '2.json']),
        targetBook: { '1': { '1': {} } },
      },
      contextId: {
        reference: {
          bookId: 'book', chapter: 1, verse: 1,
        },
      },
    };
    const selections = api._loadBookSelections(props);

    expect(selections).toEqual({
      '1': {
        '1': [
          {
            contextId: {
              groupId: 'word',
              quote: 'hi',
            },
            selections: [
              { text: 'world' },
            ],
          },
          {
            contextId: {
              groupId: 'word',
              quote: 'hello',
            },
            selections: [
              { text: 'world' },
            ],
          },
        ],
      },
    });
  });
});
