import type { APIContext } from 'astro';
import { useEnv } from '../../lib/env';
import { json, methodNotAllowed, notFound } from '../../lib/http';
import { getEntry, listFeed, validSlug } from '../../lib/registry';
import { applyEntryForm, removeEntryFull } from '../../lib/crud';
import { isAdminRequest } from '../../lib/admin';
import type { RegistryEntry } from '../../lib/types';

export const prerender = false;

function publicEntry(e: RegistryEntry) {
  return {
    slug: e.slug,
    kind: e.kind ?? 'experiment',
    title: e.title,
    description: e.description,
    tags: e.tags,
    button: e.button,
    theme: { colors: e.theme.colors, variables: e.theme.variables },
    status: e.status,
    updatedAt: e.updatedAt,
    createdAt: e.createdAt,
    url: `/view/${e.slug}/`,
    standaloneUrl: `/p/${e.slug}/`,
  };
}

export async function GET(context: APIContext): Promise<Response> {
  const env = useEnv();
  const url = new URL(context.request.url);
  const query = url.searchParams;
  const action = query.get('action');

  if (action === 'feed') {
    const feed = (await listFeed(env)).map(publicEntry);
    return json({ ok: true, feed });
  }
  if (action === 'themes') {
    const feed = await listFeed(env);
    const themes = feed.map((e) => ({ slug: e.slug, title: e.title, colors: e.theme.colors }));
    return json({ ok: true, themes });
  }
  const slug = query.get('slug');
  if (slug) {
    if (!validSlug(slug)) return json({ ok: false, error: 'Invalid slug' }, 400);
    const entry = await getEntry(env, slug);
    if (!entry) return notFound();
    return json({ ok: true, entry: publicEntry(entry) });
  }
  return json({ ok: false, error: 'unknown action' }, 400);
}

export async function POST(context: APIContext): Promise<Response> {
  const env = useEnv();
  const request = context.request;

  if (!(await isAdminRequest(request))) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }
  if (!request.headers.get('content-type')?.includes('multipart/form-data')) {
    return json({ ok: false, error: 'Expected multipart/form-data' }, 400);
  }

  const form = await request.formData();
  try {
    const { entry, created } = await applyEntryForm(env, form);
    return json({ ok: true, created, entry: publicEntry(entry) }, created ? 201 : 200);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Request rejected' }, 400);
  }
}

export async function DELETE(context: APIContext): Promise<Response> {
  const env = useEnv();
  const request = context.request;
  if (!(await isAdminRequest(request))) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }
  const body = await request.text().catch(() => '');
  const slug = (new URLSearchParams(body).get('slug') ?? '').trim().toLowerCase();
  if (!validSlug(slug)) return json({ ok: false, error: 'Invalid slug' }, 400);

  await removeEntryFull(env, slug);
  return json({ ok: true, removed: slug });
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