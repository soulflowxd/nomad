export type FeedKind = 'canvas' | 'd2l' | 'ics';

export interface Feed {
  id: string;
  kind: FeedKind;
  label: string;
  /**
   * 'ics' (default): `url` is an iCal feed link. Secret: contains an access token, never log it.
   * 'api': `url` is a Canvas site origin; items are read through the Canvas API with the
   * user's logged-in session.
   */
  mode?: 'ics' | 'api';
  /** API mode: the Canvas user who connected. Data from any other logged-in user is rejected. */
  canvasUserId?: string;
  url: string;
  enabled: boolean;
}

/** Google Calendar time: all-day events use `date`, timed events use `dateTime`. */
export type EventTime = { date: string } | { dateTime: string; timeZone?: string };

export interface NormalizedEvent {
  feedId: string;
  /** Stable source identity: feed host + iCal UID. */
  sourceKey: string;
  title: string;
  description: string;
  location?: string;
  url?: string;
  start: EventTime;
  end: EventTime;
  startMs: number;
}

export interface PreparedEvent {
  /** Deterministic Google event ID. */
  id: string;
  /** Content hash, used to detect changes. */
  hash: string;
  event: NormalizedEvent;
}

export interface SyncEntry {
  feedId: string;
  hash: string;
  startMs: number;
}

export type SyncState = Record<string, SyncEntry>;

export interface SyncStats {
  inserted: number;
  updated: number;
  deleted: number;
  failed: number;
  total: number;
}

export interface SyncStatus {
  running: boolean;
  lastRunAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
  needsAuth?: boolean;
  stats?: SyncStats;
  feedErrors: Record<string, string>;
}
