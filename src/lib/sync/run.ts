import { browser } from 'wxt/browser';
import { fetchCanvasUserId, fetchPlannerItems, plannerItemsToEvents, sanitizePlannerItems, type PlannerItem } from '../feeds/canvas-api';
import { feedOrigin, parseFeed } from '../feeds/parse';
import { AuthRequiredError, getAccessToken, invalidateToken } from '../google/auth';
import { createCalendar, deleteEvent, getCalendar, GoogleApiError, insertEvent, renameCalendar, updateEvent } from '../google/calendar';
import { calendarItem, canvasCacheItem, feedsItem, settingsItem, statusItem, syncStateItem } from '../storage';
import type { Feed, NormalizedEvent, SyncState, SyncStats } from '../types';
import { inSyncWindow, looksTruncated, planSync } from './diff';
import { prepareEvents } from './ids';

const CONCURRENCY = 4;
const MAX_FEED_BYTES = 10 * 1024 * 1024;

let running: Promise<void> | null = null;
const STALE_RUN_MS = 10 * 60 * 1000;

/** Clears a `running` flag left behind when the service worker was stopped mid-sync. */
export async function clearStaleRunningFlag(): Promise<void> {
  const status = await statusItem.getValue();
  if (status.running && !running && (!status.lastRunAt || Date.now() - status.lastRunAt > STALE_RUN_MS)) {
    await statusItem.setValue({ ...status, running: false });
  }
}

/** Runs one sync. Concurrent callers share the in-flight run. */
export function runSync(): Promise<void> {
  running ??= doSync().finally(() => {
    running = null;
  });
  return running;
}

const CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Saves a Canvas API snapshot for a site origin. */
export async function saveCanvasSnapshot(origin: string, userId: string, items: PlannerItem[]): Promise<void> {
  const cache = await canvasCacheItem.getValue();
  await canvasCacheItem.setValue({ ...cache, [origin]: { fetchedAt: Date.now(), userId, items } });
}

const WRONG_USER = 'A different Canvas account is logged in. Log in as the account you connected, or reconnect.';

async function loadCanvasApi(feed: Feed, nowMs: number, warn: (msg: string) => void): Promise<NormalizedEvent[]> {
  const origin = new URL(feed.url).origin;
  let items: PlannerItem[];
  let userId: string | undefined;
  try {
    // Works when the browser sends the Canvas session cookie to extension requests.
    const init: RequestInit = { credentials: 'include', cache: 'no-store' };
    userId = await fetchCanvasUserId(origin, init);
    if (feed.canvasUserId && userId !== feed.canvasUserId) throw new Error(WRONG_USER);
    items = sanitizePlannerItems(await fetchPlannerItems(origin, nowMs, init));
    await saveCanvasSnapshot(origin, userId, items);
  } catch (e) {
    if (e instanceof Error && e.message === WRONG_USER) throw e;
    // Otherwise use the snapshot the content script took the last time a Canvas tab was open.
    const cached = (await canvasCacheItem.getValue())[origin];
    if (!cached || nowMs - cached.fetchedAt > CACHE_MAX_AGE_MS) {
      throw new Error('Open Canvas in a tab while logged in, so Nomad can read your assignments.');
    }
    if (feed.canvasUserId && cached.userId !== feed.canvasUserId) throw new Error(WRONG_USER);
    items = cached.items;
    const ageMin = Math.round((nowMs - cached.fetchedAt) / 60_000);
    if (ageMin > 60) {
      warn(`Using Canvas data from ${ageMin < 1440 ? `${Math.round(ageMin / 60)} h` : `${Math.round(ageMin / 1440)} days`} ago. Open Canvas in a tab to refresh.`);
    }
  }
  return plannerItemsToEvents(items, feed);
}

async function fetchFeed(feed: Feed, nowMs: number, warn: (msg: string) => void): Promise<NormalizedEvent[]> {
  const granted = await browser.permissions.contains({ origins: [feedOrigin(feed.url)] });
  if (!granted) throw new Error('Site access not granted. Remove and re-add this feed.');
  if (feed.mode === 'api') return loadCanvasApi(feed, nowMs, warn);
  let res: Response;
  try {
    res = await fetch(feed.url, { credentials: 'omit', cache: 'no-store', redirect: 'follow' });
  } catch {
    throw new Error(`Couldn't reach ${new URL(feed.url).host}. Check the link opens in a tab, or connect Canvas with "Connect Canvas on this tab".`);
  }
  if (!res.ok) throw new Error(`Feed download failed (HTTP ${res.status}).`);
  const text = await res.text();
  if (text.length > MAX_FEED_BYTES) throw new Error('Feed is too large.');
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('That URL did not return a calendar feed.');
  return parseFeed(text, feed);
}

async function ensureCalendar(token: string): Promise<string> {
  const { calendarName } = await settingsItem.getValue();
  const stored = await calendarItem.getValue();
  if (stored) {
    const cal = await getCalendar(token, stored.id);
    if (cal) {
      if (stored.name !== calendarName) {
        try {
          await renameCalendar(token, stored.id, calendarName);
          await calendarItem.setValue({ id: stored.id, name: calendarName });
        } catch (e) {
          if (e instanceof GoogleApiError && e.status === 401) throw e;
          // A failed rename should not block syncing; it is retried next run.
        }
      }
      return stored.id;
    }
  }
  // First run, or the user deleted the calendar: start fresh.
  const cal = await createCalendar(token, calendarName);
  await calendarItem.setValue({ id: cal.id, name: calendarName });
  await syncStateItem.setValue({});
  return cal.id;
}

async function pool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) await worker(items[next++]!);
  });
  await Promise.all(lanes);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function doSync(): Promise<void> {
  const nowMs = Date.now();
  const prevStatus = await statusItem.getValue();
  await statusItem.setValue({ ...prevStatus, running: true, lastRunAt: nowMs });

  const feedErrors: Record<string, string> = {};
  try {
    // Auth first: when disconnected, don't download feeds on every alarm.
    const token = await getAccessToken({ interactive: false });
    const calendarId = await ensureCalendar(token);
    const state: SyncState = { ...(await syncStateItem.getValue()) };

    const feeds = await feedsItem.getValue();
    const active = feeds.filter((f) => f.enabled);
    const activeFeedIds = new Set(active.map((f) => f.id));
    const fetchedFeedIds = new Set<string>();
    const events: NormalizedEvent[] = [];

    await Promise.all(
      active.map(async (feed) => {
        try {
          const feedEvents = (await fetchFeed(feed, nowMs, (msg) => (feedErrors[feed.id] = msg))).filter((e) => inSyncWindow(e, nowMs));
          events.push(...feedEvents);
          if (looksTruncated(feed.id, feedEvents, state, nowMs)) {
            feedErrors[feed.id] = 'Feed came back empty or much smaller than before. Kept existing events.';
          } else {
            fetchedFeedIds.add(feed.id);
          }
        } catch (e) {
          feedErrors[feed.id] = errorMessage(e);
        }
      }),
    );

    const plan = planSync({ desired: await prepareEvents(events), state, fetchedFeedIds, activeFeedIds, nowMs });

    const stats: SyncStats = { inserted: 0, updated: 0, deleted: 0, failed: 0, total: 0 };
    let authFailed = false;
    const guard = async (op: () => Promise<void>) => {
      if (authFailed) return;
      try {
        await op();
      } catch (e) {
        if (e instanceof GoogleApiError && e.status === 401) authFailed = true;
        stats.failed++;
      }
    };

    await pool(plan.inserts, (p) =>
      guard(async () => {
        await insertEvent(token, calendarId, p.event, p.id);
        state[p.id] = { feedId: p.event.feedId, hash: p.hash, startMs: p.event.startMs };
        stats.inserted++;
      }),
    );
    await syncStateItem.setValue(state); // checkpoint in case the worker is stopped
    await pool(plan.updates, (p) =>
      guard(async () => {
        await updateEvent(token, calendarId, p.event, p.id);
        state[p.id] = { feedId: p.event.feedId, hash: p.hash, startMs: p.event.startMs };
        stats.updated++;
      }),
    );
    await syncStateItem.setValue(state);
    await pool(plan.deletes, (id) =>
      guard(async () => {
        await deleteEvent(token, calendarId, id);
        delete state[id];
        stats.deleted++;
      }),
    );
    for (const id of plan.forget) delete state[id];
    await syncStateItem.setValue(state);

    if (authFailed) {
      await invalidateToken();
      throw new AuthRequiredError('Google sign-in expired. Reconnect Google Calendar.');
    }

    stats.total = Object.keys(state).length;
    const feedProblems = Object.keys(feedErrors).length;
    await statusItem.setValue({
      running: false,
      lastRunAt: nowMs,
      lastSuccessAt: Date.now(),
      stats,
      feedErrors,
      lastError: stats.failed
        ? `${stats.failed} event(s) failed to sync. They will be retried next time.`
        : feedProblems
          ? `${feedProblems} feed(s) need attention.`
          : undefined,
    });
  } catch (e) {
    await statusItem.setValue({
      ...(await statusItem.getValue()),
      running: false,
      feedErrors,
      lastError: errorMessage(e),
      needsAuth: e instanceof AuthRequiredError,
    });
  }
}
