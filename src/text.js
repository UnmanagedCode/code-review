// Header fields (paths, labels, locations) come from the reviewed repo: no control character, newline included,
// may reach text an agent reads as instructions. Code and message bodies are not header fields and stay verbatim.
export const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, '');

/** `s` on one line: whitespace runs collapsed to a space, other control characters removed. For log lines. */
export const oneLine = (s) => clean(String(s).replace(/\s+/g, ' '));

/**
 * An error as one log line, `Name: message`. Messages can quote untrusted bytes (a parse error quotes the file, a
 * `MisfiledReview` the id inside it), which must not forge log lines; the stack is left out for the same reason.
 */
export const errorLine = (e) => `${oneLine(e?.name ?? 'Error')}: ${oneLine(e?.message ?? e)}`;
