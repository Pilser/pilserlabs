import { unzipSync } from 'fflate';
import { MAX_DIST_FILES, MAX_DIST_ZIP } from './types';

export interface DistFile {
  path: string;
  bytes: Uint8Array;
  text: string | null;
}

export interface UnzipResult {
  files: DistFile[];
  index: DistFile | null;
}

const TEXT_EXT: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.cjs': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};

const ALLOWED_EXT = new Set([
  ...Object.keys(TEXT_EXT),
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.tif', '.tiff',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac',
  '.mp4', '.webm', '.mov', '.m4v',
  '.wasm', '.map', '.pdf', '.zip', '.gz',
]);

export function unsafePath(path: string): boolean {
  return path.includes('..') || path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.includes('\\') || path.includes('\0');
}

function stripTopDir(paths: string[]): string[] {
  if (paths.length < 2) return paths;
  const tops = new Set(paths.map((p) => p.split('/')[0] ?? ''));
  if (tops.size === 1 && [...tops][0] !== '') {
    const top = [...tops][0]!;
    return paths.map((p) => (p === top ? 'index.html' : p.replace(`${top}/`, '')));
  }
  if (paths.some((p) => p === 'index.html')) return paths;
  return paths;
}

export function unzipDistZip(buf: ArrayBuffer): UnzipResult {
  if (buf.byteLength > MAX_DIST_ZIP) {
    throw new Error(`archive too large (max ${Math.round(MAX_DIST_ZIP / 1024 / 1024)}MB)`);
  }
  const raw = unzipSync(new Uint8Array(buf));
  const entries = Object.entries(raw);

  const cleaned: [string, Uint8Array][] = [];
  for (const [name, bytes] of entries) {
    if (name.endsWith('/')) continue;
    if (name.includes('__MACOSX') || name.startsWith('.DS_Store')) continue;
    if (unsafePath(name)) throw new Error(`unsafe path in archive: ${name}`);
    cleaned.push([name, bytes]);
  }
  if (cleaned.length === 0) throw new Error('empty archive');
  if (cleaned.length > MAX_DIST_FILES) {
    throw new Error(`too many files (max ${MAX_DIST_FILES})`);
  }

  const paths = stripTopDir(cleaned.map(([n]) => n));
  const files: DistFile[] = cleaned.map(([, bytes], i) => {
    const finalPath = paths[i]!;
    const ext = finalPath.slice(finalPath.lastIndexOf('.'));
    if (!ALLOWED_EXT.has(ext)) throw new Error(`file type not allowed: ${finalPath}`);
    if (bytes.byteLength > 20 * 1024 * 1024) throw new Error(`file too large: ${finalPath}`);
    const text = TEXT_EXT[ext] ? new TextDecoder().decode(bytes) : null;
    return { path: finalPath, bytes, text };
  });

  const index = files.find((f) => f.path === 'index.html');
  if (!index) throw new Error('dist must contain an index.html at its root');
  if (index.bytes.byteLength > 5 * 1024 * 1024) throw new Error('index.html too large');

  return { files, index };
}

export function contentTypeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.'));
  if (TEXT_EXT[ext]) return TEXT_EXT[ext]!;
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.avif':
      return 'image/avif';
    case '.ico':
      return 'image/x-icon';
    case '.bmp':
      return 'image/bmp';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.ttf':
      return 'font/ttf';
    case '.otf':
      return 'font/otf';
    case '.eot':
      return 'application/vnd.ms-fontobject';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.ogg':
      return 'audio/ogg';
    case '.m4a':
      return 'audio/mp4';
    case '.flac':
      return 'audio/flac';
    case '.aac':
      return 'audio/aac';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.m4v':
      return 'video/x-m4v';
    case '.wasm':
      return 'application/wasm';
    case '.map':
      return 'application/json';
    case '.pdf':
      return 'application/pdf';
    case '.zip':
      return 'application/zip';
    case '.gz':
      return 'application/gzip';
    default:
      return 'application/octet-stream';
  }
}