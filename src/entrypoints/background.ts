import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { connectGoogle, disconnectGoogle } from '@/lib/google/auth';
import type { Message, MessageResponse } from '@/lib/messages';
import { settingsItem, statusItem } from '@/lib/storage';
import { clearStaleRunningFlag, runSync } from '@/lib/sync/run';

const ALARM = 'sync';
const MIN_INTERVAL = 15;

async function scheduleAlarm() {
  const { intervalMinutes } = await settingsItem.getValue();
  const period = Math.max(MIN_INTERVAL, intervalMinutes);
  const existing = await browser.alarms.get(ALARM);
  if (existing?.periodInMinutes === period) return;
  await browser.alarms.create(ALARM, { periodInMinutes: period, delayInMinutes: 1 });
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

export default defineBackground(() => {
  // A fresh worker has no sync in flight; clear a flag left by a worker that was stopped mid-sync.
  void clearStaleRunningFlag();
  browser.runtime.onInstalled.addListener(() => void scheduleAlarm());
  browser.runtime.onStartup.addListener(() => {
    void scheduleAlarm();
    void runSync();
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void runSync();
  });
  settingsItem.watch(() => void scheduleAlarm());

  browser.runtime.onMessage.addListener((message: Message, sender, sendResponse: (r: MessageResponse) => void) => {
    // Only accept messages from this extension's own pages (popup, or options opened in a tab).
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('/'))) return false;
    handle(message).then(
      () => sendResponse({ ok: true }),
      (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  });
});
