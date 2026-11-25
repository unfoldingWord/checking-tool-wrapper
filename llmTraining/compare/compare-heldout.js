// Compares models on the held-out files: pooled bands, thresholds, and per-group stats from results files.
const fs = require('fs'); const path = require('path');
const dir = process.argv[2]; const models = process.argv.slice(3);
const norm = s => (s || '').normalize('NFC').toLowerCase().replace(/[.,;:!?¿¡“”"'’()]/g, m => m === ':' ? ':' : '').trim();
const optText = o => (o?.selections || []).map(({ text, occurrence }) => occurrence > 1 ? `${text}:${occurrence}` : text).join(' ');
const pooled = Object.fromEntries(models.map(m => [m, JSON.parse(fs.readFileSync(path.join(dir, 'results', `${m.replace(/\//g, '-')}.byAlgorithmConfidence.json`)))]));
const first = pooled[models[0]];
console.log('Band'.padEnd(20) + 'Cases  Algorithm  ' + models.map(m => m.padEnd(22)).join(''));
first.bands.forEach((b, i) => {
  const pct = n => (b.cases ? (100 * n / b.cases).toFixed(1) + '%' : '-');
  console.log(b.band.padEnd(20) + String(b.cases).padEnd(7) + pct(b.algorithmTop1).padEnd(11) + models.map(m => pct(pooled[m].bands[i].appTop1).padEnd(22)).join(''));
});
console.log('\nTop-1 at threshold: ' + JSON.stringify(Object.fromEntries(models.map(m => [m, pooled[m].topOneByThreshold || pooled[m].thresholds]))));
// per-case stats from results files (scored as the app shows it: fallback to algorithm when AI gives nothing)
const files = first.files;
for (const group of ['ne_', 'other']) {
  console.log(`\n${group === 'ne_' ? 'ne_* files (unseen target language)' : 'other held-out files'}`);
  for (const m of ['Algorithm', ...models]) {
    let cases = 0, top1 = 0, wrong = 0, confWrong = 0, none = 0;
    for (const f of files.filter(f => (group === 'ne_') === f.startsWith('ne_'))) {
      const base = f.replace(/\.json$/, '');
      const tc = JSON.parse(fs.readFileSync(path.join(dir, f)));
      const algo = JSON.parse(fs.readFileSync(path.join(dir, 'results', `${base}_Algorithm.results.json`)));
      const res = JSON.parse(fs.readFileSync(path.join(dir, 'results', `${base}_${m.replace(/\//g, '-')}.results.json`)));
      tc.forEach((c, i) => {
        let opts = res[i].result?.bestSelections || [];
        if (!opts.length) opts = algo[i].result?.bestSelections || [];
        cases++;
        if (!opts.length) { none++; return; }
        const right = c.expected.map(norm).includes(norm(optText(opts[0])));
        if (right) top1++; else { wrong++; if (opts[0].confidence >= 80) confWrong++; }
      });
    }
    console.log(`  ${m.padEnd(24)} cases ${cases}  top-1 ${top1} (${(100 * top1 / cases).toFixed(1)}%)  wrong ${wrong}  wrong at conf>=80 ${confWrong}  none ${none}`);
  }
}
