// Top-1 (app scoring) and wrong at >=80 per case category on the held-out files: node by-category.js HELDOUT_DIR META_JSONL model ...
// Categories come from the exporter's test.meta.jsonl (by case id); cases not in it were dropped by the exporter
// (mostly algorithm confidence 100) and are grouped as "notExported".
const fs = require('fs'); const path = require('path');
const [dir, metaFile, ...models] = process.argv.slice(2);
const norm = s => (s || '').normalize('NFC').toLowerCase().replace(/[.,;:!?¿¡“”"'’()]/g, m => m === ':' ? ':' : '').trim();
const optText = o => (o?.selections || []).map(({ text, occurrence }) => occurrence > 1 ? `${text}:${occurrence}` : text).join(' ');
const meta = Object.fromEntries(fs.readFileSync(metaFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(m => [m.id, m.category]));
const files = JSON.parse(fs.readFileSync(path.join(dir, 'results', `${models[0]}.byAlgorithmConfidence.json`))).files;
const stats = {};
for (const m of ['Algorithm', ...models]) {
  for (const f of files) {
    const base = f.replace(/\.json$/, '');
    const tc = JSON.parse(fs.readFileSync(path.join(dir, f)));
    const algo = JSON.parse(fs.readFileSync(path.join(dir, 'results', `${base}_Algorithm.results.json`)));
    const res = JSON.parse(fs.readFileSync(path.join(dir, 'results', `${base}_${m}.results.json`)));
    tc.forEach((c, i) => {
      const cat = meta[c.id] || 'notExported';
      let opts = res[i].result?.bestSelections || [];
      if (!opts.length) opts = algo[i].result?.bestSelections || [];
      const s = ((stats[cat] ||= {})[m] ||= { n: 0, top1: 0, confWrong: 0 });
      s.n++;
      if (!opts.length) return;
      if (c.expected.map(norm).includes(norm(optText(opts[0])))) s.top1++; else if (opts[0].confidence >= 80) s.confWrong++;
    });
  }
}
console.log('Category'.padEnd(32) + 'Cases  ' + ['Algorithm', ...models].map(m => m.padEnd(26)).join(''));
for (const [cat, byModel] of Object.entries(stats)) {
  console.log(cat.padEnd(32) + String(byModel.Algorithm.n).padEnd(7) + ['Algorithm', ...models].map(m => {
    const s = byModel[m]; return `${(100 * s.top1 / s.n).toFixed(1)}% (wrong>=80 ${s.confWrong})`.padEnd(26);
  }).join(''));
}
