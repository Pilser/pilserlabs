import type { APIContext } from 'astro';
import { useEnv } from '../lib/env';

export const prerender = false;

export async function GET(_context: APIContext): Promise<Response> {
  const env = useEnv();
  const site = (env.SITE_URL ?? 'https://pilserlabs.com').replace(/\/+$/, '');
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    '',
    `Sitemap: ${site}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}