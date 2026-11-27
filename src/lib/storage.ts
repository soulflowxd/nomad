import { storage } from 'wxt/utils/storage';
import type { Feed, SyncState, SyncStatus } from './types';

export interface Settings {
  intervalMinutes: number;
  calendarName: string;
}

export const DEFAULT_SETTINGS: Settings = { intervalMinutes: 30, calendarName: 'School (Canvas & D2L)' };

export const settingsItem = storage.defineItem<Settings>('local:settings', { fallback: DEFAULT_SETTINGS });
export const feedsItem = storage.defineItem<Feed[]>('local:feeds', { fallback: [] });
export const calendarItem = storage.defineItem<{ id: string; name: string } | null>('local:calendar', {
  fallback: null,
});
export const syncStateItem = storage.defineItem<SyncState>('local:syncState', { fallback: {} });
export const statusItem = storage.defineItem<SyncStatus>('local:status', {
  fallback: { running: false, feedErrors: {} },
});
export const accountItem = storage.defineItem<{ email?: string } | null>('local:account', { fallback: null });
/** Short-lived Google access token. Session storage is cleared when the browser closes. */
export const tokenItem = storage.defineItem<{ accessToken: string; expiresAt: number } | null>('session:token', {
  fallback: null,
});
