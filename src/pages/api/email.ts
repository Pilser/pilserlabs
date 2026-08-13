import type { APIContext } from 'astro';
import { useEnv } from '../../lib/env';
import { json, methodNotAllowed } from '../../lib/http';
import { checkRate, clientIp } from '../../lib/rate';
import { ensureEmailLogTable, insertEmailLog } from '../../lib/db';
import { sendViaMailConfig } from '../../lib/mailer';

export const prerender = false;

export async function POST(context: APIContext): Promise<Response> {
  const env = useEnv();
  const request = context.request;

  const ip = clientIp(request);
  const rate = await checkRate(env, ip, 'email', 10, 600);
  if (!rate.ok) return json({ ok: false, error: 'Rate limited' }, 429);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const to = String(body.to ?? '').trim();
  const subject = String(body.subject ?? '').trim().slice(0, 200);
  const text = String(body.text ?? '').trim().slice(0, 20000);
  const html = String(body.html ?? '').trim().slice(0, 40000);
  const plugin = (request.headers.get('x-plugin') || String(body.plugin ?? '')).trim().slice(0, 60) || 'main';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return json({ ok: false, error: 'invalid to address' }, 400);
  }
  if (!subject || !text) {
    return json({ ok: false, error: 'subject and text are required' }, 400);
  }

  await ensureEmailLogTable(env);
  const res = await sendViaMailConfig(env, {
    to,
    from: 'info@pilserlabs.com',
    subject,
    text,
    html,
  });

  await insertEmailLog(env, {
    direction: 'out',
    fromAddr: 'info@pilserlabs.com',
    toAddr: to,
    subject,
    body: text,
    status: res.status,
    meta: JSON.stringify({ plugin, detail: res.detail, via: 'api/email' }),
  });

  return json({ ok: true, email: res.status, detail: res.detail });
}

export async function onRequest(context: APIContext): Promise<Response> {
  switch (context.request.method) {
    case 'POST':
      return POST(context);
    default:
      return methodNotAllowed('POST');
  }
}