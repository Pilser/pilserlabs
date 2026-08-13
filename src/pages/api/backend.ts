import type { APIContext } from 'astro';
import { useEnv } from '../../lib/env';
import { json, methodNotAllowed } from '../../lib/http';
import { deployPluginWorker, deletePluginWorker } from '../../lib/plugin';
import { getEntry, setEntry, validSlug } from '../../lib/registry';
import { isAdminRequest } from '../../lib/admin';

export const prerender = false;

export async function POST(context: APIContext): Promise<Response> {
  const env = useEnv();
  if (!(await isAdminRequest(context.request))) return json({ ok: false, error: 'Unauthorized' }, 401);

  const form = await context.request.formData();
  const slug = String(form.get('slug') ?? '').trim().toLowerCase();
  const file = form.get('file');
  if (!validSlug(slug)) return json({ ok: false, error: 'invalid slug' }, 400);
  if (!(file instanceof File) || file.size === 0) return json({ ok: false, error: 'file (worker.js) required' }, 400);
  if (file.size > 500 * 1024) return json({ ok: false, error: 'worker.js too large (max 500KB)' }, 400);

  const existing = await getEntry(env, slug);
  if (!existing) return json({ ok: false, error: 'Entry not found' }, 404);

  const code = await file.text();
  try {
    await deployPluginWorker(env, slug, code);
    existing.backend = { deployed: true, note: 'worker deployed', updatedAt: Date.now() };
    existing.updatedAt = Date.now();
    await setEntry(env, existing);
    return json({ ok: true, deployed: true, worker: `pl-plugin-${slug}`, route: `pilserlabs.com/api/plugin/${slug}/*` });
  } catch (err) {
    existing.backend = { deployed: false, note: err instanceof Error ? err.message : String(err), updatedAt: Date.now() };
    existing.updatedAt = Date.now();
    await setEntry(env, existing);
    return json({ ok: false, error: err instanceof Error ? err.message : 'deploy failed' }, 400);
  }
}

export async function DELETE(context: APIContext): Promise<Response> {
  const env = useEnv();
  if (!(await isAdminRequest(context.request))) return json({ ok: false, error: 'Unauthorized' }, 401);
  const url = new URL(context.request.url);
  const slug = (url.searchParams.get('slug') ?? '').trim().toLowerCase();
  if (!validSlug(slug)) return json({ ok: false, error: 'invalid slug' }, 400);

  try {
    await deletePluginWorker(env, slug);
  } catch {
    /* best-effort */
  }
  const existing = await getEntry(env, slug);
  if (existing) {
    delete existing.backend;
    existing.updatedAt = Date.now();
    await setEntry(env, existing);
  }
  return json({ ok: true, removed: `pl-plugin-${slug}` });
}

export async function onRequest(context: APIContext): Promise<Response> {
  switch (context.request.method) {
    case 'POST':
      return POST(context);
    case 'DELETE':
      return DELETE(context);
    default:
      return methodNotAllowed('POST, DELETE');
  }
}