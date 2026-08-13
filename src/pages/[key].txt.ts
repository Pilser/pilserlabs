import type { APIContext } from 'astro';
import { useEnv } from '../lib/env';
import { getSeoConfig } from '../lib/seo-config';
import { notFound } from '../lib/http';

export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {
  const env = useEnv();
  const cfg = await getSeoConfig(env);
  const key = context.params.key ?? '';
  if (!cfg.indexnowKey || key !== cfg.indexnowKey) return notFound();
  return new Response(key, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}