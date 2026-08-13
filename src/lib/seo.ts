import type { SeoSpec } from './types';

export interface SeoInput {
  title?: string;
  description?: string;
  keywords?: string;
  ogImage?: string;
  robotsIndex: boolean;
  extraMeta: Record<string, string>;
}

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function hasHead(html: string): boolean {
  return /<head[\s>]/i.test(html);
}

function hasTitle(html: string): boolean {
  return /<title[\s>]/i.test(html);
}

function hasMeta(html: string, name: string): boolean {
  return new RegExp(`<meta[^>]+name=["']${name}["']`, 'i').test(html);
}

function rewriteAssets(html: string, basePath: string, files: Set<string>): string {
  const knownAbsolute = new Set<string>();
  for (const f of files) knownAbsolute.add(f);

  let out = html;
  const attrRe = /\b(src|href)=("|')(\/[^"']+?)\2/gi;
  out = out.replace(attrRe, (full, _attr: string, _quote: string, path: string) => {
    const file = path.replace(/^\//, '');
    if (!knownAbsolute.has(file) && !knownAbsolute.has(path.replace(/^\//, 'index.html'))) return full;
    return full.replace(path, `${basePath}${file}`);
  });
  return out;
}

function injectAfterHead(html: string, tags: string): string {
  const open = /<head([^>]*)>/i.exec(html);
  if (open && open.index !== undefined) {
    const at = open.index + open[0].length;
    return html.slice(0, at) + '\n' + tags + html.slice(at);
  }
  const close = /<\/head>/i.exec(html);
  if (close && close.index !== undefined) {
    return html.slice(0, close.index) + tags + html.slice(close.index);
  }
  return html;
}

export function injectSeoIntoHtml(
  html: string,
  basePath: string,
  seoInput: SeoInput,
  files: Set<string>,
  siteUrl: string,
  gaMeasurementId?: string,
): string {
  const base = basePath.endsWith('/') ? basePath : basePath + '/';
  const title = escapeAttr(seoInput.title ?? '');
  const description = escapeAttr(seoInput.description ?? '');
  const keywords = escapeAttr(seoInput.keywords ?? '');
  const canonical = `${siteUrl}${base}`;
  const robots = seoInput.robotsIndex ? 'index, follow' : 'noindex, nofollow';

  let out = rewriteAssets(html, base, files);

  if (!hasHead(out)) {
    const body = /<body([^>]*)>/i.exec(out);
    const tag = '<head></head>';
    if (body && body.index !== undefined) {
      out = out.slice(0, body.index) + tag + out.slice(body.index);
    } else {
      out = tag + out;
    }
  }

  if (hasTitle(out)) {
    out = out.replace(/<title[^>]*>.*?<\/title>/is, '');
  }
  for (const name of ['description', 'keywords', 'robots']) {
    if (hasMeta(out, name)) {
      out = out.replace(new RegExp(`<meta[^>]+name=["']${name}["'][^>]*>`, 'gi'), '');
    }
  }
  out = out.replace(/<meta[^>]+property=["']og:title["'][^>]*>/gi, '');
  out = out.replace(/<meta[^>]+property=["']og:description["'][^>]*>/gi, '');
  out = out.replace(/<link[^>]+rel=["']canonical["'][^>]*>/gi, '');

  let ogImage = '';
  if (seoInput.ogImage) {
    const raw = seoInput.ogImage.trim();
    ogImage = /^https?:\/\//i.test(raw) ? raw : `${canonical}${raw.replace(/^\//, '')}`;
  }

  const extra = Object.entries(seoInput.extraMeta)
    .flatMap(([k, v]) => (k && v ? [`<meta name="${escapeAttr(k)}" content="${escapeAttr(v)}">`] : []))
    .join('\n');

  const ga = gaMeasurementId
    ? [
        `<script async src="https://www.googletagmanager.com/gtag/js?id=${escapeAttr(gaMeasurementId)}"></script>`,
        `<script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', '${escapeAttr(gaMeasurementId)}');</script>`,
      ].join('\n')
    : '';

  const tags = [
    ga,
    `<base href="${base}">`,
    `<title>${title}</title>`,
    `<meta charset="utf-8">`,
    description ? `<meta name="description" content="${description}">` : '',
    keywords ? `<meta name="keywords" content="${keywords}">` : '',
    `<meta name="robots" content="${robots}">`,
    `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="PilserLabs">`,
    `<meta property="og:title" content="${title}">`,
    description ? `<meta property="og:description" content="${description}">` : '',
    `<meta property="og:url" content="${canonical}">`,
    ogImage ? `<meta property="og:image" content="${escapeAttr(ogImage)}">` : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    description ? `<meta name="twitter:description" content="${description}">` : '',
    ogImage ? `<meta name="twitter:image" content="${escapeAttr(ogImage)}">` : '',
    `<link rel="icon" href="${base}favicon.ico">`,
    `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: seoInput.title ?? '',
      description: seoInput.description ?? '',
      url: canonical,
    })}</script>`,
    extra,
  ]
    .filter(Boolean)
    .join('\n');

  return injectAfterHead(out, tags);
}

export function rewriteCssUrls(css: string, basePath: string, files: Set<string>): string {
  const base = basePath.endsWith('/') ? basePath : basePath + '/';
  let out = css;
  const urlRe = /url\((['"]?)\/([^'")\s]+)\1\)/g;
  out = out.replace(urlRe, (full, quote: string, path: string) => {
    const file = path;
    if (!files.has(file)) return full;
    return `url(${quote}${base}${file}${quote})`;
  });
  return out;
}

export function canonicalOf(entry: { slug: string }, siteUrl: string): string {
  return `${siteUrl}/p/${entry.slug}/`;
}

export function toSeoInput(entry: { title: string; description: string; seo: SeoSpec }): SeoInput {
  const input: SeoInput = {
    title: entry.seo.title ?? entry.title,
    description: entry.seo.description ?? entry.description,
    robotsIndex: entry.seo.robotsIndex,
    extraMeta: entry.seo.extraMeta,
  };
  if (entry.seo.keywords) input.keywords = entry.seo.keywords;
  if (entry.seo.ogImage) input.ogImage = entry.seo.ogImage;
  return input;
}