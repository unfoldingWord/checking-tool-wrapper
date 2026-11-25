"""Makes a local page for hand-checking a sample of one case group (plans/fine-tune-qwen3.md, Step 4B).

Reads the exporter's train/valid `*.meta.jsonl` (which give each example's category) and the cases
in `llmTrainingData/<file>.json`, samples cases of one category spread over the target languages,
and writes a self-contained HTML page. For each case the page shows the verse with the expected
answer and the history renderings found in it highlighted, and asks what a checker should select.
Verdicts are kept in the browser and saved with "Save verdicts" as a JSON file; give that file to
`--summarize` to count them.

The page holds translators' text, so it is written next to the (git-ignored) data and is meant to
be opened locally, not published.

Usage (from the repo folder):
  python3 llmTraining/handcheck.py --data llmTrainingData/finetune-d2 \
      --category someExpectedWordsNotInHistory --count 50
  python3 llmTraining/handcheck.py --summarize ~/Downloads/handcheck-verdicts.json
"""
import argparse
import collections
import html
import json
import random
import unicodedata
from pathlib import Path

VERDICTS = {
    "expected": "Expected answer is right: train on it as it is",
    "history": "A checker would select the history rendering: the extra or missing words are an alignment habit",
    "other": "Something else should be selected (say what in the note)",
    "unsure": "Can't tell",
}


def is_boundary(char):
    return char is None or unicodedata.category(char)[0] in "ZP" or char.isspace()


def find_word(text, word, occurrence=1):
    """Start index of the occurrence-th match of word in text at word boundaries, or -1."""
    start, seen = 0, 0
    while True:
        i = text.find(word, start)
        if i < 0:
            return -1
        before = text[i - 1] if i else None
        after = text[i + len(word)] if i + len(word) < len(text) else None
        if is_boundary(before) and is_boundary(after):
            seen += 1
            if seen == occurrence:
                return i
        start = i + 1


def highlight(verse, case):
    """Verse HTML with expected words (selections) and verbatim history renderings marked."""
    expected = [False] * len(verse)
    history = [False] * len(verse)
    for sel in case.get("selections", []):
        i = find_word(verse, sel["text"], sel.get("occurrence", 1))
        for j in range(max(i, 0), i + len(sel["text"]) if i >= 0 else 0):
            expected[j] = True
    for renderings in case.get("history", {}).values():
        for rendering in renderings:
            i = find_word(verse, rendering)
            for j in range(max(i, 0), i + len(rendering) if i >= 0 else 0):
                history[j] = True
    out, run, runs = [], "", None
    for k, char in enumerate(verse + "\0"):
        state = (expected[k], history[k]) if k < len(verse) else None
        if state != runs and run:
            cls = " ".join(c for c, on in zip(("exp", "hist"), runs) if on)
            out.append(f'<span class="{cls}">{html.escape(run)}</span>' if cls else html.escape(run))
            run = ""
        runs = state
        run += char if k < len(verse) else ""
    return "".join(out)


def sample_cases(data_dir, category, count, seed):
    rows = [json.loads(line) for split in ("train", "valid")
            for line in open(Path(data_dir) / f"{split}.meta.jsonl", encoding="utf-8")]
    rows = [r for r in rows if r["category"] == category and r["kind"] == "single"]
    by_lang = collections.defaultdict(list)
    for r in rows:
        by_lang[r["targetLang"]].append(r)
    rng = random.Random(seed)
    # proportional to each language's share, at least 2 per language
    quota = {lang: max(2, round(count * len(items) / len(rows))) for lang, items in by_lang.items()}
    while sum(quota.values()) > count:
        quota[max(quota, key=quota.get)] -= 1
    picked = []
    for lang, items in sorted(by_lang.items()):
        picked += rng.sample(items, min(quota[lang], len(items)))
    rng.shuffle(picked)
    cases_by_file = {}
    out = []
    for meta in picked:
        if meta["file"] not in cases_by_file:
            cases = json.load(open(f"llmTrainingData/{meta['file']}.json", encoding="utf-8"))
            cases_by_file[meta["file"]] = {c["id"]: c for c in cases}
        out.append((meta, cases_by_file[meta["file"]][meta["id"]]))
    return out, len(rows), collections.Counter(r["targetLang"] for r in rows)


PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hand-check cases</title>
<style>
:root { --ink:#231F20; --bg:#fff; --card:#f6f9fb; --line:#d7e3ea; --head:#014263; --accent:#31ADE3; --exp:#E59D33; --hist:#70C9CC; --muted:#5b6770; }
@media (prefers-color-scheme: dark) { :root { --ink:#e8eef2; --bg:#0f1a20; --card:#16252e; --line:#2a3d48; --head:#7fd0f0; --muted:#9fb0ba; } }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, sans-serif; }
main { max-width:900px; margin:0 auto; padding:16px; }
h1 { color:var(--head); font-size:1.4rem; margin:.5rem 0; }
.help { color:var(--muted); font-size:.95rem; }
.legend span { padding:0 .3em; border-radius:3px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px 16px; margin:16px 0; }
.card.done { border-left:6px solid var(--accent); }
.ref { color:var(--muted); font-size:.85rem; }
.verse { font-size:1.15rem; margin:.5rem 0; }
.exp { background:color-mix(in srgb, var(--exp) 45%, transparent); border-radius:3px; }
.hist { text-decoration:underline 3px var(--hist); text-underline-offset:4px; }
table { border-collapse:collapse; font-size:.95rem; margin:.4rem 0; }
td, th { padding:2px 10px 2px 0; text-align:left; vertical-align:top; }
.answer { font-weight:600; }
.flag { color:var(--exp); font-size:.85rem; }
.choices label { display:block; margin:2px 0; cursor:pointer; }
textarea { width:100%; box-sizing:border-box; margin-top:4px; background:var(--bg); color:var(--ink); border:1px solid var(--line); border-radius:4px; }
.bar { position:sticky; top:0; background:var(--bg); padding:8px 0; border-bottom:1px solid var(--line); display:flex; gap:12px; align-items:center; flex-wrap:wrap; z-index:1; }
button { background:var(--head); color:#fff; border:0; border-radius:4px; padding:6px 14px; font-size:1rem; cursor:pointer; }
</style></head><body><main>
<h1>Hand-check: __CATEGORY__</h1>
<p class="help">__INTRO__</p>
<p class="help legend">In each verse: <span class="exp">expected answer</span> (the words the translator aligned) and
<span class="hist">history renderings</span> (earlier selections for this word, where they occur word for word).
The question is not whether the translation is good, but <b>what a checker should select</b> for the GL phrase.</p>
<div class="bar"><span id="progress"></span><button id="save">Save verdicts</button></div>
__CARDS__
</main>
<script>
const KEY = 'handcheck-__CATEGORY__-__SEED__';
let state = {};
try { state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { state = {}; }
const store = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };
const cards = [...document.querySelectorAll('.card')];
function refresh() {
  let n = 0;
  cards.forEach(card => { const done = !!state[card.dataset.id]?.verdict; card.classList.toggle('done', done); n += done; });
  document.getElementById('progress').textContent = `${n} of ${cards.length} checked`;
}
cards.forEach(card => {
  const id = card.dataset.id, saved = state[id] || {};
  card.querySelectorAll('input[type=radio]').forEach(r => {
    r.checked = saved.verdict === r.value;
    r.addEventListener('change', () => { state[id] = { ...state[id], verdict: r.value }; store(); refresh(); });
  });
  const note = card.querySelector('textarea');
  note.value = saved.note || '';
  note.addEventListener('input', () => { state[id] = { ...state[id], note: note.value }; store(); });
});
document.getElementById('save').addEventListener('click', () => {
  const out = { category: '__CATEGORY__', seed: __SEED__, verdicts: cards.map(c => ({ id: c.dataset.id, ...(state[c.dataset.id] || {}) })) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
  a.download = 'handcheck-verdicts.json'; a.click();
});
refresh();
</script></body></html>
"""


def card(n, meta, case):
    rows = []
    for gl_key, renderings in case.get("history", {}).items():
        items = ", ".join(f"{html.escape(r)} ({c})" for r, c in sorted(renderings.items(), key=lambda x: -x[1]))
        rows.append(f"<tr><td>{html.escape(gl_key)}</td><td>{items}</td></tr>")
    choices = "".join(
        f'<label><input type="radio" name="v{n}" value="{key}"> {html.escape(text)}</label>'
        for key, text in VERDICTS.items())
    flag = ('<div class="flag">A history rendering is in the verse word for word, but the expected answer differs '
            '(contradicts the prompt\'s rule 3).</div>') if meta.get("historyInVerseButDiffers") else ""
    ref = case["contextId"]["reference"]
    return f"""<div class="card" data-id="{html.escape(meta['id'])}">
<div class="ref">{n}. {html.escape(case.get('source', ''))} · target {html.escape(case['targetLang'])} · GL {html.escape(case['glLang'])} · {html.escape(ref['bookId'])} {ref['chapter']}:{ref['verse']}</div>
<div>GL phrase: <b>{html.escape(case['glPhrase'])}</b></div>
<div class="verse" lang="{html.escape(case['targetLang'])}" dir="auto">{highlight(case['verse'], case)}</div>
<table><tr><th>Expected answer</th><td class="answer" dir="auto">{" / ".join(html.escape(e) for e in case['expected'])}</td></tr></table>
<table><tr><th colspan="2">History (GL key: renderings, count)</th></tr>{''.join(rows)}</table>
{flag}
<div class="choices">{choices}</div>
<textarea rows="1" placeholder="Note (optional)"></textarea>
</div>"""


def summarize(path):
    data = json.load(open(path, encoding="utf-8"))
    verdicts = data["verdicts"]
    counts = collections.Counter(v.get("verdict", "not checked") for v in verdicts)
    print(f"{data['category']}: {len(verdicts)} cases")
    for key, n in counts.most_common():
        print(f"  {key:12} {n:3}  {VERDICTS.get(key, '')}")
    for v in verdicts:
        if v.get("note"):
            print(f"  note {v['id']}: {v['note']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", default="llmTrainingData/finetune-d2")
    parser.add_argument("--category", default="someExpectedWordsNotInHistory")
    parser.add_argument("--count", type=int, default=50)
    parser.add_argument("--seed", type=int, default=3407)
    parser.add_argument("--out", help="default: <data>/handcheck-<category>.html")
    parser.add_argument("--summarize", help="count the verdicts in a saved handcheck-verdicts.json")
    args = parser.parse_args()
    if args.summarize:
        summarize(args.summarize)
        return

    picked, total, langs = sample_cases(args.data, args.category, args.count, args.seed)
    rule3 = sum(1 for meta, _ in picked if meta.get("historyInVerseButDiffers"))
    intro = (f"{len(picked)} of the {total} {args.category} cases in the train and validation sets, spread over "
             f"the target languages ({', '.join(f'{k} {v}' for k, v in langs.most_common())}); {rule3} of them "
             f"contradict rule 3. Verdicts are kept in this browser; press Save verdicts when done.")
    page = (PAGE.replace("__CARDS__", "\n".join(card(i + 1, m, c) for i, (m, c) in enumerate(picked)))
            .replace("__INTRO__", html.escape(intro)).replace("__CATEGORY__", args.category)
            .replace("__SEED__", str(args.seed)))
    out = Path(args.out or Path(args.data) / f"handcheck-{args.category}.html")
    out.write_text(page, encoding="utf-8")
    print(f"{out}: {len(picked)} cases ({rule3} contradict rule 3)")
    print("  by language: " + ", ".join(f"{k} {v}" for k, v in
                                        collections.Counter(m['targetLang'] for m, _ in picked).most_common()))


if __name__ == "__main__":
    main()
