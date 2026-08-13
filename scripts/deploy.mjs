import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';
import { hash } from '../node_modules/blake3-wasm/dist/index.js';

const HOME = process.env.HOME ?? process.env.USERPROFILE;
const ACCOUNT = process.env.PL_ACCOUNT ?? '3bbd769e064ee3986f23f8bfb7327e3b';
const ZONE = process.env.PL_ZONE ?? 'e29ae6a0ca43752c9a18d292adf5acc2';
const WORKER = 'pilserlabs';
const KV_REGISTRY_ID = process.env.PL_KV ?? 'a145880a2b164d54b304564bb9ee6ca4';
const R2_DISTS = process.env.PL_R2 ?? 'pilserlabs-dists';
const D1_ID = process.env.PL_D1 ?? '87ce463d-3d29-4a9a-b698-e61c540bb957';
const COMPAT_DATE = '2026-08-01';

const ROOT = new URL('..', import.meta.url).pathname;
const SERVER_DIR = join(ROOT, 'dist/server');
const CLIENT_DIR = join(ROOT, 'dist/client');

function token() {
  const toml = readFileSync(join(HOME, '.config/.wrangler/config/default.toml'), 'utf8');
  const m = toml.match(/oauth_token = "([^"]+)"/);
  if (!m) throw new Error('No wrangler oauth_token found');
  return m[1];
}
const TOKEN = process.env.PL_TOKEN ?? token();

async function refreshToken() {
  const tomlPath = join(HOME, '.config/.wrangler/config/default.toml');
  const cfg = readFileSync(tomlPath, 'utf-8');
  const rt = cfg.match(/refresh_token = "([^"]+)"/)?.[1];
  if (!rt) throw new Error('No refresh_token found');
  const res = await fetch('https://dash.cloudflare.com/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: '54d11594-84e4-41aa-b438-e81b8fa78ee7',
      refresh_token: rt,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(j).slice(0, 300));
  const updated = cfg
    .replace(/oauth_token = "([^"]+)"/, `oauth_token = "${j.access_token}"`)
    .replace(/refresh_token = "([^"]+)"/, `refresh_token = "${j.refresh_token}"`)
    .replace(/expiration_time = "([^"]+)"/, `expiration_time = "${new Date(Date.now() + (j.expires_in ?? 3599) * 1000).toISOString()}"`);
  writeFileSync(tomlPath, updated);
  return j.access_token;
}

let activeToken = TOKEN;
let didRefresh = false;

async function api(path, { method = 'GET', body, auth, headers = {} } = {}) {
  const attempt = async (authToken) => {
    const h = { Authorization: `Bearer ${authToken}`, ...headers };
    if (body !== undefined && !(body instanceof FormData)) {
      h['content-type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const url = `https://api.cloudflare.com/client/v4${path}`;
    const res = await fetch(url, { method, headers: h, body });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-json */
    }
    if (res.status === 401 && !didRefresh && !auth) {
      didRefresh = true;
      activeToken = await refreshToken();
      console.log('  ↻ oauth token refreshed');
      return attempt(activeToken);
    }
    if (!res.ok) {
      throw new Error(`API ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    }
    return json;
  };
  const result = await attempt(auth ?? activeToken);
  if (result && typeof result === 'object' && 'result' in result && 'success' in result) {
    return result.result;
  }
  return result;
}

function walkAll(dir, base) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(base, abs).split(sep).join('/');
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...walkAll(abs, base));
    } else {
      out.push(rel);
    }
  }
  return out;
}

function walkModules(dir, base) {
  return walkAll(dir, base).filter((rel) => rel.endsWith('.mjs'));
}

function clientFiles() {
  return walkAll(CLIENT_DIR, CLIENT_DIR).filter(
    (rel) => rel !== '.assetsignore' && rel !== '_headers' && rel !== '_redirects',
  );
}

function hashFile(absPath) {
  const contents = readFileSync(absPath);
  const ext = extname(absPath).slice(1);
  return hash(contents.toString('base64') + ext).toString('hex').slice(0, 32);
}

function contentType(absPath) {
  const ext = extname(absPath).toLowerCase();
  const map = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.txt': 'text/plain',
    '.xml': 'application/xml',
  };
  return map[ext] ?? null;
}

async function main() {
  console.log('== building asset manifest ==');
  const manifest = {};
  for (const rel of clientFiles()) {
    const abs = join(CLIENT_DIR, rel);
    manifest['/' + rel] = { hash: hashFile(abs), size: statSync(abs).size };
  }
  console.log('  manifest entries:', Object.keys(manifest).length);

  console.log('== starting asset upload session ==');
  const session = await api(`/accounts/${ACCOUNT}/workers/scripts/${WORKER}/assets-upload-session`, {
    method: 'POST',
    body: { manifest },
  });
  const sessionJwt = session.jwt;
  const buckets = session.buckets ?? [];
  console.log('  session jwt:', sessionJwt ? sessionJwt.slice(0, 12) + '...' : '(none)', '| buckets:', buckets.length, '| to upload:', buckets.flat().length);

  let completionJwt = sessionJwt;
  if (buckets.flat().length > 0) {
    console.log('== uploading assets ==');
    for (const bucket of buckets) {
      const fd = new FormData();
      for (const fileHash of bucket) {
        const entry = Object.entries(manifest).find(([, m]) => m.hash === fileHash);
        if (!entry) throw new Error('hash not in manifest: ' + fileHash);
        const abs = join(CLIENT_DIR, entry[0]);
        const b64 = readFileSync(abs).toString('base64');
        fd.append(fileHash, new Blob([b64], { type: contentType(abs) ?? 'application/null' }), fileHash);
      }
      const up = await api(`/accounts/${ACCOUNT}/workers/assets/upload?base64=true`, {
        method: 'POST',
        body: fd,
        auth: sessionJwt,
      });
      if (up.jwt) completionJwt = up.jwt;
    }
    console.log('  assets uploaded, completion jwt:', completionJwt ? completionJwt.slice(0, 12) + '...' : '(none)');
  }

  console.log('== uploading worker version ==');
  const modules = walkModules(SERVER_DIR, SERVER_DIR);
  const headersFile = join(CLIENT_DIR, '_headers');
  const headersContent = existsSync(headersFile) ? readFileSync(headersFile, 'utf8') : undefined;

  const meta = {
    main_module: 'entry.mjs',
    bindings: [
      { name: 'REGISTRY', type: 'kv_namespace', namespace_id: KV_REGISTRY_ID },
      { name: 'DISTS', type: 'r2_bucket', bucket_name: R2_DISTS },
      { name: 'DB', type: 'd1', id: D1_ID },
      { name: 'ASSETS', type: 'assets' },
      { name: 'EMAIL', type: 'send_email' },
      { name: 'SITE_URL', type: 'plain_text', text: 'https://pilserlabs.com' },
    ],
    compatibility_date: COMPAT_DATE,
    compatibility_flags: ['nodejs_compat'],
    assets: {
      jwt: completionJwt,
      config: {
        html_handling: 'auto-trailing-slash',
        not_found_handling: 'none',
        run_worker_first: false,
        ...(headersContent ? { _headers: headersContent } : {}),
      },
    },
  };

  const fd = new FormData();
  fd.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  for (const mod of modules) {
    const bytes = readFileSync(join(SERVER_DIR, mod));
    fd.append(mod, new Blob([bytes], { type: 'application/javascript+module' }), mod);
  }
  console.log('  modules:', modules.length, '| main: entry.mjs');

  const version = await api(`/accounts/${ACCOUNT}/workers/scripts/${WORKER}/versions?bindings_inherit=strict`, {
    method: 'POST',
    body: fd,
  });
  console.log('  version id:', version.id);

  console.log('== creating deployment ==');
  const dep = await api(`/accounts/${ACCOUNT}/workers/scripts/${WORKER}/deployments`, {
    method: 'POST',
    body: {
      strategy: 'percentage',
      versions: [{ version_id: version.id, percentage: 100 }],
      annotations: { 'workers/message': 'pilserlabs initial deploy' },
    },
  });
  console.log('  deployment id:', dep.id);

  console.log('== setting ADMIN_PASSWORD secret ==');
  const pass = process.env.PL_ADMIN_PASSWORD;
  if (pass) {
    await api(`/accounts/${ACCOUNT}/workers/scripts/${WORKER}/secrets`, {
      method: 'PUT',
      body: { name: 'ADMIN_PASSWORD', type: 'secret_text', text: pass },
    });
    console.log('  secret set (not echoed)');
  } else {
    console.log('  PL_ADMIN_PASSWORD not set — skipping secret');
  }

  console.log('== setting AGENT_KEY secret ==');
  const agentPass = process.env.PL_AGENT_KEY;
  if (agentPass) {
    await api(`/accounts/${ACCOUNT}/workers/scripts/${WORKER}/secrets`, {
      method: 'PUT',
      body: { name: 'AGENT_KEY', type: 'secret_text', text: agentPass },
    });
    console.log('  agent key secret set (not echoed)');
  } else {
    console.log('  PL_AGENT_KEY not set — skipping agent key');
  }

  console.log('== setting CF_API_TOKEN secret (plugin backends) ==');
  const cfToken = process.env.PL_CF_API_TOKEN;
  if (cfToken) {
    await api(`/accounts/${ACCOUNT}/workers/scripts/${WORKER}/secrets`, {
      method: 'PUT',
      body: { name: 'CF_API_TOKEN', type: 'secret_text', text: cfToken },
    });
    console.log('  CF_API_TOKEN secret set (not echoed)');
  } else {
    console.log('  PL_CF_API_TOKEN not set — plugin backend deploys disabled');
  }

  console.log('== applying D1 schema ==');
  const schemaPath = join(ROOT, 'd1/schema.sql');
  if (existsSync(schemaPath)) {
    const sql = readFileSync(schemaPath, 'utf8');
    const dq = await api(`/accounts/${ACCOUNT}/d1/database/${D1_ID}/query`, { method: 'POST', body: { sql } });
    console.log('  schema applied:', dq.result ? 'ok' : JSON.stringify(dq).slice(0, 200));
  }

  console.log('== custom domains ==');
  for (const hostname of ['pilserlabs.com', 'www.pilserlabs.com']) {
    try {
      const dom = await api(`/accounts/${ACCOUNT}/workers/domains`, {
        method: 'POST',
        body: { hostname, service: WORKER, zone_id: ZONE },
      });
      console.log('  domain ok:', hostname, dom.id);
    } catch (err) {
      console.log('  domain error for', hostname, ':', err.message.slice(0, 300));
    }
  }

  console.log('== done ==');
}

main().catch((err) => {
  console.error('DEPLOY FAILED:', err.message);
  process.exit(1);
});
