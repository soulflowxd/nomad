import ICAL from 'ical.js';
import type { EventTime, Feed, NormalizedEvent } from '../types';

const MAX_DESCRIPTION = 4000;

function toEventTime(t: ICAL.Time, tzid?: string): EventTime {
  // Date-only values become all-day events ("YYYY-MM-DD").
  if (t.isDate) return { date: t.toString() };
  // TZID without a VTIMEZONE block: ical.js can't convert it, so let Google resolve the IANA zone.
  if (tzid && !ICAL.TimezoneService.has(tzid)) return { dateTime: t.toString(), timeZone: tzid };
  return { dateTime: t.toJSDate().toISOString() };
}

function tzidOf(vevent: ICAL.Component, name: 'dtstart' | 'dtend'): string | undefined {
  const value = vevent.getFirstProperty(name)?.getParameter('tzid');
  return typeof value === 'string' && value ? value : undefined;
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function sourceHost(feedUrl: string): string {
  try {
    return new URL(feedUrl).host.toLowerCase();
  } catch {
    return 'unknown';
  }
}

/** Parse an iCalendar feed into events ready for Google Calendar. */
export function parseFeed(text: string, feed: Pick<Feed, 'id' | 'kind' | 'url'>): NormalizedEvent[] {
  const jcal = ICAL.parse(text);
  const calendars = (Array.isArray(jcal[0]) ? jcal : [jcal]) as unknown[];
  const host = sourceHost(feed.url);
  const sourceName = feed.kind === 'ics' ? 'calendar feed' : FEED_KIND_LABEL[feed.kind];
  const out: NormalizedEvent[] = [];

  for (const cal of calendars) {
    const root = new ICAL.Component(cal as ConstructorParameters<typeof ICAL.Component>[0]);
    for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);

    for (const vevent of root.getAllSubcomponents('vevent')) {
      const status = vevent.getFirstPropertyValue('status');
      if (typeof status === 'string' && status.toUpperCase() === 'CANCELLED') continue;

      const ev = new ICAL.Event(vevent);
      if (!ev.uid || !ev.startDate) continue;

      const start = ev.startDate;
      let end: ICAL.Time;
      if (vevent.hasProperty('dtend') || vevent.hasProperty('duration')) {
        end = ev.endDate;
      } else {
        end = start.clone();
      }
      // Google treats all-day end dates as exclusive, so a one-day item needs end = start + 1 day.
      // A date start with a date-time end is invalid for Google, so normalize it the same way.
      if (start.isDate && (!end.isDate || end.compare(start) <= 0)) {
        end = start.clone();
        end.adjust(1, 0, 0, 0);
      }

      const url = httpUrl(vevent.getFirstPropertyValue('url'));
      const rawDescription = (ev.description ?? '').trim();
      const footer = [url ? `Open: ${url}` : '', `Synced from ${sourceName}`].filter(Boolean).join('\n');
      const body = rawDescription.length > MAX_DESCRIPTION
        ? `${rawDescription.slice(0, MAX_DESCRIPTION)}…`
        : rawDescription;

      // Recurrence overrides share the master's UID; keep them distinct.
      const recurrenceId = vevent.getFirstPropertyValue('recurrence-id');
      const startTzid = tzidOf(vevent, 'dtstart');
      out.push({
        feedId: feed.id,
        sourceKey: `${host}\n${ev.uid}${recurrenceId ? `\n${String(recurrenceId)}` : ''}`,
        title: (ev.summary ?? '').trim() || '(untitled)',
        description: body ? `${body}\n\n${footer}` : footer,
        location: ev.location?.trim() || undefined,
        url,
        start: toEventTime(start, startTzid),
        end: toEventTime(end, vevent.hasProperty('dtend') ? tzidOf(vevent, 'dtend') : startTzid),
        startMs: start.toJSDate().getTime(),
      });
    }
  }
  return out;
}

/** Guess which LMS a feed URL belongs to. */
export function detectFeedKind(url: string): Feed['kind'] {
  const u = url.toLowerCase();
  if (u.includes('/feeds/calendars/') || u.includes('instructure.com')) return 'canvas';
  if (u.includes('/d2l/') || u.includes('brightspace.com')) return 'd2l';
  if (u.includes('/webapps/calendar/calendarfeed/') || u.includes('blackboard.com')) return 'blackboard';
  if (u.includes('/calendar/export_execute.php')) return 'moodle';
  if (u.includes('/calendar/feed/ical/') || u.includes('schoology.com')) return 'schoology';
  if (u.includes('/access/calendar/opaq/')) return 'sakai';
  return 'ics';
}

export const FEED_KIND_LABEL: Record<Feed['kind'], string> = {
  canvas: 'Canvas',
  d2l: 'D2L',
  blackboard: 'Blackboard',
  moodle: 'Moodle',
  schoology: 'Schoology',
  sakai: 'Sakai',
  ics: 'iCal',
};

/** Host permission pattern for a feed, e.g. "https://school.instructure.com/*". */
export function feedOrigin(url: string): string {
  return `${new URL(url).origin}/*`;
}

/** Accepts https:// or webcal:// feed URLs; returns a normalized https URL or null. */
export function normalizeFeedUrl(input: string): string | null {
  const trimmed = input.trim().replace(/^webcals?:\/\//i, 'https://');
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}
