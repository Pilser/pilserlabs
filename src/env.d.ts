/// <reference types="astro/client" />

import type { D1Database, KVNamespace, R2Bucket, R2Object, R2ObjectBody } from '@cloudflare/workers-types';

export interface CloudflareEnv {
  REGISTRY: KVNamespace;
  DISTS: R2Bucket;
  DB: D1Database;
  ASSETS: Fetcher;
  SITE_URL: string;
  ADMIN_PASSWORD: string;
}

declare module 'cloudflare:workers' {
  export const env: CloudflareEnv;
}

declare namespace App {
  interface Locals {
    cfContext: {
      exports: Record<string, unknown>;
      waitUntil(promise: Promise<unknown>): void;
    };
  }
}

export type { D1Database, KVNamespace, R2Bucket, R2Object, R2ObjectBody };
export type D1Result<T = unknown> = import('@cloudflare/workers-types').D1Result<T>;
export type D1PreparedStatement = import('@cloudflare/workers-types').D1PreparedStatement;