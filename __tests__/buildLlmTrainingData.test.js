/* eslint-env jest */
/**
 * Builds AI training data from the translationWords checks of a word-aligned translationCore
 * project. Writes `llmTrainingData/<project>_<glOwner>_<glLang>.json` (one file per
 * project) in the repo folder.
 *
 * Skipped unless `LLM_TRAINING_BUILD=1`, so `npm test` does not read the translationCore folder.
 * Run it with `npm run build:llm-training-data`, e.g.
 *   LLM_TRAINING_PROJECTS=es-419_glt_jon_book LLM_TRAINING_GL_OWNER=unfoldingWord \
 *     LLM_TRAINING_GL_LANG=en npm run build:llm-training-data
 *
 * For each project:
 *  - the checks are read from `.apps/translationCore/index/translationWords/<book>/<groupId>.json`,
 *    in the order of that file (the order of the group menu);
 *  - a check's correct answer is the target words the translator aligned to the check's
 *    original-language quote (from `.apps/translationCore/alignmentData/<book>/<chapter>.json`),
 *    in verse order, found by `getAlignedTargetWords` in `helpers/alignedTargetWords.js`. Checks
 *    whose quote is not aligned, or is aligned together with other original words, or whose
 *    answer is longer than `LLM_TRAINING_MAX_WORDS`, have no correct answer, so they are neither
 *    saved nor used as history. Selections saved in translationCore are not used;
 *  - only groups with more than `MIN_GROUP_CHECKS` checks that have a correct answer are saved;
 *  - the GL phrase is the GL bible text aligned to the check's quote, cleaned as the app cleans it
 *    (`getAlignedTextFromBible` and `cleanGlQuote`). The GL bible is the first bible of the
 *    gateway language, in `bibleIdSort` order, that has a version for the GL owner;
 *  - the history holds only the correct answers of the checks before it in the same group,
 *    tallied with the app's `getSelectionsForBook`: `{ glPhrase: { selectedText: count } }`. A
 *    check with an empty history (the first check of a group, or one whose earlier checks have no
 *    GL phrase) teaches nothing about using history, so it is not saved, but its answer is still
 *    history for the checks after it;
 *
 * Each entry has the fields of the `llmEval` cases (`id`, `targetLang`, `glLang`, `verse`,
 * `glPhrase`, `occurrence`, `history`, `expected`, `tags`, `madeUp`, `source`) plus `glOwner`,
 * `groupId`, `contextId` and `selections` (the correct answer in the form translationCore saves a
 * selection, one per word).
 *
 * Environment variables:
 *   LLM_TRAINING_BUILD      set to 1 to build
 *   LLM_TRAINING_PROJECTS   space-separated project folder names (required)
 *   LLM_TRAINING_GL_OWNER   GL organization, e.g. unfoldingWord (default: the project's
 *                           translationWords owner in its manifest)
 *   LLM_TRAINING_GL_LANG    GL language code, e.g. en (default: the project's translationWords
 *                           gateway language in its manifest)
 *   LLM_TRAINING_TC_HOME    translationCore folder (default ~/translationCore)
 *   LLM_TRAINING_OUT_DIR    output folder (default <repo>/llmTrainingData)
 *   LLM_TRAINING_MAX_WORDS  longest answer kept, in words (default: no limit)
 *
 * jest is used because it is the repo's only babel runner; Node's `fs` is used because
 * `fs-extra` is mocked globally.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { bibleIdSort, getAlignedTextFromBible } from '../src/helpers/gatewayLanguageHelpers';
import { cleanGlQuote, getSelectionsForBook } from '../src/utils/checkingSuggestionsUtils';
import { getAlignedTargetWords } from './helpers/alignedTargetWords';

const env = process.env;
const BUILD = env.LLM_TRAINING_BUILD === '1';
const TC_HOME = env.LLM_TRAINING_TC_HOME || path.join(os.homedir(), 'translationCore');
const PROJECTS = (env.LLM_TRAINING_PROJECTS || '').split(/\s+/).filter(Boolean);
const OUT_DIR = env.LLM_TRAINING_OUT_DIR || path.join(__dirname, '..', 'llmTrainingData');
const TOOL_NAME = 'translationWords';
/** a group is saved only when it has more checks with a correct answer than this */
const MIN_GROUP_CHECKS = 2;
/** longest answer kept, in words */
const MAX_WORDS = parseInt(env.LLM_TRAINING_MAX_WORDS, 10) || Infinity;

console.log('buildLlmTrainingData.test.js - environment data:', {
  BUILD,
  TC_HOME,
  PROJECTS,
  OUT_DIR,
});

const describeIfBuild = BUILD ? describe : describe.skip;

describeIfBuild('build llm training data', () => {
  test('LLM_TRAINING_PROJECTS is set', () => {
    expect(PROJECTS.length).toBeGreaterThan(0);
  });

  test.each(PROJECTS.map(name => [name]))('writes training data for %s', name => {
    const {
      file, entries, groups, total, answered,
    } = buildProject(name);
    console.log(`${name}: ${entries.length} checks from ${groups} groups written to ${path.relative(process.cwd(), file)}`);

    if (!entries.length) {
      throw new Error(answered ?
        `${name}: ${answered} of ${total} checks have aligned target words, but no group has more than ${MIN_GROUP_CHECKS} of them` :
        `${name}: none of ${total} ${TOOL_NAME} checks has aligned target words, so there is no training data (has the project been aligned?)`);
    }
  });
});

/**
 * Builds and writes the training data for one project.
 * @param {string} name - project folder name, e.g. 'es-419_glt_jon_book'
 * @returns {{file: string, entries: Array<object>, groups: number, total: number,
 *   answered: number}} - `total` checks in the project, `answered` with a correct answer
 */
function buildProject(name) {
  const projectPath = path.join(TC_HOME, 'projects', name);
  const manifest = readJson(path.join(projectPath, 'manifest.json'));
  const targetLang = manifest.target_language.id;
  const bookId = manifest.project.id;
  const glLang = env.LLM_TRAINING_GL_LANG || manifest.toolsSelectedGLs?.[TOOL_NAME];
  const glOwner = env.LLM_TRAINING_GL_OWNER || manifest.toolsSelectedOwners?.[TOOL_NAME];

  if (!glLang || !glOwner) {
    throw new Error(`${name}: set LLM_TRAINING_GL_LANG and LLM_TRAINING_GL_OWNER (the manifest has no ${TOOL_NAME} GL)`);
  }

  const { glBook, glBibleName } = loadGlBook(glLang, glOwner, bookId);
  const indexFolder = path.join(projectPath, '.apps', 'translationCore', 'index', TOOL_NAME, bookId);
  const chapters = {};
  const alignmentChapters = {};
  const entries = [];
  let groups = 0;
  let total = 0;
  let answered = 0;

  for (const file of fs.readdirSync(indexFolder).filter(f => f.endsWith('.json')).sort()) {
    const groupChecks = readJson(path.join(indexFolder, file)).filter(check => check?.contextId);
    total += groupChecks.length;
    const checks = groupChecks.map(({ contextId }) => {
      const verseText = getVerseText(projectPath, bookId, contextId.reference, chapters);
      const alignments = getVerseAlignments(projectPath, bookId, contextId.reference, alignmentChapters);
      const answer = verseText && alignments ?
        getAlignedTargetWords(contextId, verseText, alignments, targetLang, MAX_WORDS) : null;
      return answer && {
        contextId, verseText, answer, selections: answer.selections,
      };
    }).filter(Boolean);
    answered += checks.length;

    if (checks.length <= MIN_GROUP_CHECKS) {
      continue;
    }

    const groupEntries = checks.map((check, index) => {
      const glText = getAlignedTextFromBible(check.contextId, glBook);

      if (!glText) {
        return null;
      }

      // only the correct answers of the checks before this one in the group
      const history = getSelectionsForBook(checks.slice(0, index), glLang, null, glBook, {});

      if (!Object.keys(history).length) {
        return null;
      }
      return toEntry(name, check, {
        targetLang, glLang, glOwner, glPhrase: cleanGlQuote(glText), history, glBibleName,
      });
    }).filter(Boolean);

    if (groupEntries.length) {
      groups++;
      entries.push(...groupEntries);
    }
  }

  const outFile = path.join(OUT_DIR, `${name}_${glOwner}_${glLang}.json`);

  if (entries.length) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(entries, null, 2)}\n`);
  }
  return {
    file: outFile, entries, groups, total, answered,
  };
}

/**
 * Turns a check into a training entry.
 * @param {string} projectName
 * @param {{contextId: object, verseText: string, answer: object, selections: Array}} check
 * @param {object} details
 * @returns {object}
 */
function toEntry(projectName, check, {
  targetLang, glLang, glOwner, glPhrase, history, glBibleName,
}) {
  const {
    contextId, verseText, answer, selections,
  } = check;
  const {
    bookId, chapter, verse,
  } = contextId.reference;
  const occurrence = contextId.occurrence || 1;

  return {
    id: `train-${targetLang}-${bookId}-${chapter}-${verse}-${contextId.groupId}${occurrence > 1 ? `-${occurrence}` : ''}`,
    targetLang,
    glLang,
    glOwner,
    groupId: contextId.groupId,
    verse: verseText,
    glPhrase,
    ...(occurrence > 1 ? { occurrence } : {}),
    history,
    expected: [answer.text],
    selections,
    contextId: {
      reference: contextId.reference,
      tool: contextId.tool,
      groupId: contextId.groupId,
      checkId: contextId.checkId,
      quote: contextId.quote,
      quoteString: contextId.quoteString,
      occurrence,
    },
    tags: ['training', contextId.groupId],
    madeUp: false,
    source: `${projectName} ${chapter}:${verse}, tW ${contextId.groupId}, GL ${glLang} ${glBibleName}`,
  };
}

/**
 * Reads one target-language verse from the project, caching the chapter files.
 * @param {string} projectPath
 * @param {string} bookId
 * @param {{chapter: number|string, verse: number|string}} reference
 * @param {object} chapters - cache of chapter files, changed in place
 * @returns {string} - '' when the verse is not found
 */
function getVerseText(projectPath, bookId, { chapter, verse }, chapters) {
  if (!(chapter in chapters)) {
    chapters[chapter] = readJsonIfExists(path.join(projectPath, bookId, `${chapter}.json`)) || {};
  }

  const text = chapters[chapter][verse];
  return typeof text === 'string' ? text.trim() : '';
}

/**
 * Reads one verse's word alignments from the project, caching the chapter files.
 * @param {string} projectPath
 * @param {string} bookId
 * @param {{chapter: number|string, verse: number|string}} reference
 * @param {object} chapters - cache of alignment chapter files, changed in place
 * @returns {Array<{topWords: Array, bottomWords: Array}>|null}
 */
function getVerseAlignments(projectPath, bookId, { chapter, verse }, chapters) {
  if (!(chapter in chapters)) {
    chapters[chapter] = readJsonIfExists(path.join(projectPath, '.apps', 'translationCore', 'alignmentData',
      bookId, `${chapter}.json`)) || {};
  }
  return chapters[chapter][verse]?.alignments || null;
}

/**
 * Loads the book of the GL bible: the first bible id of the gateway language, in `bibleIdSort`
 * order, with a version folder for `glOwner`; the newest such version.
 * @param {string} glLang - e.g. 'en'
 * @param {string} glOwner - e.g. 'unfoldingWord'
 * @param {string} bookId
 * @returns {{glBook: object, glBibleName: string}} - `glBibleName` like 'ult/v91_unfoldingWord'
 */
function loadGlBook(glLang, glOwner, bookId) {
  const biblesFolder = path.join(TC_HOME, 'resources', glLang, 'bibles');
  const bibleIds = fs.existsSync(biblesFolder) ? fs.readdirSync(biblesFolder).sort(bibleIdSort) : [];

  for (const bibleId of bibleIds) {
    const version = getNewestVersion(path.join(biblesFolder, bibleId), glOwner);
    const bookFolder = version && path.join(biblesFolder, bibleId, version, bookId);

    if (bookFolder && fs.existsSync(bookFolder)) {
      return { glBook: readBook(bookFolder), glBibleName: `${bibleId}/${version}` };
    }
  }
  throw new Error(`no ${glLang} bible from ${glOwner} with book ${bookId} in ${biblesFolder}`);
}

/**
 * The newest `vNN_<owner>` folder in a bible folder.
 * @param {string} folder
 * @param {string} owner
 * @returns {string|undefined}
 */
function getNewestVersion(folder, owner) {
  if (!fs.statSync(folder).isDirectory()) {
    return undefined;
  }

  const suffix = `_${owner}`;
  return fs.readdirSync(folder)
    .filter(name => name.endsWith(suffix) && /^v[\d.]+$/.test(name.slice(0, -suffix.length)))
    .sort((a, b) => compareVersions(a.slice(1, -suffix.length), b.slice(1, -suffix.length)))
    .pop();
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);

    if (diff) {
      return diff;
    }
  }
  return 0;
}

/**
 * Reads a bible book folder of `<chapter>.json` files into `{ chapter: { verse: verseData } }`.
 * @param {string} folder
 * @returns {object}
 */
function readBook(folder) {
  const book = {};

  for (const file of fs.readdirSync(folder).filter(f => /^\d+\.json$/.test(f))) {
    book[parseInt(file, 10)] = readJson(path.join(folder, file));
  }
  return book;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonIfExists(file) {
  return fs.existsSync(file) ? readJson(file) : null;
}
