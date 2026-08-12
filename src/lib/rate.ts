import type { CloudflareEnv } from '../env.d';

const RATE_PREFIX = 'rl:';

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfter: number;
}

export async function checkRate(
  env: CloudflareEnv,
  ip: string,
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<RateResult> {
  const windowId = Math.floor(Date.now() / 1000 / windowSec);
  const key = `${RATE_PREFIX}${bucket}:${windowId}:${ip}`;
  const cur = await env.REGISTRY.get(key);
  const count = cur ? Number(cur) : 0;
  if (count >= limit) {
    return { ok: false, remaining: 0, retryAfter: windowSec };
  }
  await env.REGISTRY.put(key, String(count + 1), { expirationTtl: windowSec });
  return { ok: true, remaining: limit - count - 1, retryAfter: 0 };
}

export async function checkRateAbsolute(
  env: CloudflareEnv,
  ipKey: string,
  bucket: string,
  limit: number,
): Promise<RateResult> {
  return checkRate(env, ipKey, bucket, limit, 3600);
}

export function clientIp(request: Request): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf;
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return 'unknown';
}