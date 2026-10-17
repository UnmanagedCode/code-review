import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorLine, oneLine, stackFrames } from '../src/text.js';

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

test('oneLine collapses whitespace runs, newlines included, and drops other control characters', () => {
  assert.equal(oneLine('a\r\n  b\tc\u001b[31md\u0085'), 'a b c[31md');
});

test('errorLine is "Name: message" on one line, for an Error and for a thrown non-Error', () => {
  const e = new SyntaxError('Unexpected token, "[1,\n\u001bforged\n]" is not valid JSON');
  const line = errorLine(e);
  assert.equal(line, 'SyntaxError: Unexpected token, "[1, forged ]" is not valid JSON');
  assert.doesNotMatch(line, CONTROL);
  assert.equal(errorLine('boom\nforged'), 'Error: boom forged');
  const named = new Error('x');
  named.name = 'Mis\nfiled';
  assert.equal(errorLine(named), 'Mis filed: x');
});

test('stackFrames returns the frame lines only: a message line shaped like a frame is not one', () => {
  const e = new TypeError('first\n    at forged (evil.js:1:1)\nlast');
  const frames = stackFrames(e);
  assert.ok(frames.length > 0);
  assert.ok(frames.every((l) => /^ {4}at \S/.test(l)));
  assert.ok(!frames.some((l) => l.includes('evil.js')));
  assert.deepEqual(frames, e.stack.split('\n').slice(3));
});

test('stackFrames skips a renamed error\'s header and one with an empty message; a non-Error has none', () => {
  class Named extends Error { constructor(m) { super(m); this.name = 'Named'; } }
  const named = new Named('a\nb');
  assert.ok(named.stack.startsWith('Named: a\nb\n'), 'precondition: the header carries the current name');
  assert.deepEqual(stackFrames(named), named.stack.split('\n').slice(2));
  const bare = new Error();
  assert.deepEqual(stackFrames(bare), bare.stack.split('\n').slice(1));
  assert.deepEqual(stackFrames('boom\n    at forged (evil.js:1:1)'), []);
  assert.deepEqual(stackFrames({ stack: 'X: m\n    at a (b.js:1:1)\n  not a frame\n    at c (d.js:2:2)', name: 'X', message: 'm' }), ['    at a (b.js:1:1)', '    at c (d.js:2:2)']);
});

test('stackFrames removes control characters from a kept frame', () => {
  assert.deepEqual(stackFrames({ stack: 'X: m\n    at a\u001b[31m (b.js:1:1)', name: 'X', message: 'm' }), ['    at a[31m (b.js:1:1)']);
});
