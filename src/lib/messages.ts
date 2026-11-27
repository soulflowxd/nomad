import { browser } from 'wxt/browser';

/** Messages from the extension's own pages (popup, options). */
export type Message = { type: 'sync-now' } | { type: 'connect' } | { type: 'disconnect' };
/** Message from the Canvas content script. `items` is untrusted and re-sanitized. */
export type ContentMessage = { type: 'canvas-due' } | { type: 'canvas-items'; userId: unknown; items: unknown };
export type MessageResponse = { ok: true } | { ok: false; error: string };

export async function send(message: Message): Promise<MessageResponse> {
  try {
    const res = (await browser.runtime.sendMessage(message)) as MessageResponse | undefined;
    return res ?? { ok: false, error: 'The background worker did not respond. Try again.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
