// Side effect only, and imported before prismjs (highlight/prism.ts): Prism reads `manual` when it evaluates, and without
// it Prism would highlight every `language-*` element on DOMContentLoaded by rewriting its markup.
const g = globalThis as { Prism?: Record<string, unknown> };
g.Prism = { ...g.Prism, manual: true, disableWorkerMessageHandler: true };

export {};
