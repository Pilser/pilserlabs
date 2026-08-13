import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HOME = process.env.HOME ?? process.env.USERPROFILE;
const ACCOUNT = process.env.PL_ACCOUNT ?? '3bbd769e064ee3986f23f8bfb7327e3b';
const WORKER = 'pilserlabs-main-website';
const D1_ID = process.env.PL_D1 ?? '87ce463d-3d29-4a9a-b698-e61c540bb957';

function token() {
  const toml = readFileSync(join(HOME, '.config/.wrangler/config/default.toml'), 'utf-8');
  const m = toml.match(/oauth_token = "([^"]+)"/);
  if (!m) throw new Error('No wrangler oauth_token found');
  return m[1];
}

async function refreshToken() {
  const tomlPath = join(HOME, '.config/.wrangler/config/default.toml');
  const cfg = readFileSync(tomlPath, 'utf-8');
  const rt = cfg.match(/refresh_token = "([^"]+)"/)?.[1];
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
  const updated = cfg
    .replace(/oauth_token = "([^"]+)"/, `oauth_token = "${j.access_token}"`)
    .replace(/refresh_token = "([^"]+)"/, `refresh_token = "${j.refresh_token}"`)
    .replace(/expiration_time = "([^"]+)"/, `expiration_time = "${new Date(Date.now() + (j.expires_in ?? 3599) * 1000).toISOString()}"`);
  writeFileSync(tomlPath, updated);
  return j.access_token;
}

let activeToken = token();
let didRefresh = false;

async function api(path, { method = 'GET', body } = {}) {
  const attempt = async (tok) => {
    const h = { Authorization: `Bearer ${tok}` };
    if (body !== undefined && !(body instanceof FormData)) {
      h['content-type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method, headers: h, body });
    const text = await res.text();
    if (res.status === 401 && !didRefresh) {
      didRefresh = true;
      activeToken = await refreshToken();
      console.log('  ↻ oauth token refreshed');
      return attempt(activeToken);
    }
    if (!res.ok) throw new Error(`API ${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
    const json = JSON.parse(text);
    return json.result ?? json;
  };
  return attempt(activeToken);
}

const source = readFileSync(join(ROOT, 'email-worker/index.js'), 'utf-8');

const meta = {
  main_module: 'index.js',
  bindings: [{ name: 'DB', type: 'd1', id: D1_ID }],
  compatibility_date: '2026-08-01',
  compatibility_flags: ['nodejs_compat'],
};

const fd = new FormData();
fd.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
fd.append('index.js', new Blob([source], { type: 'application/javascript+module' }), 'index.js');

console.log('== uploading email worker version ==');
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
    annotations: { 'workers/message': 'inbound email log + forward' },
  },
});
console.log('  deployment id:', dep.id);
console.log('== done ==');
