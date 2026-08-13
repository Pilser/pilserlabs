import type { CloudflareEnv } from '../env.d';

const ACCOUNT = '3bbd769e064ee3986f23f8bfb7327e3b';
const ZONE = 'e29ae6a0ca43752c9a18d292adf5acc2';
const REGISTRY_ID = 'a145880a2b164d54b304564bb9ee6ca4';
const D1_ID = '87ce463d-3d29-4a9a-b698-e61c540bb957';
const R2_BUCKET = 'pilserlabs-dists';

export function pluginWorkerName(slug: string): string {
  return `pl-plugin-${slug}`;
}

export function pluginRoutePattern(slug: string): string {
  return `pilserlabs.com/api/plugin/${slug}/*`;
}

async function cf(env: CloudflareEnv, path: string, method: string, body?: BodyInit | null): Promise<any> {
  const token = env.CF_API_TOKEN;
  if (!token) throw new Error('plugin deployment not configured — set the CF_API_TOKEN secret');
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers,
    body: body ?? null,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`CF ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text).result;
  } catch {
    return null;
  }
}

async function upsertRoute(env: CloudflareEnv, slug: string, name: string): Promise<void> {
  const pattern = pluginRoutePattern(slug);
  const routes = (await cf(env, `/zones/${ZONE}/workers/routes`, 'GET')) ?? [];
  const existing = routes.find((r: { pattern: string }) => r.pattern === pattern);
  if (existing) {
    await cf(env, `/zones/${ZONE}/workers/routes/${existing.id}`, 'PUT', JSON.stringify({ pattern, script: name }));
  } else {
    await cf(env, `/zones/${ZONE}/workers/routes`, 'POST', JSON.stringify({ pattern, script: name }));
  }
}

export async function deployPluginWorker(env: CloudflareEnv, slug: string, code: string): Promise<void> {
  const name = pluginWorkerName(slug);
  const meta = {
    main_module: 'worker.js',
    bindings: [
      { name: 'DISTS', type: 'r2_bucket', bucket_name: R2_BUCKET },
      { name: 'REGISTRY', type: 'kv_namespace', namespace_id: REGISTRY_ID },
      { name: 'DB', type: 'd1', id: D1_ID },
      { name: 'SITE_URL', type: 'plain_text', text: 'https://pilserlabs.com' },
    ],
    compatibility_date: '2026-08-01',
    compatibility_flags: ['nodejs_compat'],
  };
  const fd = new FormData();
  fd.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  fd.append('worker.js', new Blob([code], { type: 'application/javascript+module' }), 'worker.js');

  await cf(env, `/accounts/${ACCOUNT}/workers/scripts/${name}?bindings_inherit=strict`, 'PUT', fd);
  await upsertRoute(env, slug, name);
}

export async function deletePluginWorker(env: CloudflareEnv, slug: string): Promise<void> {
  const name = pluginWorkerName(slug);
  const pattern = pluginRoutePattern(slug);
  try {
    const routes = (await cf(env, `/zones/${ZONE}/workers/routes`, 'GET')) ?? [];
    const existing = routes.find((r: { pattern: string }) => r.pattern === pattern);
    if (existing) {
      await cf(env, `/zones/${ZONE}/workers/routes/${existing.id}`, 'DELETE');
    }
  } catch {
    /* route cleanup best-effort */
  }
  try {
    await cf(env, `/accounts/${ACCOUNT}/workers/scripts/${name}?force=true`, 'DELETE');
  } catch {
    /* worker may not exist */
  }
}

export async function pluginDeployHint(): Promise<string> {
  return 'plugin backends need the CF_API_TOKEN secret (Workers Scripts + Workers Routes edit)';
}
