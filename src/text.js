// Header fields (paths, labels, locations) come from the reviewed repo: no control character, newline included,
// may reach text an agent reads as instructions. Code and message bodies are not header fields and stay verbatim.
export const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, '');

/** `s` on one line: whitespace runs collapsed to a space, other control characters removed. For log lines. */
export const oneLine = (s) => clean(String(s).replace(/\s+/g, ' '));

/**
 * An error as one log line, `Name: message`. Messages can quote untrusted bytes (a parse error quotes the file, a
 * `MisfiledReview` the id inside it), which must not forge log lines.
 */
export const errorLine = (e) => `${oneLine(e?.name ?? 'Error')}: ${oneLine(e?.message ?? e)}`;

const lineCount = (s) => String(s).split('\n').length;
const FRAME = /^ {4}at \S/;

/**
 * The code-location lines of `e.stack` (`    at …`), never its message text. V8's stack starts with `name: message`,
 * so its header is skipped by line count: a message line that merely looks like a frame sits inside that count. The
 * rest is kept only if it is shaped like a frame, cleaned of control characters. A non-Error has no frames.
 */
export function stackFrames(e) {
  if (typeof e?.stack !== 'string') return [];
  const header = lineCount(e.name ?? '') + lineCount(e.message ?? '') - 1;
  return e.stack.split('\n').slice(header).filter((l) => FRAME.test(l)).map(clean);
}
