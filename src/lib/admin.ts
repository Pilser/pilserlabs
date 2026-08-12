import { adminSecret, createSession, isAdminToken, verifySession } from './auth';

export const ADMIN_COOKIE = 'pli_session';

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export async function isAdminRequest(request: Request): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return isAdminToken(authHeader.slice(7).trim());
  }
  const cookie = readCookie(request.headers.get('cookie'), ADMIN_COOKIE);
  if (!cookie) return false;
  const secret = adminSecret();
  if (!secret) return false;
  return (await verifySession(cookie, secret)) !== null;
}

export async function issueLoginCookie(): Promise<string> {
  return createSession(60 * 60 * 24 * 14);
}

export function logoutCookie(): string {
  return `${ADMIN_COOKIE}=; path=/; max-age=0; SameSite=Strict`;
}