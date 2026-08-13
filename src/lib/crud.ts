import type { CloudflareEnv } from '../env.d';
import type { EntryKind, EntryStatus, RegistryEntry } from './types';
import { getEntry, setEntry, validSlug } from './registry';
import { extractThemeFromCss } from './theme';
import { contentTypeFor, unzipDistZip } from './zip';

const KINDS = ['experiment', 'project', 'paper'];
const STATUSES = ['live', 'draft', 'archived'];
const DESIGNS = ['minimal', 'solid', 'outline', 'bracket', 'scan', 'glitch'];

function objKey(slug: string, path: string): string {
  return `dists/${slug}/${path}`;
}

function parseJsonArray(v: FormDataEntryValue | string | null): unknown {
  const raw = v instanceof File ? null : v;
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseJsonObject(v: FormDataEntryValue | string | null): Record<string, string> {
  const parsed = parseJsonArray(v);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(parsed)) {
    if (typeof val === 'string') out[k] = val;
    else if (typeof val === 'number' || typeof val === 'boolean') out[k] = String(val);
  }
  return out;
}

function field(form: FormData, key: string, fallback = ''): string {
  const v = form.get(key);
  return v instanceof File ? '' : (v ?? '').toString().trim() || fallback;
}

function fieldFile(form: FormData, key: string): File | null {
  const v = form.get(key);
  return v instanceof File && v.size > 0 ? v : null;
}

function boolField(form: FormData, key: string, def = true): boolean {
  const v = form.get(key);
  if (v === null) return def;
  return v === 'true' || v === '1' || v === 'on';
}

function extFromType(type: string): string {
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('svg')) return 'svg';
  if (type.includes('avif')) return 'avif';
  return 'png';
}

export interface ApplyResult {
  entry: RegistryEntry;
  created: boolean;
}

export interface JsonPatch {
  kind?: string;
  status?: string;
  title?: string;
  description?: string;
  tags?: string[];
  buttonLabel?: string;
  buttonDesign?: string;
  themeColors?: string[];
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  seoIndex?: boolean;
  bannerUrl?: string;
  clearBanner?: boolean;
}

export async function applyEntryJson(env: CloudflareEnv, slug: string, patch: JsonPatch): Promise<RegistryEntry> {
  if (!validSlug(slug)) throw new Error('Invalid slug');
  const existing = await getEntry(env, slug);
  if (!existing) throw new Error('Entry not found');

  if (typeof patch.title === 'string' && patch.title.trim()) existing.title = patch.title.trim();
  if (typeof patch.description === 'string') existing.description = patch.description.trim();
  if (Array.isArray(patch.tags)) existing.tags = patch.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8);
  if (typeof patch.kind === 'string' && KINDS.includes(patch.kind)) existing.kind = patch.kind as EntryKind;
  if (typeof patch.status === 'string' && STATUSES.includes(patch.status)) existing.status = patch.status as EntryStatus;
  if (typeof patch.buttonLabel === 'string' && patch.buttonLabel.trim()) existing.button.label = patch.buttonLabel.trim();
  if (typeof patch.buttonDesign === 'string' && DESIGNS.includes(patch.buttonDesign)) existing.button.design = patch.buttonDesign as RegistryEntry['button']['design'];
  if (Array.isArray(patch.themeColors)) {
    const onlyHex = patch.themeColors.filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c));
    if (onlyHex.length > 0) existing.theme = { ...existing.theme, colors: [...new Set(onlyHex)].slice(0, 6) };
  }
  if (typeof patch.seoTitle === 'string') {
    const v = patch.seoTitle.trim();
    if (v) existing.seo.title = v;
    else delete existing.seo.title;
  }
  if (typeof patch.seoDescription === 'string') {
    const v = patch.seoDescription.trim();
    if (v) existing.seo.description = v;
    else delete existing.seo.description;
  }
  if (typeof patch.seoKeywords === 'string') {
    const v = patch.seoKeywords.trim();
    if (v) existing.seo.keywords = v;
    else delete existing.seo.keywords;
  }
  if (typeof patch.seoIndex === 'boolean') existing.seo.robotsIndex = patch.seoIndex;
  if (typeof patch.bannerUrl === 'string' && patch.bannerUrl.trim()) {
    existing.seo.ogImage = /^https?:\/\//i.test(patch.bannerUrl) ? patch.bannerUrl : patch.bannerUrl.replace(/^\/+/, '/');
  }
  if (patch.clearBanner) {
    const old = existing.seo.ogImage?.replace(/^\//, '');
    if (old && !old.includes('://') && old.startsWith('banner.')) {
      await env.DISTS.delete(objKey(slug, old)).catch(() => undefined);
      existing.files = existing.files.filter((p) => p !== old);
    }
    existing.seo.ogImage = '';
  }

  existing.updatedAt = Date.now();
  await setEntry(env, existing);
  return existing;
}

export async function applyEntryForm(env: CloudflareEnv, form: FormData): Promise<ApplyResult> {
  const slug = field(form, 'slug').toLowerCase();
  if (!validSlug(slug)) {
    throw new Error('Invalid slug. Use lowercase letters, numbers and dashes (2-49 chars).');
  }
  const title = field(form, 'title');
  if (!title) throw new Error('title is required');
  const buttonLabel = field(form, 'buttonLabel');
  if (!buttonLabel) throw new Error('buttonLabel is required');

  const existing = await getEntry(env, slug);
  const kindRaw = field(form, 'kind', 'experiment');
  const statusRaw = field(form, 'status', 'live');
  const designRaw = field(form, 'buttonDesign', 'minimal');
  const tags = field(form, 'tags')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);

  const kind = (KINDS.includes(kindRaw) ? kindRaw : 'experiment') as EntryKind;
  const status = (STATUSES.includes(statusRaw) ? statusRaw : 'live') as EntryStatus;
  const design = (DESIGNS.includes(designRaw) ? designRaw : 'minimal') as RegistryEntry['button']['design'];

  const zipFile = fieldFile(form, 'file');
  let files: { path: string; bytes: Uint8Array }[] | null = null;
  let theme = existing?.theme ?? { colors: [], variables: {} };

  if (zipFile) {
    let unzipped;
    try {
      unzipped = unzipDistZip(await zipFile.arrayBuffer());
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Archive rejected');
    }
    files = unzipped.files;
    const cssSources = unzipped.files.filter((f) => f.text !== null).map((f) => ({ path: f.path, text: f.text! }));
    theme = extractThemeFromCss(cssSources);
  }

  const themeOverride = parseJsonArray(field(form, 'themeColors'));
  if (Array.isArray(themeOverride)) {
    const onlyHex = themeOverride.filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c));
    if (onlyHex.length > 0) theme = { ...theme, colors: [...new Set(onlyHex)].slice(0, 6) };
  }

  const now = Date.now();
  const entry: RegistryEntry = {
    slug,
    kind,
    title,
    description: field(form, 'description'),
    tags,
    button: { label: buttonLabel, design },
    theme,
    seo: {
      title: field(form, 'seoTitle'),
      description: field(form, 'seoDescription'),
      keywords: field(form, 'seoKeywords'),
      ogImage: existing?.seo.ogImage ?? '',
      robotsIndex: boolField(form, 'seoIndex'),
      extraMeta: parseJsonObject(field(form, 'seoExtra')),
    },
    files: existing?.files ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    status,
  };

  const prefix = objKey(slug, '');
  void prefix;

  if (files) {
    const putJobs: Promise<void>[] = files.map(async (f) => {
      await env.DISTS.put(objKey(slug, f.path), f.bytes, { httpMetadata: { contentType: contentTypeFor(f.path) } });
    });
    await Promise.all(putJobs);

    const oldSet = new Set(existing?.files ?? []);
    const newSet = new Set(files.map((f) => f.path));
    const removed = [...oldSet].filter((p) => !newSet.has(p) && p !== 'banner.png' && p !== 'banner.jpg' && p !== 'banner.webp' && p !== 'banner.svg' && p !== 'banner.gif' && p !== 'banner.avif');
    if (removed.length > 0) {
      await Promise.all(removed.map((p) => env.DISTS.delete(objKey(slug, p)).catch(() => undefined)));
    }
    entry.files = files.map((f) => f.path);
  }

  const bannerFile = fieldFile(form, 'bannerFile') ?? fieldFile(form, 'ogImage');
  if (bannerFile) {
    if (bannerFile.size > 6 * 1024 * 1024) throw new Error('banner image too large (max 6MB)');
    const type = bannerFile.type.startsWith('image/') ? bannerFile.type : 'image/png';
    const ext = extFromType(type);
    const name = `banner.${ext}`;
    await env.DISTS.put(objKey(slug, name), new Uint8Array(await bannerFile.arrayBuffer()), {
      httpMetadata: { contentType: type },
    });
    entry.seo.ogImage = `/${name}`;
    if (!entry.files.includes(name)) entry.files.push(name);
  }

  const bannerUrl = field(form, 'bannerUrl');
  if (bannerUrl) {
    entry.seo.ogImage = /^https?:\/\//i.test(bannerUrl) ? bannerUrl : bannerUrl.replace(/^\/+/, '/');
  }

  const clearBanner = field(form, 'clearBanner');
  if (clearBanner === 'true' || clearBanner === '1') {
    const oldBanner = entry.seo.ogImage?.replace(/^\//, '');
    if (oldBanner && !oldBanner.includes('://') && oldBanner.startsWith('banner.')) {
      await env.DISTS.delete(objKey(slug, oldBanner)).catch(() => undefined);
      entry.files = entry.files.filter((p) => p !== oldBanner);
    }
    entry.seo.ogImage = '';
  }

  await setEntry(env, entry);
  return { entry, created: !existing };
}

export async function removeEntryFull(env: CloudflareEnv, slug: string): Promise<void> {
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
  const { removeEntry } = await import('./registry');
  await removeEntry(env, slug);
}
