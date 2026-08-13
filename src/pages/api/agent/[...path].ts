import type { APIContext } from 'astro';
import { useEnv } from '../../../lib/env';
import { json, methodNotAllowed, notFound } from '../../../lib/http';
import { checkRate, clientIp } from '../../../lib/rate';
import { getEntry, listFeed, setEntry, validSlug } from '../../../lib/registry';
import { applyEntryForm, applyEntryJson, removeEntryFull } from '../../../lib/crud';
import { unzipDistZip, contentTypeFor } from '../../../lib/zip';
import { extractThemeFromCss } from '../../../lib/theme';
import { buildAgentGuide, extractAgentKey, isAgentKey } from '../../../lib/agent';
import { getMailConfig, setMailConfig, clearMailConfig } from '../../../lib/mailer';
import type { MailConfig } from '../../../lib/mailer';
import { getSeoConfig, setSeoConfig, clearSeoConfig, seoConfigMasked } from '../../../lib/seo-config';
import { deployPluginWorker, deletePluginWorker } from '../../../lib/plugin';
import type { RegistryEntry } from '../../../lib/types';

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
    seo: e.seo,
    status: e.status,
    files: e.files,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    url: `/view/${e.slug}/`,
    standaloneUrl: `/p/${e.slug}/`,
    backend: e.backend ?? null,
  };
}

function segments(path: unknown): string[] {
  if (Array.isArray(path)) return path.map((s) => String(s));
  if (typeof path === 'string' && path) return path.split('/').filter(Boolean);
  return [];
}

export async function GET(context: APIContext): Promise<Response> {
  return handle(context, 'GET');
}

export async function POST(context: APIContext): Promise<Response> {
  return handle(context, 'POST');
}

export async function PATCH(context: APIContext): Promise<Response> {
  return handle(context, 'PATCH');
}

export async function PUT(context: APIContext): Promise<Response> {
  return handle(context, 'PUT');
}

export async function DELETE(context: APIContext): Promise<Response> {
  return handle(context, 'DELETE');
}

async function handle(context: APIContext, method: string): Promise<Response> {
  const env = useEnv();
  const request = context.request;
  const segs = segments(context.params.path);

  const rate = await checkRate(env, clientIp(request), 'agent', 240, 600);
  if (!rate.ok) return json({ ok: false, error: 'Rate limited' }, 429);

  const key = extractAgentKey(request);
  if (!key || !isAgentKey(key)) {
    return json({ ok: false, error: 'Unauthorized — provide the agent key (Authorization: Bearer <AGENT_KEY>)' }, 401);
  }

  const guide = segs.length === 0 || (segs.length === 1 && segs[0] === 'guide');
  if (guide) {
    if (method !== 'GET') return methodNotAllowed('GET');
    return new Response(buildAgentGuide(), {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  if (segs[0] === 'mailconfig') {
    if (method === 'GET') {
      const cfg = await getMailConfig(env);
      return json({ ok: true, configured: !!cfg, config: cfg });
    }
    if (method === 'PUT' || method === 'POST') {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(await request.text());
      } catch {
        return json({ ok: false, error: 'Invalid JSON' }, 400);
      }
      const provider = String(body.provider ?? 'none');
      const existing = await getMailConfig(env);
      const next: MailConfig = { provider: provider === 'smtp' ? 'smtp' : provider === 'api' ? 'api' : 'none' };
      const fill = (k: keyof MailConfig, raw?: unknown) => {
        if (typeof raw === 'string' && raw.trim()) next[k] = raw.trim() as never;
        else if (existing && existing[k]) next[k] = existing[k] as never;
      };
      if (next.provider === 'api') {
        fill('apiUrl', body.apiUrl);
        fill('apiKey', body.apiKey);
        fill('apiFrom', body.apiFrom);
      }
      if (next.provider === 'smtp') {
        fill('smtpHost', body.smtpHost);
        fill('smtpPort', body.smtpPort);
        fill('smtpUser', body.smtpUser);
        fill('smtpPass', body.smtpPass);
        if (typeof body.smtpSecure === 'boolean') next.smtpSecure = body.smtpSecure;
      }
      fill('fromEmail', body.fromEmail);
      fill('toEmail', body.toEmail);
      await setMailConfig(env, next);
      return json({ ok: true, configured: true, config: next });
    }
    if (method === 'DELETE') {
      await clearMailConfig(env);
      return json({ ok: true, configured: false });
    }
    return methodNotAllowed('GET, PUT, DELETE');
  }

  if (segs[0] === 'seo') {
    if (segs[1] === 'ping') {
      if (method !== 'POST') return methodNotAllowed('POST');
      let bodyKey = '';
      try {
        const body: unknown = JSON.parse(await request.text());
        const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
        if (typeof rec.indexnowKey === 'string' && rec.indexnowKey.trim()) bodyKey = rec.indexnowKey.trim();
      } catch {
        /* no body — fall back to stored config */
      }
      const cfg = await getSeoConfig(env);
      const key = bodyKey || cfg.indexnowKey;
      if (!key) {
        return json(
          { ok: false, error: 'no indexnowKey set — set one first: PUT /api/agent/seo {"indexnowKey":"<your-key>"}, or pass {"indexnowKey":"..."} in this request' },
          400,
        );
      }
      const site = (env.SITE_URL ?? 'https://pilserlabs.com').replace(/\/+$/, '');
      const host = new URL(site).host;
      const sitemapUrl = `${site}/sitemap.xml`;
      const results: Record<string, unknown> = {};
      try {
        const g = await fetch(`https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`);
        results.google = g.status;
      } catch (err) {
        results.google = `error: ${err instanceof Error ? err.message : String(err)}`;
      }
      const urlList: string[] = [
        `${site}/`,
        `${site}/projects/`,
        `${site}/ai/`,
        `${site}/contact/`,
        ...(await listFeed(env))
          .filter((e) => e.status === 'live')
          .map((e) => `${site}/p/${e.slug}/`),
      ].slice(0, 100);
      try {
        const i = await fetch('https://api.indexnow.org/indexnow', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ host, key: cfg.indexnowKey, urlList }),
        });
        results.indexnow = i.status;
      } catch (err) {
        results.indexnow = `error: ${err instanceof Error ? err.message : String(err)}`;
      }
      return json({ ok: true, host, urlCount: urlList.length, results });
    }
    if (method === 'GET') {
      const cfg = await getSeoConfig(env);
      return json({ ok: true, config: seoConfigMasked(cfg) });
    }
    if (method === 'PUT' || method === 'POST') {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(await request.text());
      } catch {
        return json({ ok: false, error: 'Invalid JSON' }, 400);
      }
      const patch: Partial<import('../../../lib/seo-config').SeoConfig> = {};
      for (const k of ['gaMeasurementId', 'gscVerification', 'indexnowKey'] as const) {
        if (typeof body[k] === 'string') patch[k] = body[k];
      }
      const cfg = await setSeoConfig(env, patch);
      return json({ ok: true, config: seoConfigMasked(cfg) });
    }
    if (method === 'DELETE') {
      await clearSeoConfig(env);
      return json({ ok: true, config: seoConfigMasked(await getSeoConfig(env)) });
    }
    return methodNotAllowed('GET, PUT, DELETE');
  }

  if (segs[0] === 'entries') {
    const [, slug, action] = segs;

    if (!slug) {
      if (method === 'GET') {
        const feed = (await listFeed(env)).map(publicEntry);
        return json({ ok: true, feed });
      }
      if (method === 'POST') {
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
      return methodNotAllowed('GET, POST');
    }

    if (!validSlug(slug)) return json({ ok: false, error: 'Invalid slug' }, 400);

    if (!action) {
      if (method === 'GET') {
        const entry = await getEntry(env, slug);
        if (!entry) return notFound();
        return json({ ok: true, entry: publicEntry(entry) });
      }
      if (method === 'PATCH') {
        let patch: Record<string, unknown>;
        try {
          patch = JSON.parse(await request.text());
        } catch {
          return json({ ok: false, error: 'Invalid JSON' }, 400);
        }
        try {
          const entry = await applyEntryJson(env, slug, patch);
          return json({ ok: true, entry: publicEntry(entry) });
        } catch (err) {
          return json({ ok: false, error: err instanceof Error ? err.message : 'Update failed' }, 400);
        }
      }
      if (method === 'DELETE') {
        await removeEntryFull(env, slug);
        return json({ ok: true, removed: slug });
      }
      return methodNotAllowed('GET, PATCH, DELETE');
    }

    if (action === 'dist') {
      if (method !== 'PUT' && method !== 'POST') return methodNotAllowed('PUT, POST');
      const form = await request.formData();
      const zip = form.get('file');
      if (!(zip instanceof File) || zip.size === 0) return json({ ok: false, error: 'file (zip) required' }, 400);
      try {
        const unzipped = unzipDistZip(await zip.arrayBuffer());
        const existing = await getEntry(env, slug);
        const prefix = `dists/${slug}/`;
        const putJobs: Promise<void>[] = unzipped.files.map(async (f) => {
          await env.DISTS.put(`${prefix}${f.path}`, f.bytes, { httpMetadata: { contentType: contentTypeFor(f.path) } });
        });
        await Promise.all(putJobs);
        const oldSet = new Set(existing?.files ?? []);
        const newSet = new Set(unzipped.files.map((f) => f.path));
        const removed = [...oldSet].filter((p: string) => !newSet.has(p) && !p.startsWith('banner.'));
        if (removed.length > 0) {
          await Promise.all(removed.map((p: string) => env.DISTS.delete(`${prefix}${p}`).catch(() => undefined)));
        }
        const cssSources = unzipped.files.filter((f): f is import('../../../lib/zip').DistFile & { text: string } => f.text !== null).map((f) => ({ path: f.path, text: f.text! }));
        const theme = extractThemeFromCss(cssSources);
        if (existing) {
          existing.files = unzipped.files.map((f) => f.path);
          existing.theme = theme;
          existing.updatedAt = Date.now();
          await setEntry(env, existing);
        }
        return json({ ok: true, replaced: true, files: unzipped.files.length, theme: theme.colors });
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : 'Dist rejected' }, 400);
      }
    }

    if (action === 'backend') {
      if (method === 'PUT' || method === 'POST') {
        const form = await request.formData();
        const file = form.get('file');
        if (!(file instanceof File) || file.size === 0) return json({ ok: false, error: 'file (worker.js) required' }, 400);
        if (file.size > 500 * 1024) return json({ ok: false, error: 'worker.js too large' }, 400);
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
      if (method === 'DELETE') {
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
      return methodNotAllowed('PUT, POST, DELETE');
    }

    if (action === 'banner') {
      if (method !== 'PUT' && method !== 'POST') return methodNotAllowed('PUT, POST');
      const form = await request.formData();
      const img = form.get('file');
      if (!(img instanceof File) || img.size === 0) return json({ ok: false, error: 'file (image) required' }, 400);
      if (img.size > 6 * 1024 * 1024) return json({ ok: false, error: 'banner too large' }, 400);
      const type = img.type.startsWith('image/') ? img.type : 'image/png';
      const ext = type.includes('jpeg') || type.includes('jpg') ? 'jpg' : type.includes('webp') ? 'webp' : type.includes('gif') ? 'gif' : type.includes('svg') ? 'svg' : type.includes('avif') ? 'avif' : 'png';
      const name = `banner.${ext}`;
      const existing = await getEntry(env, slug);
      if (!existing) return json({ ok: false, error: 'Entry not found' }, 404);
      await env.DISTS.put(`dists/${slug}/${name}`, new Uint8Array(await img.arrayBuffer()), { httpMetadata: { contentType: type } });
      existing.seo.ogImage = `/${name}`;
      if (!existing.files.includes(name)) existing.files.push(name);
      existing.updatedAt = Date.now();
      await setEntry(env, existing);
      return json({ ok: true, banner: `/${name}` });
    }

    return notFound();
  }

  return notFound();
}