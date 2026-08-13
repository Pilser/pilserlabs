import type { APIContext } from 'astro';
import { useEnv } from '../../lib/env';
import { json, methodNotAllowed } from '../../lib/http';
import { ensureEmailLogTable, listEmailLog } from '../../lib/db';
import { isAdminRequest } from '../../lib/admin';

export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {
  const env = useEnv();
  if (!(await isAdminRequest(context.request))) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }
  const url = new URL(context.request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 60), 200) || 60;
  await ensureEmailLogTable(env);
  const rows = await listEmailLog(env, limit);
  return json({ ok: true, activity: rows });
}

export async function onRequest(context: APIContext): Promise<Response> {
  switch (context.request.method) {
    case 'GET':
      return GET(context);
    default:
      return methodNotAllowed('GET');
  }
}