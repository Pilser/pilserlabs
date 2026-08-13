import type { CloudflareEnv } from '../env.d';
import type { ContactPayload } from './types';

export interface ContactRow {
  id: number;
  plugin: string;
  name: string;
  email: string;
  message: string;
  ip: string;
  created_at: string;
}

const CONTACT_TABLE = 'CREATE TABLE IF NOT EXISTS contact (id INTEGER PRIMARY KEY AUTOINCREMENT, plugin TEXT NOT NULL DEFAULT "", name TEXT NOT NULL DEFAULT "", email TEXT NOT NULL DEFAULT "", message TEXT NOT NULL DEFAULT "", ip TEXT NOT NULL DEFAULT "", created_at TEXT NOT NULL DEFAULT (datetime("now")))';

export async function ensureContactTable(env: CloudflareEnv): Promise<void> {
  await env.DB.exec(CONTACT_TABLE);
}

export interface EmailLogRow {
  id: number;
  direction: string;
  from_addr: string;
  to_addr: string;
  subject: string;
  body: string;
  status: string;
  meta: string;
  created_at: string;
}

const EMAIL_LOG_TABLE = 'CREATE TABLE IF NOT EXISTS email_log (id INTEGER PRIMARY KEY AUTOINCREMENT, direction TEXT NOT NULL DEFAULT "in", from_addr TEXT NOT NULL DEFAULT "", to_addr TEXT NOT NULL DEFAULT "", subject TEXT NOT NULL DEFAULT "", body TEXT NOT NULL DEFAULT "", status TEXT NOT NULL DEFAULT "received", meta TEXT NOT NULL DEFAULT "", created_at TEXT NOT NULL DEFAULT (datetime("now")))';

export async function ensureEmailLogTable(env: CloudflareEnv): Promise<void> {
  await env.DB.exec(EMAIL_LOG_TABLE);
}

export async function insertEmailLog(
  env: CloudflareEnv,
  row: { direction: string; fromAddr: string; toAddr: string; subject: string; body: string; status: string; meta?: string },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO email_log (direction, from_addr, to_addr, subject, body, status, meta) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
  )
    .bind(row.direction, row.fromAddr, row.toAddr, row.subject, row.body.slice(0, 4000), row.status, row.meta ?? '')
    .run();
}

export async function listEmailLog(env: CloudflareEnv, limit = 60): Promise<EmailLogRow[]> {
  const res = await env.DB.prepare('SELECT * FROM email_log ORDER BY id DESC LIMIT ?1').bind(limit).all();
  return res.results as unknown as EmailLogRow[];
}

export async function insertContact(env: CloudflareEnv, c: ContactPayload, ip: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO contact (plugin, name, email, message, ip) VALUES (?1, ?2, ?3, ?4, ?5)',
  )
    .bind(c.plugin ?? '', c.name ?? '', c.email ?? '', c.message ?? '', ip)
    .run();
}

export async function listContacts(env: CloudflareEnv, plugin?: string): Promise<ContactRow[]> {
  if (plugin) {
    const res = await env.DB.prepare('SELECT * FROM contact WHERE plugin = ?1 ORDER BY id DESC').bind(plugin).all();
    return res.results as unknown as ContactRow[];
  }
  const res = await env.DB.prepare('SELECT * FROM contact ORDER BY id DESC').all();
  return res.results as unknown as ContactRow[];
}

const DML_TABLE_RE = /\b(?:from|join|update|into)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi;
const CREATE_TABLE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_][a-zA-Z0-9_.]*)/gi;
const ALTER_TABLE_RE = /alter\s+table\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi;

export function sqlSafeTables(sql: string): string[] | null {
  const hits = new Set<string>();
  let m: RegExpExecArray | null;
  for (const re of [DML_TABLE_RE, CREATE_TABLE_RE, ALTER_TABLE_RE]) {
    re.lastIndex = 0;
    while ((m = re.exec(sql))) {
      hits.add(m[1]!.split('.')[0]!);
    }
  }
  const tables = [...hits];
  let safe = true;
  for (const t of tables) {
    if (!/^plugin_[a-zA-Z0-9_]+$/.test(t)) safe = false;
  }
  return safe ? tables : null;
}

export interface PreparedSql {
  sql: string;
  tables: string[] | null;
  error: string | null;
}

export function prepareSql(raw: string): PreparedSql {
  const sql = raw.trim();
  if (!sql) return { sql, tables: null, error: 'sql is required' };
  const stripped = sql.replace(/;\s*$/, '');
  if (stripped.includes(';')) {
    return { sql, tables: null, error: 'Only a single SQL statement is allowed' };
  }
  const tables = sqlSafeTables(stripped);
  if (!tables || tables.length === 0) {
    return { sql: stripped, tables, error: 'SQL must reference plugin_* tables only' };
  }
  return { sql: stripped, tables, error: null };
}