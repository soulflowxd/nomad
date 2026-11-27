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
