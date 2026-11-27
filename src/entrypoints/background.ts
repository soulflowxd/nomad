import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { sanitizePlannerItems } from '@/lib/feeds/canvas-api';
import { feedOrigin } from '@/lib/feeds/parse';
import { connectGoogle, disconnectGoogle } from '@/lib/google/auth';
import type { ContentMessage, Message, MessageResponse } from '@/lib/messages';
import { canvasCacheItem, feedsItem, settingsItem, statusItem } from '@/lib/storage';
import { clearStaleRunningFlag, runSync, saveCanvasSnapshot } from '@/lib/sync/run';

const ALARM = 'sync';
const MIN_INTERVAL = 15;
const CANVAS_SCRIPT_ID = 'canvas-api';
const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;
const MIN_SNAPSHOT_GAP_MS = 2 * 60 * 1000;

async function scheduleAlarm() {
  const { intervalMinutes } = await settingsItem.getValue();
  const period = Math.max(MIN_INTERVAL, intervalMinutes);
  const existing = await browser.alarms.get(ALARM);
  if (existing?.periodInMinutes === period) return;
  await browser.alarms.create(ALARM, { periodInMinutes: period, delayInMinutes: 1 });
}

/** Registers the Canvas content script only on connected Canvas sites the user granted. */
let registering: Promise<void> = Promise.resolve();
function syncContentScripts(): Promise<void> {
  registering = registering.then(async () => {
    const feeds = await feedsItem.getValue();
    const origins = [...new Set(feeds.filter((f) => f.mode === 'api' && f.enabled).map((f) => feedOrigin(f.url)))];
    const granted: string[] = [];
    for (const o of origins) if (await browser.permissions.contains({ origins: [o] })) granted.push(o);
    const existing = await browser.scripting.getRegisteredContentScripts({ ids: [CANVAS_SCRIPT_ID] });
    if (existing.length) await browser.scripting.unregisterContentScripts({ ids: [CANVAS_SCRIPT_ID] });
    if (granted.length) {
      await browser.scripting.registerContentScripts([
        { id: CANVAS_SCRIPT_ID, matches: granted, js: ['content-scripts/canvas.js'], runAt: 'document_idle', persistAcrossSessions: true },
      ]);
    }
  }).catch((e: unknown) => console.warn('Nomad: content script registration failed', e));
  return registering;
}

async function handle(message: Message): Promise<void> {
  switch (message.type) {
    case 'sync-now':
      return runSync();
    case 'connect':
      await connectGoogle();
      await statusItem.setValue({ ...(await statusItem.getValue()), needsAuth: false, lastError: undefined });
      return runSync();
    case 'disconnect':
      return disconnectGoogle();
  }
}

async function connectedCanvasFeed(origin: string) {
  const feeds = await feedsItem.getValue();
  return feeds.find((f) => f.mode === 'api' && f.enabled && new URL(f.url).origin === origin);
}

/** Whether the content script on `origin` should take a new snapshot. */
async function canvasDue(origin: string): Promise<boolean> {
  if (!(await connectedCanvasFeed(origin))) return false;
  const cached = (await canvasCacheItem.getValue())[origin];
  return !cached || Date.now() - cached.fetchedAt > SNAPSHOT_INTERVAL_MS;
}

/** A snapshot from the Canvas content script. Trust only the sender's origin, never the payload. */
async function handleCanvasItems(origin: string, userId: unknown, items: unknown): Promise<void> {
  const feed = await connectedCanvasFeed(origin);
  if (!feed || (typeof userId !== 'string' && typeof userId !== 'number')) return;
  // Ignore snapshots from a different Canvas account than the one connected.
  if (feed.canvasUserId && String(userId) !== feed.canvasUserId) return;
  // Rate limit, in case a page sends snapshots repeatedly.
  const cached = (await canvasCacheItem.getValue())[origin];
  if (cached && Date.now() - cached.fetchedAt < MIN_SNAPSHOT_GAP_MS) return;
  await saveCanvasSnapshot(origin, String(userId), sanitizePlannerItems(items));
  await runSync();
}

export default defineBackground(() => {
  // A fresh worker has no sync in flight; clear a flag left by a worker that was stopped mid-sync.
  void clearStaleRunningFlag();
  browser.runtime.onInstalled.addListener(() => {
    void scheduleAlarm();
    void syncContentScripts();
  });
  browser.runtime.onStartup.addListener(() => {
    void scheduleAlarm();
    void syncContentScripts();
    void runSync();
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void runSync();
  });
  settingsItem.watch(() => void scheduleAlarm());
  feedsItem.watch(() => void syncContentScripts());
  browser.permissions.onRemoved.addListener(() => void syncContentScripts());

  browser.runtime.onMessage.addListener(
    (message: Message | ContentMessage, sender, sendResponse: (r: MessageResponse | boolean) => void) => {
      if (sender.id !== browser.runtime.id) return false;

      // From the Canvas content script running in a tab.
      if (message.type === 'canvas-due' || message.type === 'canvas-items') {
        if (!sender.tab || !sender.origin) return false;
        if (message.type === 'canvas-due') {
          canvasDue(sender.origin).then(sendResponse, () => sendResponse(false));
          return true;
        }
        void handleCanvasItems(sender.origin, message.userId, message.items);
        return false;
      }

      // Only accept control messages from this extension's own pages (popup, or options in a tab).
      if (!sender.url?.startsWith(browser.runtime.getURL('/'))) return false;
      handle(message).then(
        () => sendResponse({ ok: true }),
        (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      );
      return true;
    },
  );
});
