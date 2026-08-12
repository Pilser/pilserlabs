import type { APIContext } from 'astro';
import { useEnv } from '../../../lib/env';
import { json, methodNotAllowed } from '../../../lib/http';
import { checkRate, clientIp } from '../../../lib/rate';
import { prepareSql } from '../../../lib/db';

export const prerender = false;

export async function POST(context: APIContext): Promise<Response> {
  const env = useEnv();
  const request = context.request;
  const ip = clientIp(request);
  const rate = await checkRate(env, ip, 'db', 30, 600);
  if (!rate.ok) return json({ ok: false, error: 'Rate limited' }, 429);

  let body: { sql?: unknown; params?: unknown };
  try {
    const raw = await request.text();
    body = raw ? (JSON.parse(raw) as typeof body) : {};
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  const rawSql = typeof body.sql === 'string' ? body.sql.trim() : '';
  const prepared = prepareSql(rawSql);
  if (prepared.error) return json({ ok: false, error: prepared.error }, 400);
  const sql = prepared.sql;

  const params = Array.isArray(body.params) ? body.params.map((p) => (p === undefined ? null : p)) : [];

  try {
    const stmt = env.DB.prepare(sql);
    const upper = sql.toUpperCase();
    if (upper.startsWith('SELECT')) {
      const res = await stmt.bind(...params).all();
      return json({ ok: true, results: res.results });
    }
    const res = await stmt.bind(...params).run();
    return json({ ok: true, meta: res.meta });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'SQL error' }, 400);
  }
}

export async function onRequest(context: APIContext): Promise<Response> {
  switch (context.request.method) {
    case 'POST':
      return POST(context);
    default:
      return methodNotAllowed('POST');
  }
}