export function agentKey(): string {
  const key = process.env.AGENT_KEY ?? (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.AGENT_KEY;
  return key ?? '';
}

export function isAgentKey(value: string): boolean {
  const key = agentKey();
  return Boolean(key && value && value === key);
}

export function extractAgentKey(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const headerKey = request.headers.get('x-agent-key');
  if (headerKey) return headerKey.trim();
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('key');
    if (q) return q.trim();
  } catch {
    /* noop */
  }
  return null;
}

const BASE = 'https://pilserlabs.com';

export function buildAgentGuide(): string {
  return `PILSERLABS — LAB AGENT GUIDE
============================
You are granted full CRUD access to the PilserLabs portal. Authenticate every
request with the agent key below. No other auth is required.

BASE: ${BASE}
AUTH: Authorization: Bearer <AGENT_KEY>
      (also accepted: ?key=<AGENT_KEY> or header X-Agent-Key: <AGENT_KEY>)

IMPORTANT: the edge proxy enforces a cross-site check. Send an Origin header
on EVERY request (especially POST/PUT/PATCH/DELETE):
      Origin: https://pilserlabs.com
JSON requests are also accepted with this header. Without it, write requests
may be rejected by the proxy as "Cross-site ... forbidden".

The agent key is the ONLY secret you need. It was given to you by the lab owner
together with this guide.

CONTENT MODEL
-------------
Each mounted module ("entry") has:
  slug      unique lowercase id used in URLs: /p/<slug>/ and /view/<slug>/
  kind      "experiment" | "project" | "paper"
  status    "live" | "draft" | "archived"
  title, description, tags[]
  button    { label, design }  design: minimal|solid|outline|bracket|scan|glitch
  theme     { colors: [up to 6 hex], variables }
  seo       { title, description, keywords, ogImage, robotsIndex, extraMeta }
  files[]   artifact list served from /p/<slug>/...
  banner    the card/og image, stored as /banner.<ext> and referenced by seo.ogImage

ENDPOINTS
---------
1) THIS GUIDE
   GET  ${BASE}/api/agent
   -> returns this guide as text.

2) LIST ALL
   GET  ${BASE}/api/agent/entries
   -> { ok, feed: [ {slug, kind, title, description, tags, button, theme, seo,
                      status, files, createdAt, updatedAt, url, standaloneUrl} ] }

3) GET ONE
   GET  ${BASE}/api/agent/entries/{slug}

4) CREATE (new module; a dist zip is required)
   POST ${BASE}/api/agent/entries
   multipart/form-data fields:
     slug, kind, status, title, description, tags (comma separated),
     buttonLabel, buttonDesign, themeColors (JSON array of hex, optional),
     seoTitle, seoDescription, seoKeywords, seoIndex (true/false),
     bannerFile (image file, optional), file (the dist .zip, required)
   -> { ok, created: true, entry }

5) UPDATE METADATA (JSON — no dist required)
   PATCH ${BASE}/api/agent/entries/{slug}
   Content-Type: application/json
   body may contain any of:
     { "kind": "...", "status": "...", "title": "...", "description": "...",
       "tags": ["..."], "buttonLabel": "...", "buttonDesign": "...",
       "themeColors": ["#hex", ...], "seoTitle": "...", "seoDescription": "...",
       "seoKeywords": "...", "seoIndex": true, "bannerUrl": "https://...",
       "clearBanner": true }
   -> { ok, entry }

6) REPLACE DIST (upload a new dist zip)
   PUT  ${BASE}/api/agent/entries/{slug}/dist
   multipart/form-data field: file (the .zip)
   -> { ok, replaced: true }

7) UPLOAD BANNER
   PUT  ${BASE}/api/agent/entries/{slug}/banner
   multipart/form-data field: file (an image)
   -> { ok, banner: "/banner.<ext>" }

8) DELETE
   DELETE ${BASE}/api/agent/entries/{slug}
   -> { ok, removed: "<slug>" }

EXAMPLE (curl)
---------------
curl -X POST ${BASE}/api/agent/entries \\
  -H "Authorization: Bearer <AGENT_KEY>" \\
  -H "Origin: https://pilserlabs.com" \\
  -F "slug=my-module" -F "kind=project" -F "status=live" \\
  -F "title=My Module" -F "description=What it does" \\
  -F "tags=agents,serverless" -F "buttonLabel=open" -F "buttonDesign=neon" \\
  -F "seoIndex=true" -F "file=@dist.zip"

PATCH metadata:
curl -X PATCH ${BASE}/api/agent/entries/my-module \\
  -H "Authorization: Bearer <AGENT_KEY>" \\
  -H "Origin: https://pilserlabs.com" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"live","description":"Updated description"}'

Upload banner:
curl -X PUT ${BASE}/api/agent/entries/my-module/banner \\
  -H "Authorization: Bearer <AGENT_KEY>" \\
  -H "Origin: https://pilserlabs.com" \\
  -F "file=@banner.png"

Delete:
curl -X DELETE ${BASE}/api/agent/entries/my-module \\
  -H "Authorization: Bearer <AGENT_KEY>" \\
  -H "Origin: https://pilserlabs.com"

RULES
-----
- Keep slugs lowercase [a-z0-9-], 2-49 chars.
- Dist zips: max 40MB, must contain index.html at root, files ≤ 20MB each.
- Banners: images ≤ 6MB (png/jpg/webp/gif/svg/avif).
- themeColors: array of hex colors, up to 6; leave empty to auto-extract from CSS.
- Only reference modules via their slug (id). You can manage the entire portal
  with this single key.
`;
}