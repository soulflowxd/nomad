/*
 * Canvas REST API source.
 *
 * Approach adapted from Better Canvas (https://github.com/UseBetterCanvas/bettercanvas),
 * Copyright (C) Better Canvas contributors, licensed under AGPL-3.0: read
 * `/api/v1/planner/items` with the user's existing Canvas session (see its getData() and
 * getAssignments() in js/content.js). Modified for Nomad: pagination, end_date window,
 * input sanitizing, and mapping to Google Calendar events.
 */
import { addDays, format } from 'date-fns';
import { WINDOW_FUTURE_MS, WINDOW_PAST_MS } from '../sync/diff';
import type { EventTime, Feed, NormalizedEvent } from '../types';

export interface PlannerItem {
  plannable_type: string;
  plannable_id: string;
  plannable_date: string;
  title: string;
  context_name?: string;
  html_url?: string;
  all_day?: boolean;
  end_at?: string;
  location?: string;
  submitted?: boolean;
}

const MAX_ITEMS = 3000;
const MAX_PAGES = 30;
const SKIP_TYPES = new Set(['announcement', 'assessment_request']);

export class CanvasApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CanvasApiError';
  }
}

function str(value: unknown, max = 500): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t ? t.slice(0, max) : undefined;
}

/** Keeps only the fields Nomad uses, with type checks. Safe for untrusted input. */
export function sanitizePlannerItems(raw: unknown): PlannerItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PlannerItem[] = [];
  for (const r of raw.slice(0, MAX_ITEMS)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const p = (o.plannable && typeof o.plannable === 'object' ? o.plannable : {}) as Record<string, unknown>;
    const type = str(o.plannable_type, 50);
    const id = o.plannable_id;
    const date = str(o.plannable_date, 40);
    if (!type || (typeof id !== 'string' && typeof id !== 'number') || !date || Number.isNaN(Date.parse(date))) continue;
    const sub = o.submissions && typeof o.submissions === 'object' ? (o.submissions as Record<string, unknown>) : undefined;
    const endAt = str(p.end_at, 40);
    out.push({
      plannable_type: type,
      plannable_id: String(id).slice(0, 50),
      plannable_date: date,
      title: str(p.title) ?? str(p.name) ?? '(untitled)',
      context_name: str(o.context_name, 200),
      html_url: str(o.html_url, 1000),
      all_day: p.all_day === true,
      end_at: endAt && !Number.isNaN(Date.parse(endAt)) ? endAt : undefined,
      location: str(p.location_name, 300),
      submitted: sub?.submitted === true,
    });
  }
  return out;
}

export function plannerItemsToEvents(items: PlannerItem[], feed: Pick<Feed, 'id' | 'url'>): NormalizedEvent[] {
  const base = new URL(feed.url);
  const out: NormalizedEvent[] = [];
  for (const item of items) {
    if (SKIP_TYPES.has(item.plannable_type)) continue;
    const startDate = new Date(item.plannable_date);
    let start: EventTime;
    let end: EventTime;
    if (item.all_day) {
      start = { date: format(startDate, 'yyyy-MM-dd') };
      end = { date: format(addDays(startDate, 1), 'yyyy-MM-dd') };
    } else {
      start = { dateTime: startDate.toISOString() };
      const endDate = item.end_at ? new Date(item.end_at) : null;
      end = endDate && endDate > startDate ? { dateTime: endDate.toISOString() } : start;
    }

    let url: string | undefined;
    if (item.html_url) {
      try {
        const u = new URL(item.html_url, base.origin);
        if (u.origin === base.origin) url = u.toString();
      } catch {
        // Ignore malformed links.
      }
    }

    const title = `${item.submitted ? '✓ ' : ''}${item.title}${item.context_name ? ` [${item.context_name}]` : ''}`;
    // Match Canvas's iCal UIDs where they exist, so switching from a feed link reuses the same events.
    const icsUid =
      item.plannable_type === 'assignment'
        ? `event-assignment-${item.plannable_id}`
        : item.plannable_type === 'calendar_event'
          ? `event-calendar-event-${item.plannable_id}`
          : `planner-${item.plannable_type}-${item.plannable_id}`;
    out.push({
      feedId: feed.id,
      sourceKey: `${base.host.toLowerCase()}\n${icsUid}`,
      title,
      description: [url ? `Open: ${url}` : '', 'Synced from Canvas'].filter(Boolean).join('\n'),
      location: item.location,
      url,
      start,
      end,
      startMs: startDate.getTime(),
    });
  }
  return out;
}

/** Parses a Canvas `Link` header and returns the same-origin rel="next" URL, if any. */
export function nextLink(header: string | null, origin: string): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(part);
    if (!m) continue;
    try {
      const u = new URL(m[1]!);
      return u.origin === origin ? u.toString() : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Returns the logged-in Canvas user's ID, or throws if not logged in. */
export async function fetchCanvasUserId(origin: string, init: RequestInit = {}): Promise<string> {
  const res = await fetch(`${origin}/api/v1/users/self`, { ...init, headers: { Accept: 'application/json' } });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) {
    throw new CanvasApiError(401, 'Not logged in to Canvas.');
  }
  const user = JSON.parse((await res.text()).replace(/^while\(1\);/, '')) as { id?: unknown };
  if (typeof user.id !== 'string' && typeof user.id !== 'number') throw new CanvasApiError(401, 'Not logged in to Canvas.');
  return String(user.id);
}

/** Fetches all planner items in the sync window. `init` decides how the session is sent. */
export async function fetchPlannerItems(origin: string, nowMs: number, init: RequestInit = {}): Promise<unknown[]> {
  const params = new URLSearchParams({
    start_date: new Date(nowMs - WINDOW_PAST_MS).toISOString(),
    end_date: new Date(nowMs + WINDOW_FUTURE_MS).toISOString(),
    per_page: '100',
  });
  let url: string | null = `${origin}/api/v1/planner/items?${params}`;
  const all: unknown[] = [];
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res: Response = await fetch(url, { ...init, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new CanvasApiError(res.status, `Canvas API error (HTTP ${res.status}).`);
    if (!(res.headers.get('content-type') ?? '').includes('json')) {
      throw new CanvasApiError(401, 'Not logged in to Canvas.');
    }
    // Canvas may prefix JSON with "while(1);" to block JSON hijacking.
    const data: unknown = JSON.parse((await res.text()).replace(/^while\(1\);/, ''));
    if (!Array.isArray(data)) throw new CanvasApiError(500, 'Unexpected Canvas API response.');
    all.push(...data);
    if (all.length >= MAX_ITEMS) break;
    url = nextLink(res.headers.get('link'), origin);
  }
  return all;
}
