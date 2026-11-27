import { describe, expect, it } from 'vitest';
import { nextLink, plannerItemsToEvents, sanitizePlannerItems } from '../src/lib/feeds/canvas-api';

const feed = { id: 'c1', url: 'https://school.instructure.com' };

const raw = [
  {
    plannable_type: 'assignment',
    plannable_id: 1001,
    plannable_date: '2027-01-15T05:59:00Z',
    context_name: 'CS 101',
    html_url: '/courses/1/assignments/1001',
    plannable: { title: 'Homework 3', points_possible: 10 },
    submissions: { submitted: true },
  },
  {
    plannable_type: 'calendar_event',
    plannable_id: '2002',
    plannable_date: '2027-02-01T15:00:00Z',
    html_url: 'https://evil.example.com/phish',
    plannable: { title: 'Review session', end_at: '2027-02-01T16:30:00Z', location_name: 'Room 204' },
  },
  { plannable_type: 'announcement', plannable_id: 3, plannable_date: '2027-01-02T00:00:00Z', plannable: { title: 'News' } },
  { plannable_type: 'assignment', plannable_id: 4, plannable_date: 'not a date', plannable: { title: 'Broken' } },
  'garbage',
  null,
];

describe('sanitizePlannerItems', () => {
  it('drops malformed items and keeps typed fields', () => {
    const items = sanitizePlannerItems(raw);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ plannable_id: '1001', title: 'Homework 3', submitted: true });
  });

  it('returns [] for non-arrays', () => {
    expect(sanitizePlannerItems({ items: [] })).toEqual([]);
  });
});

describe('plannerItemsToEvents', () => {
  const events = plannerItemsToEvents(sanitizePlannerItems(raw), feed);

  it('skips announcements', () => {
    expect(events.map((e) => e.title)).not.toContain('News');
    expect(events).toHaveLength(2);
  });

  it('maps an assignment with course, link and submitted mark', () => {
    const hw = events[0]!;
    expect(hw.title).toBe('✓ Homework 3 [CS 101]');
    expect(hw.start).toEqual({ dateTime: '2027-01-15T05:59:00.000Z' });
    expect(hw.end).toEqual(hw.start);
    expect(hw.url).toBe('https://school.instructure.com/courses/1/assignments/1001');
    // Same key as the Canvas iCal feed's UID, so switching sources doesn't duplicate events.
    expect(hw.sourceKey).toBe('school.instructure.com\nevent-assignment-1001');
  });

  it('keeps event end times and drops off-site links', () => {
    const ev = events[1]!;
    expect(ev.end).toEqual({ dateTime: '2027-02-01T16:30:00.000Z' });
    expect(ev.location).toBe('Room 204');
    expect(ev.url).toBeUndefined();
  });

  it('makes all-day items span one day', () => {
    const [ev] = plannerItemsToEvents(
      [{ plannable_type: 'calendar_event', plannable_id: '9', plannable_date: '2027-03-01T12:00:00Z', title: 'Holiday', all_day: true }],
      feed,
    );
    expect(ev!.start).toHaveProperty('date');
    expect(ev!.end).toHaveProperty('date');
    expect(ev!.end).not.toEqual(ev!.start);
  });
});

describe('nextLink', () => {
  const origin = 'https://school.instructure.com';
  it('finds rel=next on the same origin', () => {
    const header = `<${origin}/api/v1/planner/items?page=1>; rel="current",<${origin}/api/v1/planner/items?page=2>; rel="next"`;
    expect(nextLink(header, origin)).toBe(`${origin}/api/v1/planner/items?page=2`);
  });
  it('refuses other origins and missing headers', () => {
    expect(nextLink('<https://evil.example.com/x>; rel="next"', origin)).toBeNull();
    expect(nextLink(null, origin)).toBeNull();
  });
});
