import { browser } from 'wxt/browser';

export type Message = { type: 'sync-now' } | { type: 'connect' } | { type: 'disconnect' };
export type MessageResponse = { ok: true } | { ok: false; error: string };

export async function send(message: Message): Promise<MessageResponse> {
  try {
    const res = (await browser.runtime.sendMessage(message)) as MessageResponse | undefined;
    return res ?? { ok: false, error: 'The background worker did not respond. Try again.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
