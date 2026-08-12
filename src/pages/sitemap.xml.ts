import type { APIContext } from 'astro';
import { useEnv } from '../lib/env';
import { listFeed } from '../lib/registry';
import type { RegistryEntry } from '../lib/types';

export const prerender = false;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export async function GET(_context: APIContext): Promise<Response> {
  const env = useEnv();
  const site = (env.SITE_URL ?? 'https://pilserlabs.com').replace(/\/+$/, '');
  const feed = await listFeed(env);
  const live = feed.filter((e: RegistryEntry) => e.status === 'live');

  const url = (loc: string, lastmod: number, priority = '0.5') =>
    `  <url>\n    <loc>${site}${loc}</loc>\n    <lastmod>${iso(lastmod)}</lastmod>\n    <priority>${priority}</priority>\n  </url>`;

  const urls = [
    url('/', Date.now(), '1.0'),
    url('/admin', Date.now(), '0.2'),
    ...live.map((e: RegistryEntry) => url(`/p/${e.slug}/`, e.updatedAt, '0.9')),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}