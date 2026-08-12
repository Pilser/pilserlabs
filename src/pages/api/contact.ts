import type { APIContext } from 'astro';
import { useEnv } from '../../lib/env';
import { readJason, json, methodNotAllowed, str } from '../../lib/http';
import { checkRate, clientIp } from '../../lib/rate';
import { ensureContactTable, insertContact, listContacts } from '../../lib/db';
import { isAdminRequest } from '../../lib/admin';

export const prerender = false;

export async function POST(context: APIContext): Promise<Response> {
  const env = useEnv();
  const request = context.request;

  const ip = clientIp(request);
  const rate = await checkRate(env, ip, 'contact', 5, 600);
  if (!rate.ok) {
    return json({ ok: false, error: 'Too many submissions. Try later.' }, 429, {
      'retry-after': String(rate.retryAfter),
    });
  }

  const body = await readJason(request.body);
  if (!body) return json({ ok: false, error: 'Invalid JSON' }, 400);

  const name = str(body.name).trim().slice(0, 120);
  const email = str(body.email).trim().slice(0, 240);
  const message = str(body.message).trim().slice(0, 5000);
  const plugin = str(body.plugin).slice(0, 60);
  const consent = body.consent === true;

  if (!name || !email || !message) {
    return json({ ok: false, error: 'name, email and message are required' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'invalid email address' }, 400);
  }

  await ensureContactTable(env);
  await insertContact(env, { plugin, name, email, message }, consent ? ip : 'consent-declined');

  return json({ ok: true, received: Date.now() });
}

export async function GET(context: APIContext): Promise<Response> {
  const env = useEnv();
  if (!(await isAdminRequest(context.request))) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }
  const url = new URL(context.request.url);
  const plugin = url.searchParams.get('plugin') ?? undefined;
  await ensureContactTable(env);
  const rows = await listContacts(env, plugin);
  return json({ ok: true, contacts: rows });
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