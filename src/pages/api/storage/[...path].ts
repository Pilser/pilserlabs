import type { APIContext } from 'astro';
import { useEnv } from '../../../lib/env';
import { json, methodNotAllowed, notFound } from '../../../lib/http';
import { checkRate, clientIp } from '../../../lib/rate';
import { cleanSegs, joinPathParam } from '../../../lib/paths';

export const prerender = false;

const MAX_OBJECT = 25 * 1024 * 1024;
const SAFE_HEADERS = { 'x-content-type-options': 'nosniff' };

export async function GET(context: APIContext): Promise<Response> {
  const env = useEnv();
  let path: string;
  try {
    path = cleanSegs(joinPathParam(context.params.path));
  } catch {
    return notFound();
  }
  if (!path) return notFound();

  const key = `storage/${path}`;
  const obj = await env.DISTS.get(key);
  if (obj) {
    const bytes = await obj.arrayBuffer();
    return new Response(bytes, {
      headers: {
        'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': 'public, max-age=3600',
        ...SAFE_HEADERS,
      },
    });
  }

  const prefix = `${key}/`;
  const listed = await env.DISTS.list({ prefix, limit: 500 });
  if (listed.objects.length === 0) return notFound();
  return json({
    ok: true,
    emptyList: true,
    objects: listed.objects.map((o: { key: string; size: number }) => ({ key: o.key, size: o.size })),
  });
}

export async function PUT(context: APIContext): Promise<Response> {
  const env = useEnv();
  const request = context.request;
  const ip = clientIp(request);
  const rate = await checkRate(env, ip, `storage:${context.params.path?.[0] ?? 'anon'}`, 60, 3600);
  if (!rate.ok) return json({ ok: false, error: 'Rate limited' }, 429);

  let path: string;
  try {
    path = cleanSegs(joinPathParam(context.params.path));
  } catch {
    return json({ ok: false, error: 'bad path' }, 400);
  }
  if (!path) return json({ ok: false, error: 'bad path' }, 400);
  const size = Number(request.headers.get('content-length') ?? 0);
  if (size > MAX_OBJECT) return json({ ok: false, error: 'object too large' }, 413);

  const key = `storage/${path}`;
  const contentType = request.headers.get('x-content-type') ?? 'application/octet-stream';
  const bytes = await request.arrayBuffer();
  await env.DISTS.put(key, bytes, { httpMetadata: { contentType } });
  return json({ ok: true, key }, 201);
}

export async function DELETE(context: APIContext): Promise<Response> {
  const env = useEnv();
  let path: string;
  try {
    path = cleanSegs(joinPathParam(context.params.path));
  } catch {
    return json({ ok: false, error: 'bad path' }, 400);
  }
  if (!path) return json({ ok: false, error: 'bad path' }, 400);
  await env.DISTS.delete(`storage/${path}`);
  return json({ ok: true });
}

export async function onRequest(context: APIContext): Promise<Response> {
  switch (context.request.method) {
    case 'GET':
      return GET(context);
    case 'PUT':
      return PUT(context);
    case 'DELETE':
      return DELETE(context);
    default:
      return methodNotAllowed('GET, PUT, DELETE');
  }
}