import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDoc } from '../js/core/doc.js';
import { createHistory } from '../js/core/history.js';
import { createStroke } from '../js/core/stroke.js';
import { createMathEngine } from '../js/math/engine.js';
import { loadShippedModel } from '../scripts/accuracy.mjs';
import { userLine, toBoard } from './e2e/helpers.mjs';
import { cleanReply, transcribeLine } from '../js/ai/claude.js';

const reply = (text, extra = {}) => new Response(JSON.stringify({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
  content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 }, ...extra,
}), { status: 200, headers: { 'content-type': 'application/json' } });

async function withFetch(fn, run) {
  const real = globalThis.fetch, seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), init }); return fn(); };
  try { return await run(seen); } finally { globalThis.fetch = real; }
}

test('rejects unparseable reply → null', () => {
  assert.equal(cleanReply('I think it says hello'), null);
  assert.equal(cleanReply('\frac{1}{2}='), null);
  assert.equal(cleanReply('42'), null); // a bare number is not a math line
  assert.equal(cleanReply('```\n12 × 3 =\n```'), '12×3=');
  assert.equal(cleanReply('it says 2+3='), null);
  assert.equal(cleanReply('2πr'), null);
});

test('fence tag is stripped; function names and variables are accepted', () => {
  assert.equal(cleanReply('```text\n2+3=\n```'), '2+3=');
  for (const ok of ['y=3x^(2)', 'f(x)=2x+1', 'sin(30)=', 'sqrt(16)=', '2πr=']) assert.equal(cleanReply(ok), ok);
});

test('a line served from the Claude cache reports claude and is not sent again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = createDoc(), history = createHistory(doc), sources = [];
  doc.mode = 'math';
  let asked = 0;
  const refine = () => { asked++; return Promise.resolve('2+3='); };
  createMathEngine({ doc, history, model: loadShippedModel(), settings: { angle: 'deg', apiKey: 'k' }, refine, onSource: (s) => sources.push(s) });
  const strokes = toBoard(userLine('12×3='), [0, 0], [40, 120]).map((pts) => createStroke({ pts, color: '#000000', width: 4, tool: 'pen' }));
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  history.apply({ type: 'add', label: 'Draw', strokes });
  t.mock.timers.tick(700); await flush();
  assert.equal(sources.at(-1), 'claude');
  history.undo(); t.mock.timers.tick(700); await flush(); // the line leaves the page (its reading is dropped, the cache stays)
  sources.length = 0;
  history.redo(); t.mock.timers.tick(700); await flush();
  assert.deepEqual(sources, ['claude']);
  assert.equal(asked, 1);
});

test('valid reply is returned, request has no sampling or thinking params', async () => {
  await withFetch(() => reply('2+3='), async (seen) => {
    assert.equal(await transcribeLine('AAAA', { apiKey: 'sk-test' }), '2+3=');
    const body = JSON.parse(seen[0].init.body);
    assert.equal(body.model, 'claude-opus-5-5');
    assert.ok(!('temperature' in body) && !('thinking' in body));
  });
});

test('errors, refusals and no key → null', async () => {
  await withFetch(() => new Response('{}', { status: 500 }), async () => assert.equal(await transcribeLine('A', { apiKey: 'k' }), null));
  await withFetch(() => reply('2+3=', { stop_reason: 'refusal' }), async () => assert.equal(await transcribeLine('A', { apiKey: 'k' }), null));
  await withFetch(() => reply('2+3='), async (seen) => { assert.equal(await transcribeLine('A', {}), null); assert.equal(seen.length, 0); });
});

test('a refine that throws synchronously does not stall the queue', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = createDoc(), history = createHistory(doc), asked = [];
  doc.mode = 'math';
  const refine = (ss) => { asked.push(ss); if (asked.length === 1) throw new Error('boom'); return Promise.resolve(null); };
  createMathEngine({ doc, history, model: loadShippedModel(), settings: { angle: 'deg', apiKey: 'k' }, refine, bank: undefined });
  for (const [txt, y] of [['12×3=', 120], ['45÷5=', 300]]) {
    history.apply({ type: 'add', label: 'Draw', strokes: toBoard(userLine(txt), [0, 0], [40, y]).map((pts) => createStroke({ pts, color: '#000000', width: 4, tool: 'pen' })) });
  }
  t.mock.timers.tick(700);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  assert.equal(asked.length, 2);
});
