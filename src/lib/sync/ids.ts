import type { NormalizedEvent, PreparedEvent } from '../types';

// Google event IDs may only use base32hex characters (a-v, 0-9), 5-1024 long.
const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';

export function base32hex(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32HEX[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32HEX[(buffer << (5 - bits)) & 31];
  return out;
}

async function sha256(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

/** Same source item → same Google event ID, so inserts are idempotent. */
export async function eventIdFor(sourceKey: string): Promise<string> {
  return base32hex(await sha256(`school-sync\n${sourceKey}`));
}

export async function contentHash(ev: NormalizedEvent): Promise<string> {
  const fields = [ev.title, ev.description, ev.location ?? '', ev.url ?? '', JSON.stringify(ev.start), JSON.stringify(ev.end)];
  return base32hex(await sha256(JSON.stringify(fields))).slice(0, 26);
}

export async function prepareEvents(events: NormalizedEvent[]): Promise<PreparedEvent[]> {
  return Promise.all(
    events.map(async (event) => ({ id: await eventIdFor(event.sourceKey), hash: await contentHash(event), event })),
  );
}
