import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measureAll } from '../scripts/accuracy.mjs';

// The user's real handwriting (traced fixture, never trained on). baseline.json is never lowered.
test('user sample accuracy does not regress below baseline.json', () => {
  const base = JSON.parse(readFileSync(new URL('./fixtures/truth/baseline.json', import.meta.url)));
  const { user } = measureAll();
  const fails = user.lines.filter((l) => l.dist).map((l) => `${l.truth} -> ${l.read}`).join('; ');
  assert.ok(user.char >= base.char, `char ${user.char} < ${base.char}; ${fails}`);
  assert.ok(user.line >= base.line, `line ${user.line} < ${base.line}; ${fails}`);
});

// The user's live pen test (never trained on): floors in baseline.json userLive, never lowered.
test('user live accuracy does not regress below baseline.json', () => {
  const base = JSON.parse(readFileSync(new URL('./fixtures/truth/baseline.json', import.meta.url))).userLive;
  const { userLive } = measureAll();
  const fails = userLive.lines.filter((l) => l.dist).map((l) => `${l.truth} -> ${l.read}`).join('; ');
  assert.ok(userLive.char >= base.char, `char ${userLive.char} < ${base.char}; ${fails}`);
  assert.ok(userLive.line >= base.line, `line ${userLive.line} < ${base.line}; ${fails}`);
});
