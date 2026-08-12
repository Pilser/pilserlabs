export const ADMIN_COOKIE = 'pli_session';

export interface AuthUser {
  id: string;
  role: 'admin';
  iat: number;
  exp: number;
}

function hmac(data: string, secret: string): Promise<string> {
  return crypto.subtle
    .importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    .then((key) => crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))
    .then((buf) => {
      const bytes = new Uint8Array(buf);
      let out = '';
      for (const b of bytes) out += b.toString(16).padStart(2, '0');
      return out;
    });
}

export async function signSession(user: AuthUser, secret: string): Promise<string> {
  const payload = btoa(JSON.stringify(user));
  const sig = await hmac(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifySession(token: string, secret: string): Promise<AuthUser | null> {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(payload, secret);
  if (expected !== sig) return null;
  let user: AuthUser;
  try {
    user = JSON.parse(atob(payload)) as AuthUser;
  } catch {
    return null;
  }
  if (!user || user.role !== 'admin') return null;
  if (typeof user.exp === 'number' && Date.now() > user.exp) return null;
  return user;
}

export function createSession(cookieAgeMs: number): Promise<string> {
  return signSession(
    {
      id: 'admin',
      role: 'admin',
      iat: Date.now(),
      exp: Date.now() + cookieAgeMs,
    },
    adminSecret(),
  );
}

export function adminSecret(): string {
  const secret = process.env.ADMIN_PASSWORD ?? (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.ADMIN_PASSWORD;
  return secret ?? '';
}

export async function isAdminToken(value: string): Promise<boolean> {
  const secret = adminSecret();
  if (!secret) return false;
  return value === secret || (await verifySession(value, secret)) !== null;
}