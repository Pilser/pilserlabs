import type { APIContext } from 'astro';
import { useEnv } from '../../../lib/env';
import { json, methodNotAllowed, notFound } from '../../../lib/http';
import { checkRate, clientIp } from '../../../lib/rate';
import { cleanSegs, joinPathParam } from '../../../lib/paths';
import { validSlug } from '../../../lib/registry';

export const prerender = false;

function parts(path: unknown): string[] {
  const s = joinPathParam(path);
  return s.split('/').filter(Boolean);
}

export async function GET(context: APIContext): Promise<Response> {
  const env = useEnv();
  const segs = parts(context.params.path);
  const slug = segs[0] ?? '';
  const rest = segs.slice(1).join('/');
  if (!validSlug(slug)) return json({ ok: false, error: 'invalid plugin slug' }, 400);

  const ip = clientIp(context.request);
  const rate = await checkRate(env, ip, 'kv', 240, 600);
  if (!rate.ok) return json({ ok: false, error: 'Rate limited' }, 429);

  const prefix = `p:${slug}:`;
  const url = new URL(context.request.url);

  if (url.searchParams.has('list')) {
    const listed = await env.REGISTRY.list({ prefix, limit: 500 });
    return json({
      ok: true,
      keys: listed.keys.map((k) => k.name.slice(prefix.length)),
    });
  }

  if (!rest) return json({ ok: false, error: 'key required' }, 400);
  let clean: string;
  try {
    clean = cleanSegs(rest);
  } catch {
    return json({ ok: false, error: 'bad key' }, 400);
  }
  const key = `${prefix}${clean}`;
  const got = await env.REGISTRY.getWithMetadata(key);
  if (got.value === null) return notFound();
  return new Response(got.value, {
    headers: {
      'content-type': (got.metadata as { ct?: string } | null)?.ct ?? 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function PUT(context: APIContext): Promise<Response> {
  const env = useEnv();
  const segs = parts(context.params.path);
  const slug = segs[0] ?? '';
  const rest = segs.slice(1).join('/');
  if (!validSlug(slug)) return json({ ok: false, error: 'invalid plugin slug' }, 400);
  if (!rest) return json({ ok: false, error: 'key required' }, 400);
  let clean: string;
  try {
    clean = cleanSegs(rest);
  } catch {
    return json({ ok: false, error: 'bad key' }, 400);
  }
  const size = Number(context.request.headers.get('content-length') ?? 0);
  if (size > 1024 * 1024) return json({ ok: false, error: 'value too large (max 1MB)' }, 413);

  const ip = clientIp(context.request);
  const rate = await checkRate(env, ip, 'kv', 240, 600);
  if (!rate.ok) return json({ ok: false, error: 'Rate limited' }, 429);

  const value = await context.request.text();
  const ct = context.request.headers.get('x-content-type') ?? 'text/plain; charset=utf-8';
  await env.REGISTRY.put(`p:${slug}:${clean}`, value, { metadata: { ct } });
  return json({ ok: true, key: `p:${slug}:${clean}` }, 201);
}

export async function DELETE(context: APIContext): Promise<Response> {
  const env = useEnv();
  const segs = parts(context.params.path);
  const slug = segs[0] ?? '';
  const rest = segs.slice(1).join('/');
  if (!validSlug(slug)) return json({ ok: false, error: 'invalid plugin slug' }, 400);
  if (!rest) return json({ ok: false, error: 'key required' }, 400);
  let clean: string;
  try {
    clean = cleanSegs(rest);
  } catch {
    return json({ ok: false, error: 'bad key' }, 400);
  }
  await env.REGISTRY.delete(`p:${slug}:${clean}`);
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