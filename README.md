# Nomad

A Chrome/Edge extension (Manifest V3) that keeps your **Canvas** and **D2L Brightspace**
assignments and events in sync with **Google Calendar**, automatically.

- Reads your personal Canvas "Calendar Feed" and D2L "Subscribe" iCal links.
- Writes events into a separate Google calendar, "School (Canvas & D2L)", that the extension
  creates. It never reads or changes your other calendars.
- Syncs every 30 minutes (configurable), on browser start, and on "Sync now". New items are added,
  changed due dates are updated, and removed future items are deleted.
- No server. Everything runs in your browser.

Inspired by BetterCanvas (AGPL-3.0). No code was copied from it.

## Development

```powershell
bun install
bun run dev        # Chrome with hot reload
bun run dev:edge   # Edge
bun run test
bun run lint       # TypeScript type check
bun run build      # output in .output/chrome-mv3
```

## Google Cloud setup (one time)

1. Go to <https://console.cloud.google.com/>, create a project, and enable the **Google Calendar API**.
2. **OAuth consent screen**: choose External, keep publishing status **Testing**, and add the scopes
   `.../auth/calendar.app.created` and `email`. Under **Test users**, add your Google account and
   your friends' accounts (up to 100).
3. **Credentials → Create OAuth client ID → Web application**.
4. Build the extension and load it unpacked (`chrome://extensions` → Developer mode → Load unpacked →
   `.output/chrome-mv3`). Open the extension's Settings page and copy the **redirect URI**
   (`https://<extension-id>.chromiumapp.org/`). Add it under *Authorized redirect URIs*.
5. Copy `.env.example` to `.env.local`, set `WXT_GOOGLE_CLIENT_ID`, and rebuild.

The extension ID (and so the redirect URI) depends on the install path for unpacked builds.
To keep it stable across machines, add a `key` to the manifest in `wxt.config.ts`. Friends loading
the same unpacked build need the same ID, so share the built folder or set a `key`.

The client ID is not a secret (no client secret is used), but `.env.local` stays out of git anyway.

## Using it

1. Click the extension icon → **Connect Google Calendar**.
2. Open your Canvas calendar (Calendar → *Calendar Feed*) or D2L calendar (Calendar → *Subscribe*),
   then click **Find feed on this tab**. Or paste the feed link.
3. Approve site access for your school's domain. A sync runs right away.

## How it works

| Piece | File |
| --- | --- |
| iCal parsing (ical.js) | `src/lib/feeds/parse.ts` |
| Deterministic Google event IDs and change hashes | `src/lib/sync/ids.ts` |
| Insert/update/delete planning | `src/lib/sync/diff.ts` |
| Sync orchestration | `src/lib/sync/run.ts` |
| Google OAuth (`launchWebAuthFlow`, works on Edge) | `src/lib/google/auth.ts` |
| Calendar REST client with backoff | `src/lib/google/calendar.ts` |
| Alarms and messages | `src/entrypoints/background.ts` |
| Popup and settings UI | `src/entrypoints/popup`, `src/entrypoints/options` |

Safety rules in the sync engine:
- A feed that fails to download never causes deletions.
- Only future events are deleted. Past events stay in your calendar.
- Only the extension's own calendar is touched.

## Known limitations (v1)

- Recurring events (RRULE) in feeds are synced as their first occurrence only. Moved single
  occurrences (RECURRENCE-ID) sync as their own events. LMS feeds rarely use recurrence.
- If a feed suddenly comes back empty or much smaller, existing events are kept and the feed is
  flagged, to avoid mass deletion after an LMS glitch.
- Items are synced from 30 days ago to about 13 months ahead.
- Some schools disable D2L calendar subscriptions. Then there is no D2L feed to sync.
- Google refreshes the access token silently. If you're signed in to several Google accounts and
  silent refresh fails, the popup asks you to reconnect.

## Before publishing to the Chrome Web Store

- Submit the OAuth consent screen for verification. Google needs a homepage, a privacy policy URL,
  and a demo video of the scopes in use.
- Publish `PRIVACY.md` at a public URL and link it in the store listing.
- Add icons (`src/public/icon/16.png` … `128.png`) and a fixed manifest `key`.
- Link the source repository in the store listing. AGPL-3.0 requires offering source to users.

## License

Copyright (C) 2026 soulflowxd

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU Affero General Public License as published by the Free Software Foundation, either version 3
of the License, or (at your option) any later version. See [LICENSE](LICENSE).

## Canvas account mode (recommended for Canvas)

Open any Canvas page while logged in, click the Nomad icon, then **Connect Canvas on this tab**.
Nomad then reads `/api/v1/planner/items` using your normal Canvas login, the same way Better
Canvas does, so no feed link is needed. The background worker tries the API directly on each sync.
If it can't reach Canvas, it uses the latest snapshot that the Canvas content script took while a
Canvas tab was open (refreshed at most every 15 minutes, used for up to 14 days). Code:
`src/lib/feeds/canvas-api.ts`, `src/entrypoints/canvas.content.ts`.

## Credits

- Canvas API approach adapted from [Better Canvas](https://github.com/UseBetterCanvas/bettercanvas)
  (AGPL-3.0, © Better Canvas contributors). Modified: pagination, sync window, sanitizing,
  Google Calendar mapping.

UI primitives adapted from [shadcn/ui](https://ui.shadcn.com) (MIT), built on Radix UI.
Font: Inter (SIL OFL), bundled locally via Fontsource.
