import { reviewLink, threadLink } from './links.js';
import { tally } from './rollup.js';
import { renderOpened, renderRollup, renderThreads, renderHunk, renderThreadWrite, renderProposal, renderRefresh } from './render.js';

// Per tool, the two views of a successful service result: `json(res, args)` is the complete structured data (it
// validates against the tool's `outputSchema` in conductor.plugin.json) and `text(res, args)` the prose. Neither carries
// `ok`; json also drops what only the UI reads (`sig`, `fileSig`).
const bare = ({ ok, ...rest }) => rest;
const noSig = ({ sig, ...rest }) => rest;

const linked = (review) => ({ ...review, link: reviewLink(review) });
const threadsLinked = (res) => {
  const rv = { id: res.review, project: res.project, worktree: res.worktree };
  return res.threads.map((t) => ({ ...t, link: threadLink(rv, t) }));
};
const guideJson = (g) => g && (({ threads, ...rest }) => rest)(g);

export const views = {
  open_review: {
    json: (res) => ({ review: linked(res.review), reused: res.reused }),
    text: (res) => renderOpened(linked(res.review), res.reused),
  },

  get_review: {
    json: (res) => ({ review: linked(res.review), files: res.files.map(noSig), guide: guideJson(res.guide), reviewThreads: tally(res.reviewThreads) }),
    text: (res) => renderRollup(linked(res.review), res.files, res.reviewThreads, res.guide),
  },

  list_threads: {
    json: (res) => ({ review: res.review, counts: res.counts, threads: threadsLinked(res) }),
    text: (res, args) => (res.threads.length
      ? renderThreads(threadsLinked(res))
      : `no ${args.status ?? 'open'} threads${args.owner ? ` opened by ${args.owner === 'user' ? 'the user' : 'agents'}` : ''}`),
  },

  get_hunk: {
    json: (res) => ({
      file: res.file, binary: res.binary, tooLarge: res.tooLarge,
      hunks: res.hunks.map(({ hunk, verdict, threadIds, groups }) => ({ ...hunk, verdict, threadIds, groups })),
    }),
    text: (res) => res.hunks.map((h) => renderHunk(res.file, h, res)).join('\n\n'),
  },

  annotate: {
    json: (res) => ({ thread: res.thread }),
    text: (res) => renderThreadWrite('started', res.thread),
  },

  reply: {
    json: (res) => ({ thread: res.thread }),
    text: (res) => renderThreadWrite('replied on', res.thread),
  },

  propose_groups: { json: bare, text: renderProposal },

  refresh_review: { json: bare, text: renderRefresh },
};
