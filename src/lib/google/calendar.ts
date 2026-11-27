import type { NormalizedEvent } from '../types';

const API = 'https://www.googleapis.com/calendar/v3';
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 4;

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public reason?: string,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gfetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
    });
    if (res.ok) return res.status === 204 ? null : ((await res.json()) as T);

    let reason: string | undefined;
    let message = `Google Calendar error ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
      reason = body.error?.errors?.[0]?.reason;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Non-JSON error body.
    }
    const rateLimited = res.status === 403 && (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded');
    if ((RETRYABLE.has(res.status) || rateLimited) && attempt < MAX_RETRIES) {
      await sleep(2 ** attempt * 1000 + Math.random() * 250);
      continue;
    }
    throw new GoogleApiError(res.status, message, reason);
  }
}

export interface GoogleCalendar {
  id: string;
  summary: string;
}

export async function createCalendar(token: string, summary: string): Promise<GoogleCalendar> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (await gfetch<GoogleCalendar>(token, '/calendars', {
    method: 'POST',
    body: JSON.stringify({ summary, timeZone, description: 'Synced from Canvas and D2L by Nomad.' }),
  }))!;
}

/** Returns null if the calendar was deleted or is no longer accessible. */
export async function getCalendar(token: string, id: string): Promise<GoogleCalendar | null> {
  try {
    return await gfetch<GoogleCalendar>(token, `/calendars/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) return null;
    throw e;
  }
}

export async function renameCalendar(token: string, id: string, summary: string): Promise<void> {
  await gfetch(token, `/calendars/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ summary }) });
}

export function toGoogleEvent(ev: NormalizedEvent, id: string) {
  return {
    id,
    status: 'confirmed',
    summary: ev.title,
    description: ev.description,
    location: ev.location,
    start: ev.start,
    end: ev.end,
    transparency: 'transparent',
    ...(ev.url ? { source: { title: 'Open in LMS', url: ev.url } } : {}),
    extendedProperties: { private: { schoolSync: '1', feedId: ev.feedId } },
  };
}

function eventPath(calendarId: string, eventId?: string) {
  return `/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${eventId}` : ''}`;
}

export async function insertEvent(token: string, calendarId: string, ev: NormalizedEvent, id: string): Promise<void> {
  try {
    await gfetch(token, eventPath(calendarId), { method: 'POST', body: JSON.stringify(toGoogleEvent(ev, id)) });
  } catch (e) {
    // 409: the ID already exists (e.g. a previously deleted event). Overwrite it instead.
    if (e instanceof GoogleApiError && e.status === 409) {
      await gfetch(token, eventPath(calendarId, id), { method: 'PUT', body: JSON.stringify(toGoogleEvent(ev, id)) });
      return;
    }
    throw e;
  }
}

export async function updateEvent(token: string, calendarId: string, ev: NormalizedEvent, id: string): Promise<void> {
  try {
    await gfetch(token, eventPath(calendarId, id), { method: 'PUT', body: JSON.stringify(toGoogleEvent(ev, id)) });
  } catch (e) {
    if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) {
      await insertEvent(token, calendarId, ev, id);
      return;
    }
    throw e;
  }
}

export async function deleteEvent(token: string, calendarId: string, id: string): Promise<void> {
  try {
    await gfetch(token, eventPath(calendarId, id), { method: 'DELETE' });
  } catch (e) {
    if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) return;
    throw e;
  }
}
