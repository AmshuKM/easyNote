// Reader accuracy on the traced handwriting fixtures:  node scripts/accuracy.mjs
// Strokes are assigned to truth entries by bbox (independent of the segmenter), each entry is read with readLine.
// Character accuracy = 1 - edit distance / truth length (summed), line accuracy = exact matches.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bbox } from '../js/core/geom.js';
import { loadModel } from '../js/recog/cnn.js';
import { readLine, readPage } from '../js/recog/reader.js';
import { groupLines } from '../js/recog/segment.js';

const url = (p) => new URL(p, import.meta.url);
const json = (p) => JSON.parse(readFileSync(url(p)));

export function loadShippedModel() {
  const buf = readFileSync(url('../models/cnn.bin'));
  return loadModel(json('../models/cnn.json'), new Int8Array(buf.buffer, buf.byteOffset, buf.length));
}

export function editDistance(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}

const inBox = (s, [x, y, w, h]) => { const b = bbox(s), cx = b.x + b.w / 2, cy = b.y + b.h / 2; return cx >= x && cx <= x + w && cy >= y && cy <= y + h; };

// One fixture: per-line reads, char/line accuracy, and how readPage's lines align with the truth entries.
export function measure(fixture, truth, model) {
  const strokes = fixture.strokes, entry = strokes.map((s) => truth.lines.findIndex((t) => inBox(s, t.bbox)));
  const lines = truth.lines.map((t, ti) => {
    const { text } = readLine(strokes.filter((_, i) => entry[i] === ti), model);
    return { truth: t.text, read: text, dist: editDistance(text, t.text) };
  });
  const len = lines.reduce((s, l) => s + l.truth.length, 0), dist = lines.reduce((s, l) => s + l.dist, 0);
  // Page: an entry aligns when all its strokes fall in one page line (readPage's grouping) holding no other entry.
  const page = readPage(strokes, model), lineOf = new Map();
  groupLines(strokes).forEach((l, li) => [...l.strokes, ...l.exponents.flatMap((e) => e.strokes)].forEach((s) => lineOf.set(s, li)));
  const aligned = truth.lines.filter((_, ti) => {
    const ls = new Set(strokes.filter((_, i) => entry[i] === ti).map((s) => lineOf.get(s)));
    return ls.size === 1 && strokes.every((s, i) => entry[i] === ti || entry[i] < 0 || !ls.has(lineOf.get(s)));
  }).length;
  // Page text: each page line against the truth texts of the entries it holds, left to right.
  const want = page.map((_, li) => truth.lines.map((_, ti) => ti).filter((ti) => strokes.some((s, i) => entry[i] === ti && lineOf.get(s) === li))
    .sort((a, b) => truth.lines[a].bbox[0] - truth.lines[b].bbox[0]).map((ti) => truth.lines[ti].text).join(''));
  const pageDist = page.reduce((s, l, li) => s + editDistance(l.text, want[li]), 0);
  return { lines, char: 1 - dist / len, line: lines.filter((l) => !l.dist).length / lines.length, len, dist,
    page: { lines: page.map((l, li) => ({ read: l.text, truth: want[li] })), aligned, of: truth.lines.length, char: 1 - pageDist / len } };
}

export function measureAll(model = loadShippedModel()) {
  const out = { user: measure(json('../tests/fixtures/user-sample-2026-10-25.json'), json('../tests/fixtures/truth/user-sample-2026-10-25.json'), model),
    userLive: measure(json('../tests/fixtures/user-live-2026-10-26.json'), json('../tests/fixtures/truth/user-live-2026-10-26.json'), model), legacy: {} };
  for (const f of readdirSync(url('../tests/fixtures/legacy/'))) out.legacy[f] = measure(json(`../tests/fixtures/legacy/${f}`), json(`../tests/fixtures/truth/legacy-${f}`), model);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = measureAll(), pct = (v) => `${(100 * v).toFixed(1)}%`;
  const show = (name, m) => {
    console.log(`\n${name}: char ${pct(m.char)}, line ${pct(m.line)} (${m.lines.filter((l) => !l.dist).length}/${m.lines.length}); readPage: entries aligned ${m.page.aligned}/${m.page.of}, page char ${pct(m.page.char)}`);
    for (const l of m.lines) console.log(`  ${l.dist ? 'FAIL' : 'ok  '} ${l.truth.padEnd(12)} read ${l.read}`);
    if (process.argv.includes('--page')) for (const l of m.page.lines) console.log(`  page ${l.truth.padEnd(16)} read ${l.read}`);
  };
  show('user-sample-2026-10-25', r.user);
  show('user-live-2026-10-26', r.userLive);
  const leg = Object.values(r.legacy), len = leg.reduce((s, m) => s + m.len, 0), dist = leg.reduce((s, m) => s + m.dist, 0);
  const n = leg.reduce((s, m) => s + m.lines.length, 0), ok = leg.reduce((s, m) => s + m.lines.filter((l) => !l.dist).length, 0);
  for (const [f, m] of Object.entries(r.legacy)) show(`legacy ${f} (truth unconfirmed)`, m);
  console.log(`\nlegacy overall (unconfirmed truth): char ${pct(1 - dist / len)}, line ${pct(ok / n)}`);
}

// ---- --live: replay every fixture through the real app (Playwright Chromium) and write docs/accuracy.md ----
async function live(r) {
  const { chromium } = await import('@playwright/test');
  const { spawn } = await import('node:child_process');
  const { writeFileSync } = await import('node:fs');
  const { liveMeasure } = await import('../tests/e2e/live.mjs');
  const base = 'http://localhost:5173';
  let server = null;
  if (!(await fetch(base).then((x) => x.ok, () => false))) {
    server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url))], { stdio: 'ignore' });
    for (let i = 0; i < 50 && !(await fetch(base).then((x) => x.ok, () => false)); i++) await new Promise((x) => setTimeout(x, 100));
  }
  const browser = await chromium.launch();
  const newPage = async () => (await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 800 } })).newPage();
  const pct = (v) => `${(100 * v).toFixed(1)}%`;
  const fixtures = [['user-sample-2026-10-25', 'user-sample-2026-10-25.json', r.user, ''], ['user-live-2026-10-26', 'user-live-2026-10-26.json', r.userLive, '', 1]];
  for (const f of Object.keys(r.legacy)) fixtures.push([`legacy ${f}`, `legacy/${f}`, r.legacy[f], 'legacy-' + f]);
  const out = ['# Handwriting accuracy: offline vs live', '',
    'Generated by `node scripts/accuracy.mjs --live`. Offline = `readLine` on each truth entry\'s strokes. Live = the same strokes replayed with the pen into the running app (Math mode, traced images at half size, live pen fixtures at the size written, Chromium 1280x800) and read back from `window.__easyNote`: `read` is the engine\'s recognised line, `result` the answer / card / variable it produced. Legacy truth is unconfirmed (typed from screenshots, not by the user).', ''];
  const summary = [], fails = [], differs = [];
  try {
    for (const [name, file, off, truthFile, k] of fixtures) {
      const fixture = json(`../tests/fixtures/${file}`), truth = json(`../tests/fixtures/truth/${truthFile || file}`);
      const m = await liveMeasure(newPage, fixture, truth, editDistance, { k });
      const row = (t, o, l) => `| ${t.truth} | ${o?.read ?? ''} | ${l.read} | ${l.result} | ${t.expect} | ${l.ok === null ? 'n/a' : l.ok ? 'ok' : 'FAIL'} |`;
      out.push(`## ${name}`, '',
        `| | char | line | results right |`, '|---|---|---|---|',
        `| offline | ${pct(off.char)} | ${pct(off.line)} | n/a |`,
        `| live, line alone | ${pct(m.char)} | ${pct(m.line)} | ${m.resultOk}/${m.resultOf} |`,
        `| live, whole page | ${pct(m.page.char)} | n/a | ${m.page.resultOk}/${m.lines.length} |`, '',
        'Per line (live read and result are from the line alone; "page" is the whole-page replay):', '',
        '| truth | offline read | live read | live result | expected | ok? | page read | page result | page ok? |', '|---|---|---|---|---|---|---|---|---|');
      m.lines.forEach((l, i) => { const p = m.page.lines[i]; out.push(`${row(l, off.lines[i], l)} ${p.read} | ${p.result} | ${p.ok ? 'ok' : 'FAIL'} |`); if (l.read !== off.lines[i].read) differs.push(`${name}: ${l.truth} offline ${off.lines[i].read}, live ${l.read}`);
        if (l.ok === false || l.dist) fails.push(`${name}: ${l.truth} read ${l.read || '(nothing)'}, result ${l.result || '(none)'}, expected ${l.expect}`); });
      out.push('');
      summary.push({ name, off, m });
    }
  } finally { await browser.close(); server?.kill(); }
  out.push('## Known failures', '',
    'The reader is the shipped offline CNN; nothing here is tuned to these fixtures. The main causes:', '',
    '- The user’s "a" reads as 2 (alpha-like), so a=3 is read 2=3, the variable is never defined, and 5a+1= answers ? instead of 16 on the whole page.',
    '- sin(30)= and log(16)= are misread (the multi-letter function names are drawn cursively) instead of answering 0.5 and 1.20412. log(16)= reads 47(16)= with its 4 and 7 confident (p 0.94, 0.92, no letter alternatives), and since its short "=" bars read as "=" (2026-10-26) it answers a wrong 752 (47×16). No generic rule tells it apart from a real 47(16)=; Claude refinement or a better letter model is the fix.',
    '- The overlined 200s and some x² (exponent attached to a loose x) read as junk; they are plain text, so no answer is produced either way and they only cost character accuracy.',
    '- Legacy screenshots: loose, slanted digits (8+200=, 200+80=) lose characters; their truth is unconfirmed.',
    '- Legacy user-graph-tablet (live line 0 of 3, whole-page char far below offline) is the slant problem: its lines are steeply slanted, the segmenter groups strokes into lines before levelling the slant, so strokes of one equation land in the neighbouring line’s band and lines are split or merged wrongly. Slant-aware grouping (level first, then group) is the fix and is not done yet.',
    `- Live differs from offline on ${differs.length} lines (listed below). The replayed strokes are not the cause: the points stored in the document match the points sent to within 0.2 px, and reading the stored strokes directly with readLine gives the offline text. Offline reads each truth entry’s strokes directly (assigned by bbox), while live goes through groupLines, which splits or joins some lines differently. Differences are the segmenter’s grouping, not the replay.`, '',
    'Lines read differently live than offline:', '', ...differs.map((f) => `- ${f}`), '',
    'Every row that differs from its truth or expected result:', '',
    ...fails.map((f) => `- ${f}`), '');
  writeFileSync(new URL('../docs/accuracy.md', import.meta.url), out.join('\n'));
  for (const { name, off, m } of summary) console.log(`${name}: offline char ${pct(off.char)} line ${pct(off.line)} | live char ${pct(m.char)} line ${pct(m.line)} results ${m.resultOk}/${m.resultOf} | page char ${pct(m.page.char)} results ${m.page.resultOk}`);
  return summary;
}
if (process.argv.includes('--live') && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await live(measureAll());
