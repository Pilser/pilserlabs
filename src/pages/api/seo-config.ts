import type { APIContext } from 'astro';
import { useEnv } from '../../lib/env';
import { json, methodNotAllowed } from '../../lib/http';
import { getSeoConfig, setSeoConfig, clearSeoConfig, seoConfigMasked } from '../../lib/seo-config';
import type { SeoConfig } from '../../lib/seo-config';
import { isAdminRequest } from '../../lib/admin';

export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {
  const env = useEnv();
  if (!(await isAdminRequest(context.request))) return json({ ok: false, error: 'Unauthorized' }, 401);
  const cfg = await getSeoConfig(env);
  return json({ ok: true, config: seoConfigMasked(cfg) });
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
  const patch: Partial<SeoConfig> = {};
  for (const k of ['gaMeasurementId', 'gscVerification', 'indexnowKey'] as const) {
    if (typeof body[k] === 'string') patch[k] = body[k];
  }
  const cfg = await setSeoConfig(env, patch);
  return json({ ok: true, config: seoConfigMasked(cfg) });
}

export async function DELETE(context: APIContext): Promise<Response> {
  const env = useEnv();
  if (!(await isAdminRequest(context.request))) return json({ ok: false, error: 'Unauthorized' }, 401);
  await clearSeoConfig(env);
  return json({ ok: true, config: seoConfigMasked(await getSeoConfig(env)) });
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