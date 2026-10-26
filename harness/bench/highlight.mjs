// Worst-case highlighting time per language at its side cap: every grammar `frontend/src/lib/highlight/prism.ts` loads,
// fed stress lines through the real `highlightLines` (HIGHLIGHT_MAX_* and HIGHLIGHT_MAX_SIDE_CHARS_BY_LANG applied).
// Run: node harness/bench/highlight.mjs [--search] [--lang <name>]   (each language in its own process unless --lang)
//   --search  instead finds, per language, the largest side size in SEARCH_SIZES whose warm worst case fits TARGET_MS
//             (smallest first, stopping at the first that misses: slow grammars never run their largest sizes).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Prism from 'prismjs';
import {
  HIGHLIGHT_LANGUAGES, HIGHLIGHT_MAX_LINE_CHARS, HIGHLIGHT_MAX_LINES, HIGHLIGHT_MAX_SIDE_CHARS, highlightLines, sideCharCap,
} from '../../frontend/src/lib/highlight/index.ts';

const require = createRequire(import.meta.url);
const prismTs = fileURLToPath(new URL('../../frontend/src/lib/highlight/prism.ts', import.meta.url));
// The grammars, in prism.ts's import order (later grammars extend earlier ones).
for (const [, mod] of readFileSync(prismTs, 'utf8').matchAll(/^import '(prismjs\/components\/[^']+)';$/gm)) require(mod);
const tokenize = (text, lang) => (Prism.languages[lang] ? Prism.tokenize(text, Prism.languages[lang]) : [text]);

const TARGET_MS = 100;
const SEARCH_SIZES = [4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 250_000, 500_000, 1_000_000];
// Stress lines: dense tokens, nesting, interpolation and unterminated constructs, for every language family bundled.
const GENERATORS = {
  markdown: (i) => `- item **bold** \`code\` [l](u) _em_ ${i} `,
  code: (i) => `const a${i} = "s\\"t" + 'x' + \`t \${b}\` + /re+/g.test(c) /* c */ ? f(g(h[${i}])) : 0x1F; `,
  markup: (i) => `<div class="a${i}" id='b' data-x=y><span style="c:d">t &amp; u</span><!-- c --></div>`,
  interp: (i) => `puts "#{a} #{b ? "x#{c}" : 'y'}" if x =~ /re${i}/ && $y; @z = :sym; `,
  python: (i) => `def f${i}(a, b='s', *c, **d): return f"{a!r:>{b}}" + r'\\d' if a else [x for x in c] `,
  yaml: (i) => `key${i}: [a, "b", {c: d, e: 'f'}] &anc *ref !tag | `,
  sql: (i) => `SELECT a${i}, 'b''c' FROM t WHERE c = 1 AND d IN (SELECT e FROM f) -- g `,
  shell: (i) => `echo "$(cmd "$x${i}" \${y:-z})" | grep 'y' && [[ -n $a ]] # c `,
  php: (i) => `<?php echo "$a{$b[${i}]}" . 'c'; /* d */ ?><b>e</b>`,
  diff: (i) => `+ added ${i} - removed @@ -1,2 +1,2 @@ `,
  unterminated: (i) => `"open ${i} 'open /* open \`open <!-- open <a href=" [x]( **b ${'{'}{ (( `,
};
const shapes = (size) => [199, 1999].map((len) => ({ len, lines: Math.min(HIGHLIGHT_MAX_LINES, Math.floor((size + 1) / (len + 1))) }));
const sideText = (gen, { len, lines }) => Array.from({ length: lines }, (_, i) => gen(i).repeat(Math.ceil(len / gen(i).length)).slice(0, len)).join('\n');

/**
 * The slowest generator × shape for `lang` at side size `size`: its first run (cold, as on opening a file) and the
 * fastest of three (warm), in ms, and what caused each.
 */
function worst(lang, size) {
  const out = { cold: { ms: 0, at: '' }, warm: { ms: 0, at: '' } };
  for (const [name, gen] of Object.entries(GENERATORS)) {
    for (const shape of shapes(size)) {
      const text = sideText(gen, shape);
      const runs = [0, 1, 2].map(() => { const t = performance.now(); highlightLines(text, lang, tokenize); return performance.now() - t; });
      const at = `${name}, ${shape.lines}×${shape.len}`;
      if (runs[0] > out.cold.ms) out.cold = { ms: runs[0], at };
      if (Math.min(...runs) > out.warm.ms) out.warm = { ms: Math.min(...runs), at };
    }
  }
  return out;
}

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const search = process.argv.includes('--search');
const only = arg('--lang');
if (!only) {
  // One process per language: a long run accumulates heap and GC pauses that skew the later languages.
  console.log(`caps: ${HIGHLIGHT_MAX_SIDE_CHARS} chars/side, ${HIGHLIGHT_MAX_LINES} lines, ${HIGHLIGHT_MAX_LINE_CHARS} chars/line${search ? `; target ${TARGET_MS} ms` : ''}`);
  for (const lang of HIGHLIGHT_LANGUAGES) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--lang', lang, ...(search ? ['--search'] : [])], { encoding: 'utf8' });
    process.stdout.write(r.stdout + r.stderr);
  }
} else if (search) {
  let fits = null;
  for (const size of SEARCH_SIZES) { if (worst(only, size).warm.ms > TARGET_MS) break; fits = size; }
  console.log(`${only.padEnd(11)} fits ${TARGET_MS} ms (warm) up to ${fits ?? `< ${SEARCH_SIZES[0]}`}`);
} else {
  const cap = sideCharCap(only);
  const { cold, warm } = worst(only, cap);
  const f = (x) => `${x.ms.toFixed(0).padStart(4)} ms (${x.at})`;
  console.log(`${only.padEnd(11)} cap ${String(cap).padStart(7)}  cold ${f(cold)}  warm ${f(warm)}`);
}
