export function joinPathParam(p: unknown): string {
  if (Array.isArray(p)) return p.join('/');
  if (typeof p === 'string') return p;
  return '';
}

export function cleanSegs(path: string): string {
  const segs = path.split('/').filter((s) => s && s !== '.');
  for (const s of segs) {
    if (s === '..' || s.includes('\\') || s.includes('\0')) throw new Error('bad path');
  }
  return segs.join('/');
}