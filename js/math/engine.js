// Math mode wiring (spec §4): after 700 ms idle, read the page's lines, evaluate them top to bottom, and write
// answers into doc.answers through history. No DOM: cards go out through onCards.
import { bbox, median } from '../core/geom.js';
import { readLine } from '../recog/reader.js';
import { charHeight, groupLines, nearBand } from '../recog/segment.js';
import { classifyLine, compile, evaluate, freeVars } from './parse.js';
import { formatNumber } from './format.js';
import { createDigitBank, layoutAnswer } from './answer.js';

const IDLE_MS = 700, READ_MS = 40; // a pass stops reading new lines after READ_MS and goes on in a later task
const NOT_LETTER_HIGH = new Set(['=', '-', '.', '÷', '+', '×']);

// Line id: the line's stroke ids, sorted and joined. Strokes are immutable (an edit or a move makes new ids),
// so the id changes exactly when the line's ink does.
const lineIdOf = (ss) => ss.map((s) => s.id).sort().join(',');

// Answer strokes for a line read as r. Heights come from r's chars; positions from the doc's world-coord strokes
// (r's chars are in reader.js's levelled frame, whose angle can differ from the page's).
function placeAnswer(text, r, angle, doc, bank) {
  const ink = (c) => c.strokes.map((s) => doc.strokes.get(s.id)).filter(Boolean), box = (c) => bbox(ink(c).flatMap((s) => s.pts));
  const eq = r.chars[r.chars.length - 1], body = r.chars.filter((c) => !c.sup);
  const digits = body.filter((c) => /^\d$/.test(c.label));
  const pool = digits.length ? digits : body.filter((c) => !NOT_LETTER_HIGH.has(c.label));
  const height = pool.length ? median(pool.map((c) => c.bbox.h)) : eq.bbox.w;
  // anchored on the "=": the answer is centred on it (the whole-line fitted slant is too rough to carry a baseline
  // from the digits, and lines flatten toward the "=")
  const e = box(eq), x = e.x + e.w, y = e.y + e.h / 2 + height / 2;
  const pen = ink(eq)[0];
  return layoutAnswer(text, { x, y, height, angle, width: pen?.width ?? 4, color: pen?.color ?? '#000000' }, bank);
}

export function createMathEngine({ doc, history, model, settings, onCards = () => {}, bank = createDigitBank(), read = readLine, refine = null, onSource = () => {} }) {
  const reads = new Map(); // lineId -> reading; only new or changed lines are read (~70 ms a line)
  const better = new Map(); // lineId -> Claude's tokens, or null once asked (a line is sent once); LRU, survives note switches
  const queue = []; let busy = false; // one request at a time, newest line first
  const remember = (id, v) => { better.delete(id); better.set(id, v); if (better.size > 500) better.delete(better.keys().next().value); };
  function pump() {
    const job = busy ? null : queue.pop();
    if (!job) return;
    if (!reads.has(job.id)) { better.delete(job.id); return pump(); } // the line went away while queued: never sent
    busy = true;
    Promise.resolve().then(() => refine(job.ss)).catch(() => null).then((t) => {
      remember(job.id, t ? [...t] : null);
      if (reads.has(job.id)) { onSource(t ? 'claude' : 'offline'); schedule(); } // a reply for an edited or removed line is dropped
    }).finally(() => { busy = false; pump(); });
  }
  let timer = null, amending = false, joined = false;

  // The page's lines, kept between passes: only strokes near what changed are regrouped.
  const grouped = new Map(); // stroke id -> { s: the stroke as grouped, L: its line }
  let pageH = 0; // the character height the kept lines were grouped with
  function regroup(strokes) {
    // Grouping is relative to the page's character height, and a band's own height swings with what it holds. Bands
    // use the page's; when that moves by over 5% (a page's first strokes, a tall scribble) every line is regrouped
    // with it, so the kept lines always group as one whole-page groupLines would.
    const H = charHeight(strokes);
    if (!(Math.abs(H - pageH) <= 0.05 * pageH)) { grouped.clear(); pageH = H; }
    const now = new Map(strokes.map((s) => [s.id, s]));
    const seeds = strokes.filter((s) => grouped.get(s.id)?.s !== s); // new or replaced
    for (const g of grouped.values()) if (now.get(g.s.id) !== g.s) seeds.push(g.s); // removed or replaced: where it was
    if (!seeds.length) return false;
    const { strokes: near, more } = nearBand(strokes, seeds, undefined, pageH);
    const old = new Set([...near, ...seeds].map((s) => grouped.get(s.id)?.L).filter(Boolean)); // lines touched are regrouped whole
    const take = new Set(near);
    for (const L of old) for (const t of L.ss) { grouped.delete(t.id); if (now.has(t.id)) take.add(now.get(t.id)); }
    for (const l of groupLines([...take], pageH)) {
      const ss = [...l.strokes, ...l.exponents.flatMap((e) => e.strokes)], b = bbox(ss.flatMap((s) => s.pts));
      const L = { ss, angle: l.angle, id: lineIdOf(ss), box: b, mid: b.y + b.h / 2 };
      for (const t of ss) grouped.set(t.id, { s: t, L });
    }
    return more;
  }

  function run() {
    timer = null;
    const join = joined; // answers caused by a history step ride in that step; others (a mode toggle, an undo) do not
    joined = false;
    const math = doc.mode === 'math', opts = { angle: settings.angle };
    if (!math && !doc.answers.size) { // Notes mode only drops orphan answers: none, so no grouping; readings of gone ink go
      for (const id of reads.keys()) if (!id.split(',').every((s) => doc.strokes.has(s))) reads.delete(id);
      onCards([], [], []); // cards and labels go with Math mode
      return;
    }
    // doc.strokes only (answer strokes live in doc.answers); pen ink only: highlighting and shapes are not math
    let pending = regroup([...doc.strokes.values()].filter((s) => s.tool === 'pen' && !s.shape));
    const lines = [...new Set([...grouped.values()].map((g) => g.L))].sort((p, q) => p.mid - q.mid);
    const want = new Map(), vars = {}, cards = [], labels = [], t0 = performance.now(); // labels: what was read, for the debug overlay
    let order = null; // stroke id -> place in the page's draw order (saved with the note), for a card's anchor
    for (const L of lines) {
      const old = doc.answers.get(L.id);
      if (!math) { if (old) want.set(L.id, old); continue; } // Notes mode computes nothing, but drops orphans
      if (!reads.has(L.id) && performance.now() - t0 > READ_MS) pending = true;
      if (pending) { if (old) want.set(L.id, old); continue; } // read later: what is below waits for it
      if (!reads.has(L.id)) {
        let r = null;
        try { r = read(L.ss, model); } catch { /* unreadable: no answer */ }
        for (const ch of r?.chars ?? []) if (!ch.sup) bank.learn(ch.label, ch.strokes, ch.alts[0].p, !ch.changed);
        reads.set(L.id, r);
        // offline answer now, Claude's replaces it when it arrives; only lines with "=" (plain text never goes out)
        if (r && refine && settings.apiKey && r.tokens.includes('=') && !better.has(L.id)) { remember(L.id, null); queue.push({ id: L.id, ss: L.ss }); pump(); }
        else if (r) onSource(better.get(L.id) ? 'claude' : 'offline');
      }
      const r = reads.get(L.id);
      if (!r) continue;
      const tokens = better.get(L.id) ?? r.tokens;
      labels.push({ box: L.box, text: tokens.join(''), id: L.id });
      const k = classifyLine(tokens);
      let text = null;
      if (k.kind === 'assign') {
        try { vars[k.name] = evaluate(k.expr, vars, opts); } catch { delete vars[k.name]; }
      } else if (k.kind === 'equation') {
        order ??= new Map([...doc.strokes.keys()].map((id, i) => [id, i]));
        const anchor = L.ss.reduce((a, s) => (order.get(s.id) < order.get(a.id) ? s : a)).id;
        cards.push({ id: L.id, anchor, bbox: L.box, fname: k.fname, expr: k.expr, freeVars: [...freeVars(k.expr)], text: tokens.join(''), color: L.ss[0].color });
      } else if (k.kind === 'eval') {
        try { text = formatNumber(evaluate(k.expr, vars, opts)); } catch { text = '?'; }
      } else if (tokens.length > 1 && tokens[tokens.length - 1] === '=') {
        try { compile(tokens.slice(0, -1)); } catch { text = '?'; } // ends in "=" but does not parse
      }
      if (text === null) continue;
      if (old?.text === text) want.set(L.id, old);
      else {
        try { want.set(L.id, { lineId: L.id, text, strokes: placeAnswer(text, r, L.angle, doc, bank) }); } catch { /* no answer */ }
      }
    }
    if (pending) { for (const [id, a] of doc.answers) if (!want.has(id)) want.set(id, a); } // nothing is dropped mid-way
    else {
      const ids = new Set(lines.map((L) => L.id));
      for (const id of reads.keys()) if (!ids.has(id)) reads.delete(id);
      doc.vars = vars;
    }

    const ops = [];
    for (const [lineId, a] of doc.answers) {
      if (!want.has(lineId)) ops.push({ type: 'removeAnswer', lineId, before: a });
      else if (want.get(lineId) !== a) ops.push({ type: 'setAnswer', lineId, before: a, after: want.get(lineId) });
    }
    for (const [lineId, a] of want) if (!doc.answers.has(lineId)) ops.push({ type: 'setAnswer', lineId, before: null, after: a });
    if (ops.length) {
      amending = true;
      try { history.amend(ops.length === 1 ? ops[0] : { type: 'batch', ops }, join); } finally { amending = false; }
    }
    // the rest in a later task, so a big page never freezes input; it still rides in the step that caused it
    if (pending) { timer = setTimeout(() => { joined = join; run(); }, 0); return; }
    // every line and answer, so a card placed below its equation covers no ink
    const ink = [...lines.map((L) => L.box), ...[...doc.answers.values()].map((a) => bbox(a.strokes.flatMap((s) => s.pts)))];
    onCards(math ? cards : [], ink, math ? labels : []);
  }

  // Re-run after 700 ms without changes. Which lines changed is found by line id, so no stroke ids are needed.
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, IDLE_MS);
  }
  // not our own answer edit; answers after an undo or redo stay out of history (they would join the wrong step)
  history.onChange((kind) => { if (amending) return; if (kind !== 'amend') joined = kind === 'apply'; schedule(); });

  // schedule(): for changes outside history (mode toggle); history changes are followed on their own.
  return { schedule };
}
