import type { CloudflareEnv } from '../env.d';
import type { RegistryEntry } from './types';

const ENTRY_PREFIX = 'entry:';
const FEED_KEY = 'feed';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;

export function validSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

function entryKey(slug: string): string {
  return `${ENTRY_PREFIX}${slug}`;
}

export async function listFeed(env: CloudflareEnv): Promise<RegistryEntry[]> {
  const raw = await env.REGISTRY.get(FEED_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as RegistryEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function getEntry(env: CloudflareEnv, slug: string): Promise<RegistryEntry | null> {
  const raw = await env.REGISTRY.get(entryKey(slug));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RegistryEntry;
  } catch {
    return null;
  }
}

export async function setEntry(env: CloudflareEnv, entry: RegistryEntry): Promise<void> {
  await env.REGISTRY.put(entryKey(entry.slug), JSON.stringify(entry));
  const feed = (await listFeed(env)).filter((e) => e.slug !== entry.slug);
  feed.push(entry);
  feed.sort((a, b) => b.updatedAt - a.updatedAt);
  await env.REGISTRY.put(FEED_KEY, JSON.stringify(feed));
}

export async function removeEntry(env: CloudflareEnv, slug: string): Promise<void> {
  await env.REGISTRY.delete(entryKey(slug));
  const feed = (await listFeed(env)).filter((e) => e.slug !== slug);
  await env.REGISTRY.put(FEED_KEY, JSON.stringify(feed));
}