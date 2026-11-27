/**
 * Injected into the active tab when the popup opens. Returns the Canvas user's name if this is
 * a Canvas page with a logged-in session, otherwise null. Must stay self-contained.
 * Only asks the site's own API, and only when the page looks like Canvas.
 */
export async function checkCanvasSession(): Promise<{ name: string; id: string } | null> {
  const looksLikeCanvas =
    location.hostname.endsWith('.instructure.com') || !!document.querySelector('#application.ic-app, .ic-app');
  if (!looksLikeCanvas) return null;
  try {
    const res = await fetch('/api/v1/users/self', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const user = JSON.parse((await res.text()).replace(/^while\(1\);/, '')) as { name?: unknown; id?: unknown };
    if (typeof user.id !== 'string' && typeof user.id !== 'number') return null;
    const name = typeof user.name === 'string' && user.name ? user.name.slice(0, 100) : 'Canvas user';
    return { name, id: String(user.id) };
  } catch {
    return null;
  }
}

/**
 * Injected into the active Canvas/D2L tab (via activeTab + scripting) when the user clicks
 * "Find feed on this tab". Must stay self-contained: it is serialized and run in the page.
 * Returns feed URLs only; nothing else leaves the page.
 */
export function findFeedUrlsInPage(): string[] {
  const html = document.documentElement.innerHTML.replace(/\\\//g, '/').replace(/&amp;/g, '&');
  const values = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')).map(
    (el) => el.value,
  );
  const haystack = [html, ...values].join('\n');
  const patterns = [
    /(?:https|webcal):\/\/[^\s"'<>\\]+\/feeds\/calendars\/user_[A-Za-z0-9]+\.ics/g,
    /(?:https|webcal):\/\/[^\s"'<>\\]+\/d2l\/le\/calendar\/feed\/user\/feed\.ics\?[^\s"'<>\\]*token=[A-Za-z0-9]+[^\s"'<>\\]*/g,
  ];
  const found = new Set<string>();
  for (const re of patterns) for (const m of haystack.matchAll(re)) found.add(m[0]);
  return [...found];
}
