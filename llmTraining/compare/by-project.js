// Top-1 per target project on the held-out files, scored as the app shows it (the algorithm answers
// at confidence 100, and is the fallback when the AI gives nothing), with confident wrong answers.
//   node llmTraining/compare/by-project.js HELDOUT_DIR model ...
// "Algorithm" is always included. Files are grouped by target project (the part before `_book`).
const fs = require('fs');
const path = require('path');

const [dir, ...models] = process.argv.slice(2);
const norm = s => (s || '').normalize('NFC').toLowerCase().replace(/[.,;:!?¿¡“”"'’()]/g, '').trim();
const optText = o => (o?.selections || []).map(({ text, occurrence }) => (occurrence > 1 ? `${text}:${occurrence}` : text)).join(' ');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
const all = ['Algorithm', ...models];
const stats = {};

for (const f of files) {
  const base = f.replace(/\.json$/, '');
  const project = base.replace(/_book(_.*)?$/, '');
  const cases = JSON.parse(fs.readFileSync(path.join(dir, f)));
  const algo = JSON.parse(fs.readFileSync(path.join(dir, 'results', `${base}_Algorithm.results.json`)));

  for (const m of all) {
    const file = path.join(dir, 'results', `${base}_${m.replace(/\//g, '-')}.results.json`);
    if (!fs.existsSync(file)) {
      continue;
    }
    const res = JSON.parse(fs.readFileSync(file));
    for (const key of [project, 'ALL']) {
      const s = (((stats[key] ||= {})[m]) ||= { n: 0, top1: 0, confWrong: 0 });
      cases.forEach((c, i) => {
        let opts = res[i].result?.bestSelections || [];
        if (!opts.length) {
          opts = algo[i].result?.bestSelections || [];
        }
        s.n++;
        if (!opts.length) {
          return;
        }
        if (c.expected.map(norm).includes(norm(optText(opts[0])))) {
          s.top1++;
        } else if (opts[0].confidence >= 80) {
          s.confWrong++;
        }
      });
    }
  }
}

const width = 30;
console.log('Project'.padEnd(18) + 'Cases  ' + all.map(m => m.slice(-width + 2).padEnd(width)).join(''));
for (const [project, byModel] of Object.entries(stats)) {
  const n = byModel.Algorithm.n;
  console.log(project.padEnd(18) + String(n).padEnd(7) + all.map(m => {
    const s = byModel[m];
    return (s ? `${(100 * s.top1 / s.n).toFixed(1)}% (wrong>=80 ${s.confWrong})` : '-').padEnd(width);
  }).join(''));
}
