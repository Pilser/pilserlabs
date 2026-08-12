import { env } from 'cloudflare:workers';
import type { CloudflareEnv } from '../env.d';

export function useEnv(): CloudflareEnv {
  return env as unknown as CloudflareEnv;
}