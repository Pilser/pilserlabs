import type { APIContext } from 'astro';
import { useEnv } from '../../../lib/env';
import { serveDist } from '../../../lib/dist-server';
import { joinPathParam } from '../../../lib/paths';
import { notFound } from '../../../lib/http';

export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {
  const slug = context.params.slug;
  if (!slug) return notFound();
  const env = useEnv();
  const rawPath = joinPathParam(context.params.path);
  const response = await serveDist(env, slug, rawPath);
  if (!response) return notFound();
  return response;
}

export async function HEAD(context: APIContext): Promise<Response> {
  const res = await GET(context);
  return new Response(null, { status: res.status, headers: res.headers });
}