import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorLine, oneLine } from '../src/text.js';

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
