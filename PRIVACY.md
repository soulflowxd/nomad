# Privacy Policy – Nomad (DRAFT)

_Draft written from the code. Not legal advice. Review before publishing._

Nomad has **no server**. The developer never receives your data.

## What the extension handles

| Data | Where it comes from | Where it is stored | Who receives it |
| --- | --- | --- | --- |
| Canvas / D2L calendar feed links (contain a private access token) | You paste them, or the extension reads them from the open Canvas/D2L tab when you click "Find feed on this tab" | Your browser (`chrome.storage.local`) | Only your school's Canvas/D2L server, when the feed is downloaded |
| Assignment and event details (titles, descriptions, dates, links, locations) | Your feeds | Not stored. Only a content hash and date per event are kept, to detect changes | **Google Calendar**, in a calendar the extension creates in your account |
| Google access token | Google sign-in | Browser session storage, cleared when the browser closes | Google |
| Your Google email address | Google, after sign-in | Your browser | Not shared. Used only as a sign-in hint |

## Third parties

- **Google** (Calendar API, OAuth): receives the events written to your calendar. See Google's privacy policy.
- **Your school's Canvas or D2L server**: receives the feed download requests.

No analytics, ads, tracking, or remote fonts.

## Permissions

- `identity`: Google sign-in.
- `storage`: saves settings and feed links locally.
- `alarms`: runs the periodic sync.
- `activeTab` + `scripting`: finds a feed link on the current tab, only when you click the button.
- Site access to your school's domain, requested when you add a feed: downloads the feed.
- Google scope `calendar.app.created`: lets the extension create its own calendar and manage events
  only in calendars it created. It cannot see your other calendars.

## Deleting your data

- **Disconnect** in the popup revokes the Google token.
- Removing the extension deletes all locally stored data.
- To remove synced events, delete the "School (Canvas & D2L)" calendar in Google Calendar.
- You can also revoke access at <https://myaccount.google.com/permissions>.

## Contact

TODO: add a contact email before publishing.
