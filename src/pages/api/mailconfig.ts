import type { APIContext } from 'astro';
import { useEnv } from '../../lib/env';
import { json, methodNotAllowed } from '../../lib/http';
import { getMailConfig, setMailConfig, clearMailConfig } from '../../lib/mailer';
import type { MailConfig } from '../../lib/mailer';
import { isAdminRequest } from '../../lib/admin';

export const prerender = false;

const SECRET_FIELDS = ['apiKey', 'smtpPass'];

export async function GET(context: APIContext): Promise<Response> {
  const env = useEnv();
  if (!(await isAdminRequest(context.request))) return json({ ok: false, error: 'Unauthorized' }, 401);
  const cfg = await getMailConfig(env);
  if (!cfg) return json({ ok: true, configured: false });
  const masked = { ...cfg } as Record<string, unknown>;
  for (const f of SECRET_FIELDS) {
    if (masked[f]) masked[f] = '••••••••';
  }
  return json({ ok: true, configured: true, config: masked });
}

export async function POST(context: APIContext): Promise<Response> {
  const env = useEnv();
  if (!(await isAdminRequest(context.request))) return json({ ok: false, error: 'Unauthorized' }, 401);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await context.request.text());
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const existing = await getMailConfig(env);
  const provider = String(body.provider ?? 'none');

  const next: MailConfig = {
    provider: provider === 'smtp' ? 'smtp' : provider === 'api' ? 'api' : 'none',
  };

  const fill = (k: keyof MailConfig, raw?: unknown) => {
    const rec = next as unknown as Record<string, unknown>;
    if (typeof raw === 'string' && raw.trim()) rec[k] = raw.trim();
    else if (existing && existing[k]) rec[k] = existing[k];
  };

  if (next.provider === 'api') {
    fill('apiUrl', body.apiUrl);
    fill('apiKey', body.apiKey);
    fill('apiFrom', body.apiFrom);
    if (!next.apiUrl) return json({ ok: false, error: 'apiUrl is required for api provider' }, 400);
  }
  if (next.provider === 'smtp') {
    fill('smtpHost', body.smtpHost);
    fill('smtpPort', body.smtpPort);
    fill('smtpUser', body.smtpUser);
    fill('smtpPass', body.smtpPass);
    if (typeof body.smtpSecure === 'boolean') next.smtpSecure = body.smtpSecure;
    else if (existing?.smtpSecure !== undefined) next.smtpSecure = existing.smtpSecure;
    if (!next.smtpHost) return json({ ok: false, error: 'smtpHost is required for smtp provider' }, 400);
  }
  fill('fromEmail', body.fromEmail);
  fill('toEmail', body.toEmail);

  await setMailConfig(env, next);
  return json({ ok: true, configured: true });
}

export async function DELETE(context: APIContext): Promise<Response> {
  const env = useEnv();
  if (!(await isAdminRequest(context.request))) return json({ ok: false, error: 'Unauthorized' }, 401);
  await clearMailConfig(env);
  return json({ ok: true, configured: false });
}

export async function onRequest(context: APIContext): Promise<Response> {
  switch (context.request.method) {
    case 'GET':
      return GET(context);
    case 'POST':
      return POST(context);
    case 'DELETE':
      return DELETE(context);
    default:
      return methodNotAllowed('GET, POST, DELETE');
  }
}