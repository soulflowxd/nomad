import { browser } from 'wxt/browser';
import { accountItem, tokenItem } from '../storage';

// Only lets the app create its own secondary calendars and manage events on them.
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const SCOPES = [CALENDAR_SCOPE, 'email'];
const EXPIRY_MARGIN_MS = 60_000;

export class AuthRequiredError extends Error {
  constructor(message = 'Connect Google Calendar to sync.') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export function getClientId(): string | undefined {
  const id = import.meta.env.WXT_GOOGLE_CLIENT_ID as string | undefined;
  return id && !id.startsWith('your-client-id') ? id : undefined;
}

export function getRedirectUrl(): string {
  return browser.identity.getRedirectURL();
}

async function runAuthFlow(interactive: boolean, loginHint?: string) {
  const clientId = getClientId();
  if (!clientId) throw new Error('Missing WXT_GOOGLE_CLIENT_ID. See README setup.');

  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    redirect_uri: getRedirectUrl(),
    scope: SCOPES.join(' '),
    state,
    include_granted_scopes: 'true',
  });
  if (!interactive) params.set('prompt', 'none');
  if (loginHint) params.set('login_hint', loginHint);

  let redirect: string | undefined;
  try {
    redirect = await browser.identity.launchWebAuthFlow({
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      interactive,
      ...(interactive ? {} : { abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: 10_000 }),
    } as Parameters<typeof browser.identity.launchWebAuthFlow>[0]);
  } catch (e) {
    if (!interactive) throw new AuthRequiredError();
    throw e;
  }
  if (!redirect) throw new AuthRequiredError();

  const result = new URLSearchParams(new URL(redirect).hash.slice(1));
  if (result.get('state') !== state) throw new Error('Google sign-in returned an unexpected state.');
  if (result.get('error')) throw new AuthRequiredError(`Google sign-in failed: ${result.get('error')}`);
  const accessToken = result.get('access_token');
  if (!accessToken) throw new AuthRequiredError();
  if (!(result.get('scope') ?? '').split(' ').includes(CALENDAR_SCOPE)) {
    throw new AuthRequiredError('Calendar access was not granted. Connect again and allow calendar access.');
  }
  const expiresIn = Number(result.get('expires_in') ?? '3600');
  const token = { accessToken, expiresAt: Date.now() + expiresIn * 1000 };
  await tokenItem.setValue(token);
  return token;
}

/** Returns a valid token, refreshing silently when possible. Never shows UI unless interactive. */
export async function getAccessToken({ interactive = false } = {}): Promise<string> {
  const cached = await tokenItem.getValue();
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return cached.accessToken;
  const account = await accountItem.getValue();
  if (!account && !interactive) throw new AuthRequiredError();
  return (await runAuthFlow(interactive, account?.email)).accessToken;
}

export async function invalidateToken(): Promise<void> {
  await tokenItem.setValue(null);
}

export async function connectGoogle(): Promise<{ email?: string }> {
  const { accessToken } = await runAuthFlow(true);
  let email: string | undefined;
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) email = ((await res.json()) as { email?: string }).email;
  } catch {
    // Email is only used as a sign-in hint; continue without it.
  }
  const account = { email };
  await accountItem.setValue(account);
  return account;
}

export async function disconnectGoogle(): Promise<void> {
  const token = await tokenItem.getValue();
  if (token) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: token.accessToken }),
      });
    } catch {
      // Best effort; local state is cleared regardless.
    }
  }
  await tokenItem.setValue(null);
  await accountItem.setValue(null);
}
