import type { CloudflareEnv } from '../env.d';
import type { EntryKind, RegistryEntry } from './types';

const ENTRY_PREFIX = 'entry:';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;
const KINDS = ['experiment', 'project', 'paper'] as const;
const STATUSES = ['live', 'draft', 'archived'] as const;
const DESIGNS = ['minimal', 'solid', 'outline', 'bracket', 'scan', 'glitch'] as const;

export function validSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

function entryKey(slug: string): string {
  return `${ENTRY_PREFIX}${slug}`;
}

export function normalizeEntry(raw: RegistryEntry): RegistryEntry {
  const kind = (KINDS as readonly string[]).includes(raw.kind) ? (raw.kind as EntryKind) : 'experiment';
  return {
    kind,
    slug: raw.slug,
    title: raw.title ?? raw.slug,
    description: raw.description ?? '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    button: {
      label: raw.button?.label ?? 'open',
      design: (DESIGNS as readonly string[]).includes(raw.button?.design) ? raw.button.design : 'minimal',
    },
    theme: {
      colors: Array.isArray(raw.theme?.colors) ? raw.theme.colors : [],
      variables: raw.theme?.variables ?? {},
    },
    seo: (() => {
      const seo: RegistryEntry['seo'] = {
        robotsIndex: raw.seo?.robotsIndex !== false,
        extraMeta: raw.seo?.extraMeta ?? {},
      };
      if (raw.seo?.title) seo.title = raw.seo.title;
      if (raw.seo?.description) seo.description = raw.seo.description;
      if (raw.seo?.keywords) seo.keywords = raw.seo.keywords;
      if (raw.seo?.ogImage) seo.ogImage = raw.seo.ogImage;
      return seo;
    })(),
    files: Array.isArray(raw.files) ? raw.files : [],
    createdAt: raw.createdAt ?? 0,
    updatedAt: raw.updatedAt ?? 0,
    status: (STATUSES as readonly string[]).includes(raw.status) ? raw.status : 'live',
  };
}

export async function listFeed(env: CloudflareEnv): Promise<RegistryEntry[]> {
  const listed = await env.REGISTRY.list({ prefix: ENTRY_PREFIX, limit: 1000 });
  const entries = await Promise.all(
    listed.keys
      .map((k) => k.name)
      .filter((n) => n.startsWith(ENTRY_PREFIX))
      .map(async (n) => {
        const raw = await env.REGISTRY.get(n);
        if (!raw) return null;
        try {
          return normalizeEntry(JSON.parse(raw) as RegistryEntry);
        } catch {
          return null;
        }
      }),
  );
  return entries
    .filter((e): e is RegistryEntry => e !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getEntry(env: CloudflareEnv, slug: string): Promise<RegistryEntry | null> {
  const raw = await env.REGISTRY.get(entryKey(slug));
  if (!raw) return null;
  try {
    return normalizeEntry(JSON.parse(raw) as RegistryEntry);
  } catch {
    return null;
  }
}

export async function setEntry(env: CloudflareEnv, entry: RegistryEntry): Promise<void> {
  await env.REGISTRY.put(entryKey(entry.slug), JSON.stringify(entry));
}

export async function removeEntry(env: CloudflareEnv, slug: string): Promise<void> {
  await env.REGISTRY.delete(entryKey(slug));
}