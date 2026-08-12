export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export async function readJason(body: Request['body'] | null): Promise<Record<string, unknown> | null> {
  if (!body) return null;
  try {
    const text = await safeText(body);
    const parsed = text ? JSON.parse(text) : null;
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

async function safeText(body: ReadableStream | null): Promise<string> {
  const text = await new Response(body).text();
  return text;
}

export function parseBool(v: unknown): boolean {
  return v === true || v === 'true' || v === '1' || v === 'on';
}

export function str(v: unknown, fallback = ''): string {
  if (v === undefined || v === null) return fallback;
  return String(v);
}

export function notFound(): Response {
  return new Response('not found', { status: 404 });
}

export function methodNotAllowed(allowed: string): Response {
  return new Response(`method not allowed (${allowed})`, { status: 405 });
}