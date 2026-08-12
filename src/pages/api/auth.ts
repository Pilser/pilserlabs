import type { APIContext } from 'astro';
import { useEnv } from '../../lib/env';
import { readJason, json, methodNotAllowed, str } from '../../lib/http';
import { checkRate, clientIp } from '../../lib/rate';
import { isAdminRequest, issueLoginCookie, logoutCookie } from '../../lib/admin';
import { adminSecret } from '../../lib/auth';

export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {
  const admin = await isAdminRequest(context.request);
  return json({ ok: true, admin });
}

export async function POST(context: APIContext): Promise<Response> {
  const env = useEnv();
  const request = context.request;
  const rate = await checkRate(env, clientIp(request), 'auth', 10, 300);
  if (!rate.ok) return json({ ok: false, error: 'Too many attempts' }, 429);

  const body = await readJason(request.body);
  if (!body) return json({ ok: false, error: 'Invalid JSON' }, 400);

  const action = str(body.action);
  if (action === 'logout') {
    return json({ ok: true }, 200, { 'set-cookie': logoutCookie() });
  }

  const entered = str(body.password);
  const secret = adminSecret();
  if (!secret || entered !== secret) {
    return json({ ok: false, error: 'Wrong access code' }, 401);
  }

  const cookie = await issueLoginCookie();
  return json({ ok: true, admin: true }, 200, {
    'set-cookie': `${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 14}`,
  });
}

export async function onRequest(context: APIContext): Promise<Response> {
  switch (context.request.method) {
    case 'GET':
      return GET(context);
    case 'POST':
      return POST(context);
    default:
      return methodNotAllowed('GET, POST');
  }
}