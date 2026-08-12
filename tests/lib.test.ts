import { test, expect } from 'bun:test';
import { zipSync } from 'fflate';
import { unzipDistZip, contentTypeFor, unsafePath } from '../src/lib/zip';
import { extractThemeFromCss } from '../src/lib/theme';
import { injectSeoIntoHtml, rewriteCssUrls, toSeoInput } from '../src/lib/seo';
import { setEntry, listFeed, removeEntry, validSlug } from '../src/lib/registry';
import { sqlSafeTables, prepareSql } from '../src/lib/db';
import { serveDist } from '../src/lib/dist-server';
import type { RegistryEntry } from '../src/lib/types';

function makeZip(): ArrayBuffer {
  const bytes = zipSync({
    'index.html': new TextEncoder().encode(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Raw</title>
<link rel="stylesheet" href="/style.css"></head><body>
<h1>Drift Test</h1><img src="/img/a.png"></body></html>`),
    'style.css': new TextEncoder().encode(`:root{--accent:#ff9500;--bg:#14100c;--teal:#17c3b2}
body{background:url(/img/noise.svg)}`),
    'app.js': new TextEncoder().encode('console.log(1)'),
    'img/a.png': new TextEncoder().encode('PNG'),
    'img/noise.svg': new TextEncoder().encode('<svg/>'),
  });
  return bytes.slice().buffer as ArrayBuffer;
}

const entry: RegistryEntry = {
  slug: 'drift-a',
  title: 'Drift A',
  description: 'A drift experiment',
  tags: ['drift', 'graphics'],
  button: { label: 'open drift', design: 'scan' },
  theme: { colors: ['#ff9500', '#17c3b2', '#14100c'], variables: { '--accent': '#ff9500' } },
  seo: {
    title: 'Drift A — results',
    description: 'SEO description here',
    keywords: 'drift,canvas',
    ogImage: '/img/a.png',
    robotsIndex: true,
    extraMeta: {},
  },
  files: ['index.html', 'style.css', 'app.js', 'img/a.png', 'img/noise.svg'],
  createdAt: 1,
  updatedAt: 2,
  status: 'live',
};

test('zip: unzip + root normalization + index detection', () => {
  const r = unzipDistZip(makeZip());
  expect(r.index?.path).toBe('index.html');
  expect(r.files.map((f) => f.path)).toContain('style.css');
  expect(r.files.find((f) => f.path === 'img/a.png')?.bytes.byteLength).toBeGreaterThan(0);
});

test('zip: rejects traversal zips', () => {
  const evil = zipSync({ '../evil.txt': new TextEncoder().encode('x'), 'index.html': new TextEncoder().encode('<p>hi</p>') });
  expect(() => unzipDistZip(evil.slice().buffer as ArrayBuffer)).toThrow();
});

test('theme: extracts palette + root vars from css', () => {
  const t = extractThemeFromCss([{ path: 'style.css', text: entry.theme.variables ? `:root{--accent:#ff9500;--bg:#14100c;--teal:#17c3b2}` : '' }]);
  expect(t.colors).toContain('#ff9500');
  expect(t.variables['--accent']).toBe('#ff9500');
});

test('zip/contentTypeFor mapping', () => {
  expect(contentTypeFor('a.css')).toBe('text/css');
  expect(contentTypeFor('a.js')).toBe('application/javascript');
  expect(contentTypeFor('a.png')).toBe('image/png');
  expect(contentTypeFor('a.woff2')).toBe('font/woff2');
});

test('seo: injects base, title, meta, canonical, robots, og + rewrites absolute assets', () => {
  const raw = entryMarkup();
  const out = injectSeoIntoHtml(raw, '/p/drift-a/', toSeoInput(entry), new Set(entry.files), 'https://pilserlabs.com');
  expect(out).toContain('<base href="/p/drift-a/">');
  expect(out).toContain('<title>Drift A — results</title>');
  expect(out).toContain('content="index, follow"');
  expect(out).toContain('href="https://pilserlabs.com/p/drift-a/"');
  expect(out).toContain('content="https://pilserlabs.com/p/drift-a/img/a.png"');
  expect(out).toContain('href="/p/drift-a/style.css"');
  expect(out).toContain('"@type":"WebPage"');
});

function entryMarkup(): string {
  return `<!doctype html><html><head><title>Raw</title><link rel="stylesheet" href="/style.css"></head><body><h1>x</h1><img src="/img/a.png"></body></html>`;
}

test('seo: css url rewrites only known files', () => {
  const out = rewriteCssUrls('body{background:url(/img/noise.svg)}.a{background:url(https://x/y.png)}', '/p/drift-a/', new Set(['img/noise.svg']));
  expect(out).toContain('url(/p/drift-a/img/noise.svg)');
  expect(out).toContain('url(https://x/y.png)');
});

test('seo: noindex respected', () => {
  const n = { ...entry, seo: { ...entry.seo, robotsIndex: false } };
  const raw = `<html><head><title>t</title></head><body>ok</body></html>`;
  const out = injectSeoIntoHtml(raw, '/p/x/', toSeoInput(n), new Set(n.files), 'https://pilserlabs.com');
  expect(out).toContain('content="noindex, nofollow"');
});

function kvEnv(data: Map<string, string>): any {
  return {
    async get(k: string) {
      return data.get(k) ?? null;
    },
    async put(k: string, v: string) {
      data.set(k, v);
    },
    async delete(k: string) {
      data.delete(k);
    },
  };
}

function r2Env(objs: Map<string, Uint8Array>): any {
  const meta = new Map<string, string>([['style.css', 'text/css'], ['index.html', 'text/html'], ['img/a.png', 'image/png']]);
  return {
    async get(k: string) {
      const v = objs.get(k);
      if (!v) return null;
      return {
        async text() {
          return new TextDecoder().decode(v);
        },
        async arrayBuffer() {
          return v.slice().buffer as ArrayBuffer;
        },
        get body() {
          return null;
        },
        httpMetadata: { contentType: meta.get(k.split('/').pop() ?? '') ?? 'text/html' },
      };
    },
    async put(k: string, bytes: Uint8Array) {
      objs.set(k, bytes);
    },
    async delete(k: string) {
      objs.delete(k);
    },
    async list({ prefix }: { prefix: string }) {
      const objects = [...objs.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, size: objs.get(k)!.byteLength }));
      return { objects, truncated: false, cursor: '' };
    },
  };
}

test('registry: set + feed order + remove', async () => {
  const data = new Map();
  const env = { REGISTRY: kvEnv(data), DISTS: {} } as any;
  await setEntry(env, entry);
  const f = await listFeed(env);
  expect(f).toHaveLength(1);
  expect(f[0]!.slug).toBe('drift-a');
  await removeEntry(env, 'drift-a');
  expect(await listFeed(env)).toHaveLength(0);
});

test('registry: slug validation', () => {
  expect(validSlug('drift-a')).toBe(true);
  expect(validSlug('a')).toBe(false);
  expect(validSlug('-drift')).toBe(false);
  expect(validSlug('DRIFT')).toBe(false);
  expect(validSlug("drip'")).toBe(false);
});

test('db: sql guard only allows plugin_* tables', () => {
  expect(sqlSafeTables('SELECT * FROM plugin_drift WHERE x=1')).toEqual(['plugin_drift']);
  expect(sqlSafeTables('CREATE TABLE plugin_drift (id INTEGER)')).toEqual(['plugin_drift']);
  expect(sqlSafeTables('CREATE TABLE IF NOT EXISTS plugin_drift (id INTEGER)')).toEqual(['plugin_drift']);
  expect(sqlSafeTables('SELECT * FROM contact')).toBe(null);
  expect(prepareSql('SELECT * FROM plugin_drift WHERE x=1;')).toEqual({ sql: 'SELECT * FROM plugin_drift WHERE x=1', tables: ['plugin_drift'], error: null });
  expect(prepareSql('DROP TABLE plugin_drift; DELETE FROM plugin_drift').error).toBe('Only a single SQL statement is allowed');
  expect(prepareSql('SELECT * FROM contact').error).toBe('SQL must reference plugin_* tables only');
  expect(prepareSql('').error).toBe('sql is required');
});

test('serveDist: html served from R2 with injected seo + css rewrite', async () => {
  const objs = new Map<string, Uint8Array>();
  for (const f of entry.files) {
    const bytes = new TextEncoder().encode(f.endsWith('.css') ? '/* c */ body{background:url(/img/noise.svg)}' : f === 'index.html' ? entryMarkup() : f);
    objs.set(`dists/${entry.slug}/${f}`, bytes);
  }
  const data = new Map();
  await setEntry({ REGISTRY: kvEnv(data), DISTS: {} } as any, entry);
  const env = {
    REGISTRY: kvEnv(data),
    DISTS: r2Env(objs),
    SITE_URL: 'https://pilserlabs.com',
  } as any;

  const htmlResp = await serveDist(env, 'drift-a', '');
  expect(htmlResp?.status).toBe(200);
  const html = await htmlResp!.text();
  expect(html).toContain('<title>Drift A — results</title>');
  expect(html).toContain('<base href="/p/drift-a/">');

  const cssResp = await serveDist(env, 'drift-a', 'style.css');
  expect(cssResp?.status).toBe(200);
  const css = await cssResp!.text();
  expect(css).toContain('url(/p/drift-a/img/noise.svg)');

  for (const bad of ['..%2f..%2fwp-config.php', '../secret']) {
    const miss = await serveDist(env, 'drift-a', bad);
    expect(miss).toBe(null);
  }

  const imgResp = await serveDist(env, 'drift-a', 'img/a.png');
  expect(imgResp?.headers.get('content-type')).toBe('image/png');

  const missing = await serveDist(env, 'ghost', '');
  expect(missing).toBe(null);
});

test('zip unsafe path guard', () => {
  expect(unsafePath('../x')).toBe(true);
  expect(unsafePath('a/b/c.js')).toBe(false);
  expect(unsafePath('/abs/path')).toBe(true);
});