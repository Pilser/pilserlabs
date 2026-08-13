import type { APIContext } from 'astro';
import { useEnv } from '../../lib/env';
import { readJason, json, methodNotAllowed, str } from '../../lib/http';
import { checkRate, clientIp } from '../../lib/rate';
import { ensureContactTable, ensureEmailLogTable, insertContact, insertEmailLog, listContacts } from '../../lib/db';
import { isAdminRequest } from '../../lib/admin';
import { sendViaMailConfig } from '../../lib/mailer';

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

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
  await ensureEmailLogTable(env);
  await insertContact(env, { plugin, name, email, message }, consent ? ip : 'consent-declined');

  const to = env.EMAIL_TO ?? 'info@pilserlabs.com';
  let emailStatus = 'saved';
  let emailDetail = '';
  if (consent) {
    const subject = `New inquiry from ${name}${plugin && plugin !== 'main' ? ` (${plugin})` : ''}`;
    const text = `From: ${name} <${email}>\nModule: ${plugin || 'main'}\n\n${message}\n\n— sent via pilserlabs.com`;
    const html = [
      '<div style="font-family:ui-monospace,monospace;color:#dff4ff;background:#05070b;padding:24px">',
      '<p style="color:#3ee0ff;letter-spacing:.2em;text-transform:uppercase;font-size:12px">PilsérLabs — new inquiry</p>',
      `<p><b>Name:</b> ${escapeHtml(name)}<br><b>Email:</b> ${escapeHtml(email)}<br><b>Module:</b> ${escapeHtml(plugin || 'main')}</p>`,
      `<p style="border-left:3px solid #3ee0ff;padding-left:12px">${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
      '<p style="color:#5a6b80;font-size:11px">sent via pilserlabs.com</p>',
      '</div>',
    ].join('');

    const viaConfig = await sendViaMailConfig(env, {
      to,
      from: 'info@pilserlabs.com',
      subject,
      text,
      html,
    });

    if (viaConfig.status !== 'email-failed' || viaConfig.detail === 'no external mail server configured') {
      emailStatus = viaConfig.status;
      emailDetail = viaConfig.detail ?? '';
    } else if (env.EMAIL) {
      try {
        await env.EMAIL.send({
          to,
          from: { email: 'info@pilserlabs.com', name: 'PilsérLabs' },
          replyTo: email,
          subject,
          text,
          html,
        });
        emailStatus = 'email-sent';
        emailDetail = 'workers binding';
      } catch (err) {
        emailStatus = 'email-failed';
        emailDetail = err instanceof Error ? err.message : String(err);
      }
    }
  }
  await insertEmailLog(env, {
    direction: 'out',
    fromAddr: 'info@pilserlabs.com',
    toAddr: to,
    subject: `New inquiry from ${name}${plugin && plugin !== 'main' ? ` (${plugin})` : ''}`,
    body: message,
    status: emailStatus,
    meta: JSON.stringify({ name, email, plugin, detail: emailDetail }),
  });

  return json({ ok: true, received: Date.now(), email: emailStatus, inbox: to });
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