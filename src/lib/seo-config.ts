import type { CloudflareEnv } from '../env.d';

export interface SeoConfig {
  gaMeasurementId: string;
  gscVerification: string;
  indexnowKey: string;
  updatedAt?: number;
}

const CFG_KEY = 'seo-config';
const EMPTY: SeoConfig = { gaMeasurementId: '', gscVerification: '', indexnowKey: '' };

const cache: { value: SeoConfig | null; at: number } = { value: null, at: 0 };
const TTL = 60_000;

function normalize(raw: unknown): SeoConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    gaMeasurementId: typeof o.gaMeasurementId === 'string' ? o.gaMeasurementId : '',
    gscVerification: typeof o.gscVerification === 'string' ? o.gscVerification : '',
    indexnowKey: typeof o.indexnowKey === 'string' ? o.indexnowKey : '',
  };
}

export async function getSeoConfig(env: CloudflareEnv): Promise<SeoConfig> {
  const cached = cache.value;
  if (cached && Date.now() - cache.at < TTL && (cached.gaMeasurementId || cached.gscVerification || cached.indexnowKey)) {
    return cached;
  }
  let cfg = EMPTY;
  try {
    const raw = await env.REGISTRY.get(CFG_KEY);
    if (raw) cfg = normalize(JSON.parse(raw));
  } catch {
    /* fall through to defaults */
  }
  cache.value = cfg;
  cache.at = Date.now();
  return cfg;
}

export async function setSeoConfig(env: CloudflareEnv, cfg: Partial<SeoConfig>): Promise<SeoConfig> {
  const base = normalize(cfg);
  const next: SeoConfig = {
    gaMeasurementId: base.gaMeasurementId,
    gscVerification: base.gscVerification,
    indexnowKey: base.indexnowKey,
    updatedAt: Date.now(),
  };
  await env.REGISTRY.put(CFG_KEY, JSON.stringify(next));
  cache.value = next;
  cache.at = Date.now();
  return next;
}

export async function clearSeoConfig(env: CloudflareEnv): Promise<void> {
  await env.REGISTRY.delete(CFG_KEY);
  cache.value = { ...EMPTY };
  cache.at = Date.now();
}

export function seoConfigMasked(cfg: SeoConfig): SeoConfig {
  const out: SeoConfig = {
    gaMeasurementId: cfg.gaMeasurementId ?? '',
    gscVerification: cfg.gscVerification ?? '',
    indexnowKey: cfg.indexnowKey ?? '',
  };
  if (cfg.updatedAt !== undefined) out.updatedAt = cfg.updatedAt;
  return out;
}