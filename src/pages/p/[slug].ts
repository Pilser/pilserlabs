import type { APIContext } from 'astro';
import { useEnv } from '../../lib/env';
import { serveDist } from '../../lib/dist-server';
import { notFound } from '../../lib/http';

export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {
  const slug = context.params.slug;
  if (!slug) return notFound();
  const canonical = new URL(context.request.url);
  if (!canonical.pathname.endsWith('/')) {
    return new Response(null, {
      status: 308,
      headers: { location: `/p/${slug}/` },
    });
  }
  const env = useEnv();
  const response = await serveDist(env, slug, '');
  if (!response) return notFound();
  return response;
}