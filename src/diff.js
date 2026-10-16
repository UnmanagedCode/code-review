import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Decodes a git C-quoted path (`"a\tb"`, octal escapes are utf-8 bytes). */
export function unquote(s) {
  if (!(s.startsWith('"') && s.endsWith('"'))) return s;
  const bytes = [];
  const body = s.slice(1, -1);
  const simple = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, '\\': 92 };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { bytes.push(...Buffer.from(c)); continue; }
    const n = body[++i];
    if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(body[i + 1] ?? '')) oct += body[++i];
      bytes.push(parseInt(oct, 8));
    } else bytes.push(simple[n] ?? n.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

// Splits `a/<old> b/<new>` from a `diff --git` line (each side may be C-quoted).
function headerPaths(rest) {
  const toks = [];
  let i = 0;
  while (i < rest.length && toks.length < 2) {
    if (rest[i] === '"') {
      let j = i + 1;
      while (rest[j] !== '"' || rest[j - 1] === '\\') j++;
      toks.push(rest.slice(i, j + 1));
      i = j + 2;
    } else if (toks.length === 1) {
      toks.push(rest.slice(i));
      i = rest.length;
    } else {
      // Unquoted first token: either side-by-side equal halves (`a/P b/P`) or ends at the first " b/".
      const half = (rest.length - 5) / 2;
      const equal = Number.isInteger(half) && rest.slice(2, 2 + half) === rest.slice(rest.length - half);
      const end = equal ? 2 + half : rest.indexOf(' b/');
      toks.push(rest.slice(0, end));
      i = end + 1;
    }
  }
  const strip = (t) => unquote(t).replace(/^[ab]\//, '');
  return [strip(toks[0] ?? ''), strip(toks[1] ?? '')];
}

const changedKey = (h) => h.lines.filter((l) => l.t !== 'ctx').map((l) => (l.t === 'add' ? '+' : '-') + l.text).join('\n');

/** The single hunk of a file with no text hunks (binary, rename-only, mode-only, empty, tooLarge). */
export function fileLevelHunk(f) {
  const id = sha([f.path, 'file', f.oldPath ?? '', f.status, f.oldBlob ?? '', f.newBlob ?? '', f.oldMode ?? '', f.newMode ?? ''].join('\0')).slice(0, 12);
  return { id, kind: 'file', lines: [] };
}

function assignIds(f) {
  const seen = new Map();
  for (const h of f.hunks) {
    const key = changedKey(h);
    const occ = seen.get(key) ?? 0;
    seen.set(key, occ + 1);
    h.id = sha(`${f.path}\0${key}\0${occ}`).slice(0, 12);
  }
  if (!f.hunks.length) f.hunks.push(fileLevelHunk(f));
}

/** Parses `git diff` unified output into files with hunks (see the architecture doc for shapes). */
export function parseDiff(text) {
  const files = [];
  let f = null;
  let h = null;
  let oldNo = 0;
  let newNo = 0;
  const finish = () => { if (f) assignIds(f); };
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      finish();
      const [, n] = headerPaths(line.slice('diff --git '.length));
      f = { path: n, oldPath: null, status: 'modified', binary: false, additions: 0, deletions: 0, hunks: [] };
      files.push(f);
      h = null;
      continue;
    }
    if (!f) continue;
    if (!h) {
      if (line.startsWith('rename from ')) { f.oldPath = unquote(line.slice(12)); f.status = 'renamed'; }
      else if (line.startsWith('rename to ')) f.path = unquote(line.slice(10));
      else if (line.startsWith('new file mode ')) { f.status = 'added'; f.newMode = line.slice(14); }
      else if (line.startsWith('deleted file mode ')) { f.status = 'deleted'; f.oldMode = line.slice(18); }
      else if (line.startsWith('old mode ')) f.oldMode = line.slice(9);
      else if (line.startsWith('new mode ')) f.newMode = line.slice(9);
      else if (line.startsWith('index ')) {
        const m = line.match(/^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d+))?/);
        if (m) { f.oldBlob = m[1]; f.newBlob = m[2]; if (m[3]) { f.oldMode ??= m[3]; f.newMode ??= m[3]; } }
      } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) f.binary = true;
      else if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    }
    const hm = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hm) {
      oldNo = Number(hm[1]);
      newNo = Number(hm[3]);
      h = {
        id: '', kind: 'text', header: line,
        oldStart: oldNo, oldLines: hm[2] === undefined ? 1 : Number(hm[2]),
        newStart: newNo, newLines: hm[4] === undefined ? 1 : Number(hm[4]),
        lines: [],
      };
      f.hunks.push(h);
      continue;
    }
    if (!h) continue;
    const c = line[0];
    if (c === ' ') h.lines.push({ t: 'ctx', old: oldNo++, new: newNo++, text: line.slice(1) });
    else if (c === '-') { h.lines.push({ t: 'del', old: oldNo++, new: null, text: line.slice(1) }); f.deletions++; }
    else if (c === '+') { h.lines.push({ t: 'add', old: null, new: newNo++, text: line.slice(1) }); f.additions++; }
    else if (c === '\\' && h.lines.length) h.lines[h.lines.length - 1].noEol = true;
  }
  finish();
  return files;
}
