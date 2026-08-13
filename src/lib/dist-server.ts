import type { CloudflareEnv, R2ObjectBody } from '../env.d';
import type { RegistryEntry } from './types';
import { getEntry } from './registry';
import { injectSeoIntoHtml, rewriteCssUrls, toSeoInput } from './seo';
import { getSeoConfig } from './seo-config';
import { contentTypeFor } from './zip';

function objKey(slug: string, path: string): string {
  return `dists/${slug}/${path}`;
}

function normalizePath(raw: string): string {
  const clean = raw.replace(/^\/+/, '').replace(/\?.*$/, '');
  const segs = clean.split('/').filter(Boolean);
  safeSegs(segs);
  return segs.join('/');
}

function safeSegs(segs: string[]): void {
  for (const s of segs) {
    if (s === '..' || s.includes('\\') || s.includes('\0')) throw new Error('bad path');
  }
}

const SAFE_HDRS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'SAMEORIGIN' };

export async function serveDist(env: CloudflareEnv, slug: string, rawPath: string): Promise<Response | null> {
  const entry = await getEntry(env, slug);
  if (!entry || entry.status === 'archived') return null;

  let path: string;
  try {
    path = normalizePath(rawPath);
  } catch {
    return null;
  }
  if (!path) path = 'index.html';
  if (path.endsWith('/')) path += 'index.html';

  const obj = await env.DISTS.get(objKey(slug, path));
  if (!obj) {
    if (path.endsWith('/index.html')) {
      const idx = await env.DISTS.get(objKey(slug, 'index.html'));
      if (idx) {
        return found(idx, entry, slug, 'index.html', env);
      }
    }
    return null;
  }
  return found(obj, entry, slug, path, env);
}

function withMainWindowChip(html: string, slug: string): string {
  const chip = `<a href="/view/${slug}/" target="_top" rel="noopener" style="position:fixed;left:16px;bottom:16px;z-index:2147483647;display:inline-flex;align-items:center;gap:8px;padding:10px 15px;font:600 12px/1 ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:.08em;color:#d9fbff;background:rgba(4,18,26,.92);border:1px solid #2f6a80;border-radius:999px;text-decoration:none;backdrop-filter:blur(6px);box-shadow:0 10px 28px rgba(0,0,0,.45)"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M14 8H2M7 3l-5 5 5 5" stroke="currentColor" stroke-width="1.8"/></svg>pilserlabs · open in main window</a>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${chip}</body>`);
  return `${html}${chip}`;
}

async function found(obj: R2ObjectBody, entry: RegistryEntry, slug: string, path: string, env: CloudflareEnv): Promise<Response> {
  const type = contentTypeFor(path);
  const files = new Set(entry.files.map((f) => f.replace(/^\/+/, '')));

  if (type.includes('text/html')) {
    const text = await obj.text();
    const siteUrl = env.SITE_URL || 'https://pilserlabs.com';
    const base = `/p/${slug}/`;
    const seoConfig = await getSeoConfig(env);
    let html = injectSeoIntoHtml(text, base, toSeoInput(entry), files, siteUrl, seoConfig.gaMeasurementId);
    html = withMainWindowChip(html, slug);
    const headers = {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache, must-revalidate, max-age=0',
      ...SAFE_HDRS,
      'x-pilser-entry': entry.slug,
    };
    return new Response(html, { headers });
  }

  if (type.includes('text/css')) {
    const css = rewriteCssUrls(await obj.text(), `/p/${slug}/`, files);
    return new Response(css, { headers: { 'content-type': type, 'cache-control': 'public, max-age=3600', ...SAFE_HDRS } });
  }

  const bytes = await obj.arrayBuffer();
  return new Response(bytes, {
    headers: {
      'content-type': type,
      'cache-control': type.startsWith('image/') || type.includes('font') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      ...SAFE_HDRS,
    },
  });
}