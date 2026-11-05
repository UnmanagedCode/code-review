import { Refusal } from './refusals.js';
import { MAX_BODY_CHARS } from './threads.js';
import { currentRound } from './context.js';
import { verdictOf, tally, unreadOf, threadView } from './rollup.js';

export const MAX_GROUP_TITLE_CHARS = 200;

const invalid = (reason) => new Refusal('INVALID_ARGUMENT', reason);
const groupVerdictOf = (g) => g.verdict?.verdict ?? 'pending';
const setKey = (ids) => [...ids].sort().join('\0');
const onGroup = (t, g) => t.anchor.kind === 'group' && t.anchor.groupId === g.id;

/** The current round's groups that contain the hunk. */
export const groupsHolding = (review, hunkId) => review.groups.filter((g) => g.hunkIds.includes(hunkId));

/**
 * The hunk verdicts to write when `group` takes `verdict`, evaluated as if it already had it: `[{hunkId, verdict}]`,
 * only hunks whose verdict differs. Accept: a hunk whose every group is accepted. Reject: every hunk. Pending: every
 * hunk except one another rejected group holds.
 */
export function groupVerdictWrites(review, group, verdict) {
  const writes = [];
  for (const hunkId of group.hunkIds) {
    let target = null;
    const others = groupsHolding(review, hunkId).filter((g) => g.id !== group.id);
    if (verdict === 'rejected') target = 'rejected';
    else if (verdict === 'accepted') target = others.every((g) => groupVerdictOf(g) === 'accepted') ? 'accepted' : null;
    else target = others.some((g) => groupVerdictOf(g) === 'rejected') ? null : 'pending';
    if (target && verdictOf(review, hunkId) !== target) writes.push({ hunkId, verdict: target });
  }
  return writes;
}

/** The groups holding the hunk that have a verdict other than `verdict`: a direct hunk verdict clears them. */
export const contradictedGroups = (review, hunkId, verdict) => groupsHolding(review, hunkId).filter((g) => g.verdict && g.verdict.verdict !== verdict);

/** Refuses a malformed proposal; `roundHunkIds` is a Set of the round's hunk ids. Writes nothing. */
export function checkProposal(specs, roundHunkIds) {
  if (!Array.isArray(specs) || !specs.length) throw invalid('groups must be a non-empty array');
  const seen = new Map();
  specs.forEach((s, i) => {
    const n = i + 1;
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw invalid(`group ${n} must be an object with a title, a description and hunks`);
    if (Object.keys(s).some((k) => !['title', 'description', 'hunks'].includes(k))) throw invalid(`group ${n} takes only a title, a description and hunks`);
    if (typeof s.title !== 'string' || !s.title.trim()) throw invalid(`group ${n} needs a title`);
    if (s.title.length > MAX_GROUP_TITLE_CHARS) throw invalid(`group ${n}'s title is limited to ${MAX_GROUP_TITLE_CHARS} characters`);
    if (typeof s.description !== 'string' || !s.description.trim()) throw invalid(`group ${n} needs a description`);
    if (s.description.length > MAX_BODY_CHARS) throw new Refusal('BODY_TOO_LARGE', `group ${n}'s description is limited to ${MAX_BODY_CHARS} characters`);
    if (!Array.isArray(s.hunks) || !s.hunks.every((h) => typeof h === 'string')) throw invalid(`group ${n} needs hunks: a list of hunk ids`);
    if (!s.hunks.length) throw new Refusal('GROUP_EMPTY', `group ${n} has no hunks`);
    if (new Set(s.hunks).size !== s.hunks.length) throw invalid(`group ${n} lists a hunk more than once`);
    const unknown = s.hunks.find((h) => !roundHunkIds.has(h));
    if (unknown) throw new Refusal('HUNK_UNKNOWN', `group ${n}: no such hunk in this round: ${unknown}`);
    const key = setKey(s.hunks);
    if (seen.has(key)) throw invalid(`groups ${seen.get(key)} and ${n} have the same hunks`);
    seen.set(key, n);
  });
}

// Moves a group from the current list to the retired one; its open threads go outdated. Returns how many.
function retire(review, g, reason, round) {
  review.retiredGroups.push({ ...g, retiredIn: round, reason });
  let outdated = 0;
  for (const t of review.threads) {
    if (onGroup(t, g) && t.status !== 'outdated') { t.status = 'outdated'; outdated++; }
  }
  return outdated;
}

/**
 * Replaces the round's groups with a checked proposal. A proposed group with exactly the hunks of a current one keeps its
 * id, verdict and threads; every other current group is retired (`reproposal`). No hunk verdict is written.
 */
export function replaceGroups(review, specs, proposedBy, round) {
  const current = new Map(review.groups.map((g) => [setKey(g.hunkIds), g]));
  const matched = new Set();
  const next = specs.map((s, i) => {
    const old = current.get(setKey(s.hunks));
    if (old) matched.add(old);
    return {
      id: old ? old.id : `g${review.nextGroup++}`, order: i + 1, title: s.title.trim(), description: s.description,
      hunkIds: [...s.hunks], verdict: old ? old.verdict : null, proposedBy,
    };
  });
  let threadsOutdated = 0;
  let retired = 0;
  for (const g of review.groups) {
    if (matched.has(g)) continue;
    threadsOutdated += retire(review, g, 'reproposal', round);
    retired++;
  }
  review.groups = next;
  review.sinceProposal = { dropped: 0, newHunkIds: [] };
  return { kept: matched.size, retired, threadsOutdated };
}

/**
 * A range refresh: keeps the groups whose hunks all survive in `nextIds` (their threads' anchors move to `round`),
 * retires the rest (`refresh`), and records what changed since the last proposal. Hunk verdicts are not touched.
 */
export function carryGroups(review, nextIds, prevIds, round) {
  const keep = [];
  let dropped = 0;
  let threadsOutdated = 0;
  for (const g of review.groups) {
    if (g.hunkIds.every((h) => nextIds.has(h))) {
      keep.push(g);
      for (const t of review.threads) if (onGroup(t, g) && t.status !== 'outdated') t.anchor = { ...t.anchor, round };
    } else {
      threadsOutdated += retire(review, g, 'refresh', round);
      dropped++;
    }
  }
  review.groups = keep;
  const fresh = [...nextIds].filter((h) => !prevIds.has(h));
  const newHunkIds = [...new Set([...review.sinceProposal.newHunkIds, ...fresh])].filter((h) => nextIds.has(h));
  review.sinceProposal = { dropped: review.sinceProposal.dropped + dropped, newHunkIds };
  return { kept: keep.length, dropped, threadsOutdated };
}

const groupedIds = (review) => new Set(review.groups.flatMap((g) => g.hunkIds));

/** Why Guide me is offered: no groups, groups dropped by a refresh since the last proposal, or a refresh-added hunk in no group. */
export function guideState(review) {
  const grouped = groupedIds(review);
  const noGroups = review.groups.length === 0;
  const droppedGroups = review.sinceProposal.dropped;
  const newUngrouped = review.sinceProposal.newHunkIds.filter((h) => !grouped.has(h)).length;
  return { offered: noGroups || droppedGroups > 0 || newUngrouped > 0, noGroups, droppedGroups, newUngrouped };
}

/** Counts of the groups of the current round (null on uncommitted reviews); `files` null = unreadable snapshot. */
export function groupCounts(review, files) {
  if (review.kind === 'uncommitted') return null;
  const c = { pending: 0, accepted: 0, rejected: 0 };
  for (const g of review.groups) c[groupVerdictOf(g)]++;
  const grouped = groupedIds(review);
  return {
    total: review.groups.length, ...c,
    ungrouped: files ? files.flatMap((f) => f.hunks).filter((h) => !grouped.has(h.id)).length : null,
    guideMe: guideState(review).offered,
  };
}

/** GuideView (null on uncommitted reviews): the groups with their hunks, the ungrouped hunks, group threads, retired groups. */
export function guideView(review, files) {
  if (review.kind === 'uncommitted') return null;
  const where = new Map(files?.flatMap((f) => f.hunks.map((h) => [h.id, f.path])));
  const hunk = (id) => ({ id, file: where.get(id) ?? null, verdict: verdictOf(review, id) });
  const grouped = groupedIds(review);
  const groupThreads = review.threads.filter((t) => t.anchor.kind === 'group').sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  return {
    round: currentRound(review).n,
    groups: review.groups.map((g) => {
      const mine = groupThreads.filter((t) => onGroup(t, g));
      return {
        id: g.id, order: g.order, title: g.title, description: g.description, hunks: g.hunkIds.map(hunk), verdict: groupVerdictOf(g),
        proposedBy: g.proposedBy, threads: tally(mine), unread: mine.reduce((n, t) => n + unreadOf(t), 0),
      };
    }),
    ungrouped: files ? files.flatMap((f) => f.hunks).filter((h) => !grouped.has(h.id)).map((h) => hunk(h.id)) : null,
    threads: groupThreads.map(threadView),
    retired: review.retiredGroups.map((g) => ({ id: g.id, title: g.title, retiredIn: g.retiredIn, reason: g.reason })),
    guideMe: guideState(review),
  };
}
