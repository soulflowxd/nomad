import { formatDistanceToNow } from 'date-fns';
import { AlertCircle, Link2, Loader2, RefreshCw, ScanSearch, Settings, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { checkCanvasSession, findFeedUrlsInPage } from '@/lib/feeds/detect';
import { detectFeedKind, FEED_KIND_LABEL, feedOrigin, normalizeFeedUrl } from '@/lib/feeds/parse';
import { getClientId, getRedirectUrl } from '@/lib/google/auth';
import { send } from '@/lib/messages';
import { accountItem, calendarItem, canvasCacheItem, feedsItem, statusItem } from '@/lib/storage';
import type { Feed } from '@/lib/types';
import { useNow, useStorageValue } from '@/lib/use-storage';

const KIND_LABEL = FEED_KIND_LABEL;

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function App() {
  const feeds = useStorageValue(feedsItem) ?? [];
  const status = useStorageValue(statusItem);
  const account = useStorageValue(accountItem);
  const calendar = useStorageValue(calendarItem);
  useNow(); // keeps "Last synced … ago" fresh

  const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'detect'>(null);
  const [error, setError] = useState<string>();
  const [urlInput, setUrlInput] = useState('');
  const [urlTouched, setUrlTouched] = useState(false);
  const [detected, setDetected] = useState<string[] | null>(null);

  // A logged-in Canvas page in the active tab, found when the popup opens.
  const [canvasTab, setCanvasTab] = useState<{ origin: string; user: string; userId: string } | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !tab.url?.startsWith('https://')) return;
        const [result] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: checkCanvasSession });
        const user = result?.result as { name: string; id: string } | null | undefined;
        if (user) setCanvasTab({ origin: new URL(tab.url).origin, user: user.name, userId: user.id });
      } catch {
        // Not a page we can inspect (e.g. chrome:// pages).
      }
    })();
  }, []);
  const canvasAlreadyConnected = !!canvasTab && feeds.some((f) => f.mode === 'api' && new URL(f.url).origin === canvasTab.origin);

  async function connectCanvas() {
    if (!canvasTab) return;
    const { origin } = canvasTab;
    // Must be the first await so the click still counts as a user gesture.
    const granted = await browser.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) {
      setError(`Site access to ${hostOf(origin)} is needed to read your assignments.`);
      return;
    }
    const current = await feedsItem.getValue();
    if (!current.some((f) => f.mode === 'api' && new URL(f.url).origin === origin)) {
      const feed: Feed = {
        id: crypto.randomUUID(),
        kind: 'canvas',
        mode: 'api',
        label: `Canvas account · ${hostOf(origin)}`,
        url: origin,
        canvasUserId: canvasTab.userId,
        enabled: true,
      };
      // The account replaces any Canvas feed link for the same school (same events, no duplicates).
      const updated = current.map((f) =>
        f.mode !== 'api' && f.kind === 'canvas' && new URL(f.url).host === new URL(origin).host ? { ...f, enabled: false } : f,
      );
      await feedsItem.setValue([...updated, feed]);
    }
    setError(undefined);
    void run('sync', 'sync-now');
  }

  const clientId = getClientId();
  const urlValid = normalizeFeedUrl(urlInput) !== null;
  const showUrlError = urlTouched && urlInput.trim() !== '' && !urlValid;
  const syncing = busy === 'sync' || status?.running;

  async function run(kind: 'connect' | 'sync', type: 'connect' | 'sync-now') {
    setBusy(kind);
    setError(undefined);
    try {
      const res = await send({ type });
      if (!res.ok) setError(res.error);
    } finally {
      setBusy(null);
    }
  }

  async function addFeed(raw: string) {
    const url = normalizeFeedUrl(raw);
    if (!url) {
      setUrlTouched(true);
      return;
    }
    if (feeds.some((f) => f.url === url)) {
      setError('That feed is already added.');
      return;
    }
    // Must be the first await so the click still counts as a user gesture.
    const granted = await browser.permissions.request({ origins: [feedOrigin(url)] });
    if (!granted) {
      setError(`Site access to ${hostOf(url)} is needed to download the feed.`);
      return;
    }
    const kind = detectFeedKind(url);
    const feed: Feed = { id: crypto.randomUUID(), kind, label: `${KIND_LABEL[kind]} · ${hostOf(url)}`, url, enabled: true };
    // Re-read storage so a change made meanwhile isn't overwritten.
    const current = await feedsItem.getValue();
    if (!current.some((f) => f.url === url)) await feedsItem.setValue([...current, feed]);
    setUrlInput('');
    setUrlTouched(false);
    setDetected(null);
    setError(undefined);
    void run('sync', 'sync-now');
  }

  async function removeFeed(feed: Feed) {
    const rest = (await feedsItem.getValue()).filter((f) => f.id !== feed.id);
    await feedsItem.setValue(rest);
    if (feed.mode === 'api') {
      // Delete the stored assignment snapshot for this school.
      const cache = { ...(await canvasCacheItem.getValue()) };
      delete cache[new URL(feed.url).origin];
      await canvasCacheItem.setValue(cache);
    }
    const origin = feedOrigin(feed.url);
    if (!rest.some((f) => feedOrigin(f.url) === origin)) {
      // Fails for required hosts (e.g. *.instructure.com); that's fine.
      await browser.permissions.remove({ origins: [origin] }).catch(() => false);
    }
    void run('sync', 'sync-now');
  }

  async function toggleFeed(feed: Feed, enabled: boolean) {
    const current = await feedsItem.getValue();
    await feedsItem.setValue(current.map((f) => (f.id === feed.id ? { ...f, enabled } : f)));
    void run('sync', 'sync-now');
  }

  async function detectOnTab() {
    setBusy('detect');
    setError(undefined);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab.');
      // allFrames: D2L may render its Subscribe dialog inside an iframe.
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: findFeedUrlsInPage,
      });
      const found = new Set(results.flatMap((r) => (r.result as string[] | undefined) ?? []));
      const urls = [...found]
        .map((u) => normalizeFeedUrl(u))
        .filter((u): u is string => !!u && !feeds.some((f) => f.url === u));
      setDetected(urls);
    } catch {
      setError('Could not read this tab. Open your Canvas or D2L calendar page first.');
    } finally {
      setBusy(null);
    }
  }

  if (!clientId) {
    return (
      <main className="flex w-[360px] flex-col gap-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle>Setup needed</CardTitle>
          </CardHeader>
          <CardDescription>
            Add <code>WXT_GOOGLE_CLIENT_ID</code> to <code>.env.local</code> and rebuild. Use this as the OAuth
            redirect URI:
          </CardDescription>
          <code className="break-all rounded-md bg-muted p-2 text-xs">{getRedirectUrl()}</code>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex w-[360px] flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/icon/32.png" alt="" className="size-6 rounded-md" />
          <h1 className="text-base font-semibold">Nomad</h1>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={() => void browser.runtime.openOptionsPage()}>
          <Settings />
        </Button>
      </header>

      {(error || status?.lastError) && (
        <div role="alert" className="flex gap-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
          <AlertCircle className="mt-px size-4 shrink-0" aria-hidden />
          <span>{error ?? status?.lastError}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1">
            <CardTitle>Google Calendar</CardTitle>
            <CardDescription>
              {account
                ? `Connected${account.email ? ` as ${account.email}` : ''}${calendar ? ` · “${calendar.name}”` : ''}`
                : 'Events go into a separate calendar. Your other calendars are never touched.'}
            </CardDescription>
          </div>
        </CardHeader>
        {!account || status?.needsAuth ? (
          <Button disabled={busy === 'connect'} onClick={() => void run('connect', 'connect')}>
            {busy === 'connect' ? <Loader2 className="animate-spin" /> : <Link2 />}
            {account ? 'Reconnect Google' : 'Connect Google Calendar'}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void send({ type: 'disconnect' })}>
            Disconnect
          </Button>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1">
            <CardTitle>Feeds</CardTitle>
            <CardDescription>Connect Canvas from a Canvas tab, or add a calendar feed link from Canvas, D2L, Blackboard, Moodle, Schoology or Sakai.</CardDescription>
          </div>
        </CardHeader>

        {canvasTab && !canvasAlreadyConnected && (
          <Button onClick={() => void connectCanvas()}>
            <Link2 />
            Connect Canvas on this tab
          </Button>
        )}
        {canvasTab && !canvasAlreadyConnected && (
          <p className="-mt-2 text-xs text-muted-foreground">
            Logged in as {canvasTab.user} on {hostOf(canvasTab.origin)}. Reads your assignments with your Canvas login, like
            Better Canvas.
          </p>
        )}

        {feeds.length === 0 && <p className="text-xs text-muted-foreground">No feeds yet.</p>}
        {feeds.length > 0 && (
          <ul className="flex flex-col gap-2">
            {feeds.map((feed) => {
              const feedError = status?.feedErrors?.[feed.id];
              return (
                <li key={feed.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`feed-${feed.id}`}
                      checked={feed.enabled}
                      onCheckedChange={(v) => void toggleFeed(feed, v)}
                      aria-label={`Sync ${feed.label}`}
                    />
                    <Label htmlFor={`feed-${feed.id}`} className="min-w-0 flex-1 truncate font-normal" title={feed.label}>
                      {feed.label}
                    </Label>
                    {feedError && <Badge variant="destructive">Error</Badge>}
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${feed.label}`} onClick={() => void removeFeed(feed)}>
                      <Trash2 />
                    </Button>
                  </div>
                  {feedError && <p className="pl-12 text-xs text-destructive">{feedError}</p>}
                </li>
              );
            })}
          </ul>
        )}

        <Button variant="secondary" size="sm" disabled={busy === 'detect'} onClick={() => void detectOnTab()}>
          {busy === 'detect' ? <Loader2 className="animate-spin" /> : <ScanSearch />}
          Find feed on this tab
        </Button>
        {detected && detected.length === 0 && (
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <p>No feed link found. Open the page that shows it, then try again:</p>
            <ul className="list-disc pl-4">
              <li>Canvas: Calendar → Calendar Feed</li>
              <li>D2L: Calendar → Subscribe</li>
              <li>Blackboard: Calendar → Get external calendar link</li>
              <li>Moodle: Calendar → Import or export → Export → Get calendar URL</li>
              <li>Schoology: Calendar → Export</li>
              <li>Sakai: Calendar → Subscribe</li>
            </ul>
          </div>
        )}
        {detected?.map((url) => (
          <Button key={url} variant="outline" size="sm" className="justify-start" onClick={() => void addFeed(url)}>
            Add {KIND_LABEL[detectFeedKind(url)]} feed from {hostOf(url)}
          </Button>
        ))}

        <form
          className="flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void addFeed(urlInput);
          }}
        >
          <Label htmlFor="feed-url" className="sr-only">
            Feed URL
          </Label>
          <div className="flex gap-2">
            <Input
              id="feed-url"
              placeholder="Or paste a feed URL"
              value={urlInput}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={showUrlError || undefined}
              aria-describedby={showUrlError ? 'feed-url-error' : undefined}
              onChange={(e) => setUrlInput(e.target.value)}
              onBlur={() => setUrlTouched(true)}
            />
            <Button type="submit" variant="outline" disabled={!urlInput.trim()}>
              Add
            </Button>
          </div>
          {showUrlError && (
            <p id="feed-url-error" className="text-xs text-destructive">
              Enter an https:// or webcal:// feed link.
            </p>
          )}
        </form>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle>Sync</CardTitle>
            <CardDescription aria-live="polite">
              {syncing
                ? 'Syncing…'
                : status?.lastSuccessAt
                  ? `Last synced ${formatDistanceToNow(status.lastSuccessAt, { addSuffix: true })}`
                  : 'Not synced yet'}
              {!syncing && status?.stats ? ` · ${status.stats.total} events` : ''}
            </CardDescription>
          </div>
          <Button size="sm" disabled={!!syncing || !account} onClick={() => void run('sync', 'sync-now')}>
            <RefreshCw className={syncing ? 'animate-spin motion-reduce:animate-none' : undefined} />
            Sync now
          </Button>
        </div>
        {status?.stats && !syncing && (
          <p className="text-xs text-muted-foreground">
            Last run: {status.stats.inserted} added, {status.stats.updated} updated, {status.stats.deleted} removed
          </p>
        )}
      </Card>
    </main>
  );
}
