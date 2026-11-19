// Paired exact McNemar test between two models on the held-out cases of one category:
//   CAT=passes [META=llmTrainingData/finetune/test.meta.jsonl] node mcnemar-cat.js DIR RESULTS_A MODEL_A RESULTS_B MODEL_B
const fs = require('fs'); const path = require('path');
const [dir, resA, mA, resB, mB] = process.argv.slice(2);
const norm = s => (s || '').normalize('NFC').toLowerCase().replace(/[.,;:!?¿¡“”"'’()]/g, m => m === ':' ? ':' : '').trim();
const optText = o => (o?.selections || []).map(({ text, occurrence }) => occurrence > 1 ? `${text}:${occurrence}` : text).join(' ');
const files = JSON.parse(fs.readFileSync(path.join(dir, 'results', `${mA}.byAlgorithmConfidence.json`))).files;
const score = (resDir, m) => files.flatMap(f => {
  const base = f.replace(/\.json$/, '');
  const tc = JSON.parse(fs.readFileSync(path.join(dir, f)));
  const algo = JSON.parse(fs.readFileSync(path.join(dir, 'results', `${base}_Algorithm.results.json`)));
  const res = JSON.parse(fs.readFileSync(path.join(dir, resDir, `${base}_${m}.results.json`)));
  return tc.map((c, i) => {
    let opts = res[i].result?.bestSelections || [];
    if (!opts.length) opts = algo[i].result?.bestSelections || [];
    return opts.length > 0 && c.expected.map(norm).includes(norm(optText(opts[0])));
  });
});
const meta = Object.fromEntries(fs.readFileSync(process.env.META || 'llmTrainingData/finetune/test.meta.jsonl','utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).map(m=>[m.id,m.category])); const cats = files.flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f))).map(c => meta[c.id] || 'notExported')); const keep = cats.map(c => c === process.env.CAT); const a = score(resA, mA).filter((_, i) => keep[i]), b = score(resB, mB).filter((_, i) => keep[i]);
let onlyA = 0, onlyB = 0;
a.forEach((x, i) => { if (x && !b[i]) onlyA++; if (!x && b[i]) onlyB++; });
const n = onlyA + onlyB, k = Math.min(onlyA, onlyB);
let p = 0, c = 1; for (let i = 0; i <= n; i++) { if (i <= k) p += c; c = c * (n - i) / (i + 1); }
p = Math.min(1, 2 * p / 2 ** n);
console.log(`${resA}/${mA} ${a.filter(Boolean).length}  vs  ${resB}/${mB} ${b.filter(Boolean).length}: only A right ${onlyA}, only B right ${onlyB}, p ${p.toExponential(2)}`);
