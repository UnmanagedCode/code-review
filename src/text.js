// Header fields (paths, labels, locations) come from the reviewed repo: no control character, newline included,
// may reach text an agent reads as instructions. Code and message bodies are not header fields and stay verbatim.
export const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
