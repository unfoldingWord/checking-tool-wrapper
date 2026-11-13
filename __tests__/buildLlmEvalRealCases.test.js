/* eslint-env jest */
/**
 * Builds `__fixtures__/llmEval/realCases.json`: evaluation cases for the AI suggestion suite
 * (`llmModelSuitability.test.js`) taken from translators' aligned projects, so the suite is not
 * only made-up data.
 *
 * Skipped unless `LLM_EVAL_BUILD_REAL=1`, so `npm test` does not read the translationCore folder.
 * Run it with `npm run build:llm-eval-cases`.
 *
 * For each project (a translationCore project folder with word alignments):
 *  - every translationWords check for the project's book in the `kt` and `other` categories of the
 *    English tW links is a candidate;
 *  - the expected answer is the target words the translator aligned to the check's
 *    original-language quote (from `.apps/translationCore/alignmentData/<book>/<chapter>.json`),
 *    in verse order; checks whose alignment also holds other original words, or more than
 *    `MAX_EXPECTED_WORDS` target words, are left out;
 *  - the GL phrase is the English ULT text aligned to the same quote, cleaned as the app cleans it
 *    (`getAlignedTextFromBible` and `cleanGlQuote`);
 *  - the history is built the way `fetchPreviousSelectionData` builds it, from the other checks of
 *    the same tW group in the projects of the same target language, leaving out every check in the
 *    case's own verse: `{ glPhrase: { targetWords: count } }`.
 *
 * Up to one case of each kind is picked per project (see `KINDS`), the one whose id has the
 * smallest md5 hash, so the choice is stable from run to run and spread across the book.
 *
 * Environment variables:
 *   LLM_EVAL_BUILD_REAL     set to 1 to build
 *   LLM_EVAL_TC_HOME        translationCore folder (default ~/translationCore)
 *   LLM_EVAL_REAL_PROJECTS  space-separated project folder names (default: the five below)
 *   LLM_EVAL_ULT_VERSION    English ULT version folder (default: the newest *_unfoldingWord)
 *   LLM_EVAL_TW_VERSION     English tW links version folder (default v90_unfoldingWord)
 *
 * jest is used because it is the repo's only babel runner; Node's `fs` is used because
 * `fs-extra` is mocked globally.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { getAlignedTextFromBible } from '../src/helpers/gatewayLanguageHelpers';
import { cleanGlQuote, normalizeForCompare } from '../src/utils/autoCheckingUtils';
import { getAlignedTargetWords } from './helpers/alignedTargetWords';

const env = process.env;
const BUILD = env.LLM_EVAL_BUILD_REAL === '1';
const TC_HOME = env.LLM_EVAL_TC_HOME || path.join(os.homedir(), 'translationCore');
const PROJECTS = (env.LLM_EVAL_REAL_PROJECTS ||
  'vi_glt_heb_book vi_glt_1co_book id_glt_1ti_book fa_glt_mrk_book bn_glt_2co_book').split(/\s+/).filter(Boolean);
const TW_VERSION = env.LLM_EVAL_TW_VERSION || 'v90_unfoldingWord';
const TW_CATEGORIES = ['kt', 'names', 'other'];
const OUT_FILE = path.join(__dirname, '__fixtures__', 'llmEval', 'realCases.json');
/** longest expected answer kept, in words; longer alignments are rarely what a checker selects */
const MAX_EXPECTED_WORDS = 4;
/**
 * kinds of case picked per project, in this order; a candidate gets the first kind it fits:
 * - repeated-word: the expected answer uses a word that occurs earlier in the verse
 * - no-history: no other check in the group
 * - exact-key: the history has the expected words under the case's own GL phrase
 * - related-key: the history has the expected words, but only under other GL phrases
 * - other-form: the history exists but never has exactly the expected words
 */
const KINDS = ['repeated-word', 'no-history', 'exact-key', 'related-key', 'other-form'];

const describeIfBuild = BUILD ? describe : describe.skip;

describeIfBuild('build llmEval real cases', () => {
  test(`writes ${path.relative(process.cwd(), OUT_FILE)}`, () => {
    const projects = PROJECTS.map(loadProject);
    const cases = [];

    for (const project of projects) {
      const sameLanguage = projects.filter(other => other.languageId === project.languageId);
      const candidates = project.checks
        .filter(check => check.expected && check.glPhrase)
        .map(check => toCase(project, check, sameLanguage));
      const picked = pickCases(candidates);
      console.log(`${project.name}: ${project.checks.length} checks, ${candidates.length} usable, picked ${picked.map(c => c.tags[1]).join(', ')}`);
      cases.push(...picked);
    }

    fs.writeFileSync(OUT_FILE, `${JSON.stringify(cases, null, 2)}\n`);
    expect(cases.length).toBeGreaterThan(0);
  });
});

/**
 * Reads one project and resolves each of its tW checks to a GL phrase and the aligned target words.
 * @param {string} name - project folder name, e.g. 'vi_glt_heb_book'
 * @returns {{name: string, languageId: string, bookId: string, checks: Array<object>}}
 */
function loadProject(name) {
  const projectPath = path.join(TC_HOME, 'projects', name);
  const manifest = readJson(path.join(projectPath, 'manifest.json'));
  const languageId = manifest.target_language.id;
  const bookId = manifest.project.id;
  const ult = readBook(path.join(TC_HOME, 'resources', 'en', 'bibles', 'ult', getUltVersion(), bookId));
  const checks = [];

  for (const category of TW_CATEGORIES) {
    const groupsFolder = path.join(TC_HOME, 'resources', 'en', 'translationHelps', 'translationWordsLinks',
      TW_VERSION, category, 'groups', bookId);

    if (!fs.existsSync(groupsFolder)) {
      continue;
    }

    for (const file of fs.readdirSync(groupsFolder).filter(f => f.endsWith('.json')).sort()) {
      for (const item of readJson(path.join(groupsFolder, file))) {
        const contextId = item.contextId;
        const { chapter, verse } = contextId.reference;
        const verseText = (readJsonIfExists(path.join(projectPath, bookId, `${chapter}.json`)) || {})[verse];
        const alignments = (readJsonIfExists(path.join(projectPath, '.apps', 'translationCore', 'alignmentData',
          bookId, `${chapter}.json`)) || {})[verse]?.alignments;
        const glText = getAlignedTextFromBible(contextId, ult);

        checks.push({
          contextId,
          groupId: contextId.groupId,
          verseText: typeof verseText === 'string' ? verseText.trim() : '',
          glPhrase: glText ? cleanGlQuote(glText) : '',
          expected: verseText && alignments ? getAlignedTargetWords(contextId, verseText, alignments, languageId, MAX_EXPECTED_WORDS) : null,
        });
      }
    }
  }
  return {
    name, languageId, bookId, checks,
  };
}

/**
 * Turns a check into an evaluation case, with its history from the other checks of the group.
 * @param {object} project
 * @param {object} check
 * @param {Array<object>} sameLanguage - projects with the same target language
 * @returns {object} - a case in the format of `cases.json`
 */
function toCase(project, check, sameLanguage) {
  const { chapter, verse } = check.contextId.reference;
  const history = {};

  for (const other of sameLanguage) {
    for (const prior of other.checks) {
      const priorRef = prior.contextId.reference;
      const sameVerse = other.bookId === project.bookId && priorRef.chapter === chapter && priorRef.verse === verse;

      if (prior.groupId !== check.groupId || sameVerse || !prior.expected || !prior.glPhrase) {
        continue;
      }

      const renderings = history[prior.glPhrase] || (history[prior.glPhrase] = {});
      renderings[prior.expected.words] = (renderings[prior.expected.words] || 0) + 1;
    }
  }

  const occurrence = check.contextId.occurrence || 1;
  const id = `real-${project.languageId}-${project.bookId}-${chapter}-${verse}-${check.groupId}${occurrence > 1 ? `-${occurrence}` : ''}`;
  return {
    id,
    targetLang: project.languageId,
    glLang: 'en',
    verse: check.verseText,
    glPhrase: check.glPhrase,
    ...(occurrence > 1 ? { occurrence } : {}),
    history,
    expected: [check.expected.text],
    tags: ['real-project', getKind(check, history, project.languageId)],
    madeUp: false,
    source: `${project.name} ${chapter}:${verse}, tW ${check.groupId}`,
  };
}

/**
 * Which of `KINDS` a case is.
 * @param {object} check
 * @param {object} history
 * @param {string} languageId
 * @returns {string}
 */
function getKind(check, history, languageId) {
  const norm = text => text.split(/\s+/).map(word => normalizeForCompare(word, languageId)).join(' ');
  const expected = norm(check.expected.words);
  const has = renderings => Object.keys(renderings || {}).some(rendering => norm(rendering) === expected);

  if (/:\d+/.test(check.expected.text)) {
    return 'repeated-word';
  }

  if (!Object.keys(history).length) {
    return 'no-history';
  }

  if (has(history[check.glPhrase])) {
    return 'exact-key';
  }
  return Object.values(history).some(has) ? 'related-key' : 'other-form';
}

/**
 * Picks up to one case of each kind, by smallest md5 of the id.
 * @param {Array<object>} candidates
 * @returns {Array<object>}
 */
function pickCases(candidates) {
  const hash = text => crypto.createHash('md5').update(text).digest('hex');
  const byHash = [...candidates].sort((a, b) => hash(a.id).localeCompare(hash(b.id)));
  const ids = new Set();

  return KINDS.map(kind => byHash.find(c => c.tags[1] === kind && !ids.has(c.id)))
    .filter(Boolean)
    .map(c => {
      ids.add(c.id);
      return c;
    });
}

/**
 * The newest `vNN_unfoldingWord` folder of the English ULT, unless LLM_EVAL_ULT_VERSION is set.
 * @returns {string}
 */
function getUltVersion() {
  if (env.LLM_EVAL_ULT_VERSION) {
    return env.LLM_EVAL_ULT_VERSION;
  }

  const folder = path.join(TC_HOME, 'resources', 'en', 'bibles', 'ult');
  const versions = fs.readdirSync(folder).filter(name => /^v[\d.]+_unfoldingWord$/.test(name));
  return versions.sort((a, b) => parseFloat(a.slice(1)) - parseFloat(b.slice(1))).pop();
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
