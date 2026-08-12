import type { APIContext } from 'astro';
import { useEnv } from '../../lib/env';
import { json, methodNotAllowed } from '../../lib/http';
import { extractThemeFromCss } from '../../lib/theme';
import { contentTypeFor, unzipDistZip } from '../../lib/zip';
import { getEntry, listFeed, removeEntry, setEntry, validSlug } from '../../lib/registry';
import { isAdminRequest } from '../../lib/admin';
import type { ButtonDesign, EntryStatus, RegistryEntry } from '../../lib/types';

export const prerender = false;

function objKey(slug: string, path: string): string {
  return `dists/${slug}/${path}`;
}

function publicEntry(e: RegistryEntry) {
  return {
    slug: e.slug,
    title: e.title,
    description: e.description,
    tags: e.tags,
    button: e.button,
    theme: { colors: e.theme.colors, variables: e.theme.variables },
    status: e.status,
    updatedAt: e.updatedAt,
    createdAt: e.createdAt,
    url: `/p/${e.slug}/`,
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
  const slug = (form.get('slug') ?? '').toString().trim().toLowerCase();
  if (!validSlug(slug)) {
    return json({ ok: false, error: 'Invalid slug. Use lowercase letters, numbers and dashes (2-49 chars).' }, 400);
  }

  const existing = await getEntry(env, slug);
  const zipFile = form.get('file');
  if (!(zipFile instanceof File) || zipFile.size === 0) {
    return json({ ok: false, error: 'The dist must be uploaded as a .zip file (field "file").' }, 400);
  }

  const title = (form.get('title') ?? '').toString().trim();
  const description = (form.get('description') ?? '').toString().trim();
  const button = {
    label: (form.get('buttonLabel') ?? '').toString().trim() || slug,
    design: (form.get('buttonDesign') ?? 'minimal').toString(),
  };
  const tags = (form.get('tags') ?? '')
    .toString()
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);
  const seoTitle = (form.get('seoTitle') ?? '').toString().trim();
  const seoDescription = (form.get('seoDescription') ?? '').toString().trim();
  const seoKeywords = (form.get('seoKeywords') ?? '').toString().trim();
  const seoIndex = form.get('seoIndex') !== 'noindex';
  const status = (form.get('status') ?? 'live').toString();

  let files;
  try {
    files = unzipDistZip(await zipFile.arrayBuffer());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Archive rejected' }, 400);
  }

  const cssSources = files.files.filter((f) => f.text !== null).map((f) => ({ path: f.path, text: f.text! }));
  const theme = extractThemeFromCss(cssSources);

  const now = Date.now();
  const entry: RegistryEntry = {
    slug,
    title: title || slug,
    description,
    tags,
    button: {
      label: button.label,
      design: (['minimal', 'solid', 'outline', 'bracket', 'scan', 'glitch'].includes(button.design)
        ? button.design
        : 'minimal') as ButtonDesign,
    },
    theme,
    seo: {
      title: seoTitle,
      description: seoDescription,
      keywords: seoKeywords,
      ogImage: '',
      robotsIndex: seoIndex,
      extraMeta: {},
    },
    files: files.files.map((f) => f.path),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    status: (['live', 'draft'].includes(status) ? status : 'live') as EntryStatus,
  };

  await Promise.all(
    files.files.map(async (f) => {
      await env.DISTS.put(objKey(slug, f.path), f.bytes, { httpMetadata: { contentType: contentTypeFor(f.path) } });
    }),
  );
  await setEntry(env, entry);

  return json({ ok: true, created: !existing, entry: publicEntry(entry) }, existing ? 200 : 201);
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

  const prefix = objKey(slug, '');
  let cursor: string | undefined;
  const deletes: Promise<R2Object | void>[] = [];
  do {
    const options: R2ListOptions = { prefix };
    if (cursor) options.cursor = cursor;
    const listed = await env.DISTS.list(options);
    for (const obj of listed.objects) deletes.push(env.DISTS.delete(obj.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  await Promise.all(deletes);

  await removeEntry(env, slug);
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