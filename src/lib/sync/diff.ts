import type { NormalizedEvent, PreparedEvent, SyncState } from '../types';

const DAY = 24 * 60 * 60 * 1000;
export const WINDOW_PAST_MS = 30 * DAY;
export const WINDOW_FUTURE_MS = 400 * DAY;

export function inSyncWindow(ev: NormalizedEvent, nowMs: number): boolean {
  return ev.startMs >= nowMs - WINDOW_PAST_MS && ev.startMs <= nowMs + WINDOW_FUTURE_MS;
}

/**
 * Guards against mass deletion when an LMS returns an empty or partial calendar
 * (maintenance page, glitch, reset token). Compares against tracked future events.
 */
export function looksTruncated(feedId: string, fresh: NormalizedEvent[], state: SyncState, nowMs: number): boolean {
  const trackedFuture = Object.values(state).filter((e) => e.feedId === feedId && e.startMs >= nowMs).length;
  if (trackedFuture === 0) return false;
  const freshFuture = fresh.filter((e) => e.startMs >= nowMs).length;
  if (freshFuture === 0) return true;
  return trackedFuture >= 10 && freshFuture < trackedFuture * 0.25;
}

export interface SyncPlan {
  inserts: PreparedEvent[];
  updates: PreparedEvent[];
  /** Future events whose source item disappeared: delete from Google. */
  deletes: string[];
  /** Past events whose source item disappeared: stop tracking, leave in Google. */
  forget: string[];
}

export interface PlanInput {
  desired: PreparedEvent[];
  state: SyncState;
  /** Feeds fetched successfully this run. Their missing items are treated as removed. */
  fetchedFeedIds: Set<string>;
  /** Feeds that are enabled. Tracked events from feeds not in this set get cleaned up. */
  activeFeedIds: Set<string>;
  nowMs: number;
}

export function planSync({ desired, state, fetchedFeedIds, activeFeedIds, nowMs }: PlanInput): SyncPlan {
  const byId = new Map<string, PreparedEvent>();
  for (const p of desired) byId.set(p.id, p);

  const plan: SyncPlan = { inserts: [], updates: [], deletes: [], forget: [] };

  for (const p of byId.values()) {
    const prev = state[p.id];
    if (!prev) plan.inserts.push(p);
    else if (prev.hash !== p.hash || prev.feedId !== p.event.feedId) plan.updates.push(p);
  }

  for (const [id, entry] of Object.entries(state)) {
    if (byId.has(id)) continue;
    const feedGone = !activeFeedIds.has(entry.feedId);
    // A feed that failed to download is not evidence that its items were removed.
    if (!feedGone && !fetchedFeedIds.has(entry.feedId)) continue;
    if (entry.startMs >= nowMs) plan.deletes.push(id);
    else plan.forget.push(id);
  }

  return plan;
}
