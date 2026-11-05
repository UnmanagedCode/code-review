import { attempt, Refusal } from './refusals.js';
import { assertOpen, authorFor, currentRound, inReview } from './context.js';
import { lookupScope } from './lookups.js';
import { liveSig } from './rollup.js';
import { bump, recordVerdict, summaryById } from './reviews.js';
import { checkProposal, replaceGroups, groupVerdictWrites, guideView } from './grouping.js';

const VERDICTS = ['pending', 'accepted', 'rejected'];
const now = () => new Date().toISOString();

function assertGroups(review) {
  assertOpen(review);
  if (review.kind === 'uncommitted') throw new Refusal('NO_GROUPS', 'uncommitted reviews have no groups');
}

const verdictName = (g) => g.verdict?.verdict ?? 'pending';

/**
 * Sets the current round's groups (the agent surface and nothing else calls this). Any session may propose: a proposal
 * writes no verdict, so it takes no role. The proposer is recorded as the author of each group, role frozen.
 */
export const proposeGroups = (id, actor, groups) => attempt(() => inReview(id, async (review, env) => {
  assertGroups(review);
  const files = (await env.snapshot()).files;
  checkProposal(groups, new Set(files.flatMap((f) => f.hunks.map((h) => h.id))));
  const seq = bump(review);
  if (actor.kind === 'agent') review.agentSeq = seq;
  else review.humanSeq = seq;
  const res = replaceGroups(review, groups, authorFor(review, actor), currentRound(review).n);
  const grouped = new Set(review.groups.flatMap((g) => g.hunkIds));
  return {
    ok: true,
    groups: review.groups.map((g) => ({ id: g.id, order: g.order, title: g.title, hunkIds: g.hunkIds, verdict: verdictName(g) })),
    ...res,
    ungrouped: files.flatMap((f) => f.hunks).map((h) => h.id).filter((h) => !grouped.has(h)),
  };
}));

/** The human's verdict on one group: its own seq, and writes to its hunks by the rules in grouping.js. */
export const setGroupVerdict = (id, groupId, verdict) => attempt(async () => {
  const scope = lookupScope();
  const res = await inReview(id, async (review, env) => {
    if (!VERDICTS.includes(verdict)) throw new Refusal('INVALID_ARGUMENT', `verdict must be one of ${VERDICTS.join(', ')}`);
    assertGroups(review);
    const group = review.groups.find((g) => g.id === groupId);
    if (!group) throw new Refusal('GROUP_UNKNOWN', `no such group in round ${currentRound(review).n}: ${groupId}`);
    const snap = await env.snapshot();
    // Pending on a pending group writes nothing, even when it holds a hunk rejected some other way.
    const writes = verdictName(group) === 'pending' && verdict === 'pending' ? [] : groupVerdictWrites(review, group, verdict);
    if (verdictName(group) === verdict && !writes.length) return { ok: true, hunks: [], fileSigs: [], guide: guideView(review, snap.files) };
    const seq = bump(review);
    review.humanSeq = seq;
    group.verdict = verdict === 'pending' ? null : { verdict, seq, at: now() };
    for (const w of writes) recordVerdict(review, w.hunkId, w.verdict);
    const paths = [...new Set(writes.map((w) => snap.files.find((f) => f.hunks.some((h) => h.id === w.hunkId))?.path))].filter(Boolean);
    return {
      ok: true, hunks: writes.map((w) => ({ id: w.hunkId, verdict: w.verdict })),
      fileSigs: paths.map((p) => liveSig(review, snap, p)), guide: guideView(review, snap.files),
    };
  }, scope);
  return res.ok ? { ...(await summaryById(id, scope)), groupId, verdict, hunks: res.hunks, fileSigs: res.fileSigs, guide: res.guide } : res;
});
