/*
 * Runs on Canvas sites the user connected (registered at runtime, per origin).
 * Like Better Canvas (AGPL-3.0, https://github.com/UseBetterCanvas/bettercanvas), it reads
 * /api/v1/planner/items from inside the page so the user's normal Canvas login is used.
 * Only sanitized assignment fields are sent to the extension's background worker.
 * It never reads extension storage itself (that holds other secrets, like feed links).
 */
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { fetchCanvasUserId, fetchPlannerItems, sanitizePlannerItems } from '@/lib/feeds/canvas-api';

export default defineContentScript({
  // Placeholder: the real per-school origins are registered at runtime by the background.
  matches: ['https://canvas.invalid/*'],
  registration: 'runtime',
  runAt: 'document_idle',
  async main() {
    if (window.top !== window) return;
    try {
      const due = (await browser.runtime.sendMessage({ type: 'canvas-due' })) as boolean | undefined;
      if (!due) return;
      const init: RequestInit = { credentials: 'same-origin' };
      const userId = await fetchCanvasUserId(location.origin, init);
      const items = sanitizePlannerItems(await fetchPlannerItems(location.origin, Date.now(), init));
      await browser.runtime.sendMessage({ type: 'canvas-items', userId, items });
    } catch {
      // Not logged in, or not a Canvas page. Nothing to do.
    }
  },
});
