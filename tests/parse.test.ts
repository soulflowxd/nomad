import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectFeedKind, normalizeFeedUrl, parseFeed } from '../src/lib/feeds/parse';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const canvasFeed = { id: 'f1', kind: 'canvas' as const, url: 'https://school.instructure.com/feeds/calendars/user_abc.ics' };
const d2lFeed = { id: 'f2', kind: 'd2l' as const, url: 'https://school.brightspace.com/d2l/le/calendar/feed/user/feed.ics?token=x' };

describe('parseFeed (Canvas)', () => {
  const events = parseFeed(fixture('canvas.ics'), canvasFeed);

  it('skips cancelled events', () => {
    expect(events.map((e) => e.title)).not.toContain('Cancelled thing');
    expect(events).toHaveLength(3);
  });

  it('parses a timed assignment with its URL', () => {
    const hw = events.find((e) => e.title === 'Homework 3 [CS 101]')!;
    expect(hw.start).toEqual({ dateTime: '2027-01-15T05:59:00.000Z' });
    expect(hw.end).toEqual(hw.start);
    expect(hw.url).toBe('https://school.instructure.com/courses/1/assignments/1001');
    expect(hw.description).toContain('Answer questions 1-5.');
    expect(hw.description).toContain('Synced from Canvas');
    expect(hw.sourceKey).toBe('school.instructure.com\nevent-assignment-1001');
  });

  it('gives all-day events an exclusive next-day end', () => {
    const rw = events.find((e) => e.title.startsWith('Reading week'))!;
    expect(rw.start).toEqual({ date: '2027-01-20' });
    expect(rw.end).toEqual({ date: '2027-01-21' });
  });

  it('drops non-http URLs and keeps location', () => {
    const review = events.find((e) => e.title === 'Midterm review session')!;
    expect(review.url).toBeUndefined();
    expect(review.location).toBe('Room 204');
    expect(review.end).toEqual({ dateTime: '2027-02-01T16:30:00.000Z' });
  });
});

describe('parseFeed (D2L)', () => {
  it('converts TZID times using the feed VTIMEZONE', () => {
    const ev = parseFeed(fixture("d2l.ics"), d2lFeed)[0]!;
    // 23:59 EST (UTC-5) is 04:59 UTC the next day.
    expect(ev.start).toEqual({ dateTime: '2027-01-16T04:59:00.000Z' });
    expect(ev.location).toBe('CHEM 110');
    expect(ev.description).toContain('Synced from D2L');
  });
});

const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;

describe('parseFeed edge cases', () => {
  it('passes an unknown TZID through to Google instead of guessing', () => {
    const text = wrap('BEGIN:VEVENT\r\nUID:x1\r\nDTSTART;TZID=America/New_York:20270301T090000\r\nSUMMARY:Quiz\r\nEND:VEVENT');
    const ev = parseFeed(text, d2lFeed)[0]!;
    expect(ev.start).toEqual({ dateTime: '2027-03-01T09:00:00', timeZone: 'America/New_York' });
  });

  it('forces a date end when the start is a date', () => {
    const text = wrap('BEGIN:VEVENT\r\nUID:x2\r\nDTSTART;VALUE=DATE:20270301\r\nDTEND:20270301T120000Z\r\nSUMMARY:Mixed\r\nEND:VEVENT');
    const ev = parseFeed(text, canvasFeed)[0]!;
    expect(ev.end).toEqual({ date: '2027-03-02' });
  });

  it('gives recurrence overrides their own source key', () => {
    const text = wrap(
      'BEGIN:VEVENT\r\nUID:r\r\nDTSTART:20270301T090000Z\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:Lecture\r\nEND:VEVENT\r\n' +
        'BEGIN:VEVENT\r\nUID:r\r\nRECURRENCE-ID:20270308T090000Z\r\nDTSTART:20270308T100000Z\r\nSUMMARY:Lecture (moved)\r\nEND:VEVENT',
    );
    const keys = parseFeed(text, canvasFeed).map((e) => e.sourceKey);
    expect(new Set(keys).size).toBe(2);
  });
});

describe('feed URL helpers', () => {
  it('normalizes webcal and rejects http', () => {
    expect(normalizeFeedUrl('webcal://school.instructure.com/feeds/calendars/user_a.ics')).toBe(
      'https://school.instructure.com/feeds/calendars/user_a.ics',
    );
    expect(normalizeFeedUrl('http://example.com/a.ics')).toBeNull();
    expect(normalizeFeedUrl('not a url')).toBeNull();
  });

  it('detects the LMS', () => {
    expect(detectFeedKind(canvasFeed.url)).toBe('canvas');
    expect(detectFeedKind(d2lFeed.url)).toBe('d2l');
    expect(detectFeedKind('https://learn.uni.edu/webapps/calendar/calendarFeed/abc123/learn.ics')).toBe('blackboard');
    expect(detectFeedKind('https://moodle.uni.edu/calendar/export_execute.php?userid=5&authtoken=x&preset_what=all')).toBe('moodle');
    expect(detectFeedKind('webcal://app.schoology.com/calendar/feed/ical/123/abc/ical.ics')).toBe('schoology');
    expect(detectFeedKind('https://sakai.uni.edu/access/calendar/opaq/1a2b-3c/main.ics')).toBe('sakai');
    expect(detectFeedKind('https://example.com/cal.ics')).toBe('ics');
  });

  it('labels events with the LMS name', () => {
    const text = wrap('BEGIN:VEVENT\r\nUID:bb1\r\nDTSTART:20270301T090000Z\r\nSUMMARY:Essay\r\nEND:VEVENT');
    const ev = parseFeed(text, { id: 'b', kind: 'blackboard', url: 'https://learn.uni.edu/x.ics' })[0]!;
    expect(ev.description).toContain('Synced from Blackboard');
  });
});
