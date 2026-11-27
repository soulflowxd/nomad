import { describe, expect, it } from 'vitest';
import { looksTruncated, planSync } from '../src/lib/sync/diff';
import { base32hex, contentHash, eventIdFor, prepareEvents } from '../src/lib/sync/ids';
import type { NormalizedEvent, SyncState } from '../src/lib/types';

const NOW = Date.UTC(2027, 0, 1);
const DAY = 86_400_000;

function ev(uid: string, feedId = 'f1', startMs = NOW + DAY, title = uid): NormalizedEvent {
  const iso = new Date(startMs).toISOString();
  return {
    feedId,
    sourceKey: `host\n${uid}`,
    title,
    description: '',
    start: { dateTime: iso },
    end: { dateTime: iso },
    startMs,
  };
}

describe('ids', () => {
  it('produces valid, stable Google event IDs', async () => {
    const a = await eventIdFor('host\nuid-1');
    expect(a).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(await eventIdFor('host\nuid-1')).toBe(a);
    expect(await eventIdFor('host\nuid-2')).not.toBe(a);
  });

  it('base32hex encodes known bytes', () => {
    expect(base32hex(new Uint8Array([0xff]))).toBe('vs');
    expect(base32hex(new Uint8Array([]))).toBe('');
  });

  it('content hash changes when the event changes', async () => {
    expect(await contentHash(ev('a'))).toBe(await contentHash(ev('a')));
    expect(await contentHash(ev('a', 'f1', NOW + DAY, 'renamed'))).not.toBe(await contentHash(ev('a')));
  });
});

describe('looksTruncated', () => {
  const tracked = (n: number): SyncState =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`e${i}`, { feedId: 'f1', hash: 'h', startMs: NOW + DAY }]));

  it('flags an empty feed that used to have future events', () => {
    expect(looksTruncated('f1', [], tracked(3), NOW)).toBe(true);
  });

  it('flags a large drop', () => {
    expect(looksTruncated('f1', [ev('a')], tracked(20), NOW)).toBe(true);
  });

  it('allows normal changes and brand-new feeds', () => {
    expect(looksTruncated('f1', [ev('a'), ev('b')], tracked(3), NOW)).toBe(false);
    expect(looksTruncated('f1', [], {}, NOW)).toBe(false);
  });
});

describe('planSync', () => {
  const all = new Set(['f1', 'f2']);

  it('inserts new events and skips unchanged ones', async () => {
    const desired = await prepareEvents([ev('a'), ev('b')]);
    const state: SyncState = { [desired[0]!.id]: { feedId: 'f1', hash: desired[0]!.hash, startMs: NOW + DAY } };
    const plan = planSync({ desired, state, fetchedFeedIds: all, activeFeedIds: all, nowMs: NOW });
    expect(plan.inserts.map((p) => p.id)).toEqual([desired[1]!.id]);
    expect(plan.updates).toEqual([]);
  });

  it('updates changed events', async () => {
    const p = (await prepareEvents([ev("a")]))[0]!;
    const state: SyncState = { [p.id]: { feedId: 'f1', hash: 'old', startMs: NOW + DAY } };
    const plan = planSync({ desired: [p], state, fetchedFeedIds: all, activeFeedIds: all, nowMs: NOW });
    expect(plan.updates.map((u) => u.id)).toEqual([p.id]);
  });

  it('deletes future removed items, forgets past ones', () => {
    const state: SyncState = {
      future: { feedId: 'f1', hash: 'h', startMs: NOW + DAY },
      past: { feedId: 'f1', hash: 'h', startMs: NOW - DAY },
    };
    const plan = planSync({ desired: [], state, fetchedFeedIds: all, activeFeedIds: all, nowMs: NOW });
    expect(plan.deletes).toEqual(['future']);
    expect(plan.forget).toEqual(['past']);
  });

  it('keeps events from a feed that failed to download', () => {
    const state: SyncState = { x: { feedId: 'f2', hash: 'h', startMs: NOW + DAY } };
    const plan = planSync({ desired: [], state, fetchedFeedIds: new Set(['f1']), activeFeedIds: all, nowMs: NOW });
    expect(plan.deletes).toEqual([]);
    expect(plan.forget).toEqual([]);
  });

  it('cleans up events from disabled or removed feeds', () => {
    const state: SyncState = { x: { feedId: 'gone', hash: 'h', startMs: NOW + DAY } };
    const plan = planSync({ desired: [], state, fetchedFeedIds: new Set(), activeFeedIds: all, nowMs: NOW });
    expect(plan.deletes).toEqual(['x']);
  });

  it('dedupes repeated source items', async () => {
    const desired = await prepareEvents([ev('a'), ev('a')]);
    const plan = planSync({ desired, state: {}, fetchedFeedIds: all, activeFeedIds: all, nowMs: NOW });
    expect(plan.inserts).toHaveLength(1);
  });
});
