import { formatDistanceToNow } from 'date-fns';
import { AlertCircle, CalendarCheck, Link2, Loader2, RefreshCw, ScanSearch, Settings, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { browser } from 'wxt/browser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { findFeedUrlsInPage } from '@/lib/feeds/detect';
import { detectFeedKind, feedOrigin, normalizeFeedUrl } from '@/lib/feeds/parse';
import { getClientId, getRedirectUrl } from '@/lib/google/auth';
import { send } from '@/lib/messages';
import { accountItem, calendarItem, feedsItem, statusItem } from '@/lib/storage';
import type { Feed } from '@/lib/types';
import { useNow, useStorageValue } from '@/lib/use-storage';

const KIND_LABEL: Record<Feed['kind'], string> = { canvas: 'Canvas', d2l: 'D2L', ics: 'iCal' };

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
    const origin = feedOrigin(feed.url);
    if (!rest.some((f) => feedOrigin(f.url) === origin)) await browser.permissions.remove({ origins: [origin] });
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
          <CalendarCheck className="size-5 text-primary" aria-hidden />
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
            <CardDescription>Your Canvas “Calendar Feed” or D2L “Subscribe” link.</CardDescription>
          </div>
        </CardHeader>

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
          <p className="text-xs text-muted-foreground">
            No feed found. On Canvas open Calendar → Calendar Feed. On D2L open Calendar → Subscribe, then try again.
          </p>
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
