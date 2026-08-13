import type { CloudflareEnv } from '../env.d';

export interface MailConfig {
  provider: 'none' | 'api' | 'smtp';
  apiUrl?: string;
  apiKey?: string;
  apiFrom?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpSecure?: boolean;
  fromEmail?: string;
  toEmail?: string;
}

export interface MailSendResult {
  status: 'email-sent' | 'email-rejected' | 'email-failed';
  detail?: string;
}

const CFG_KEY = 'mail-config';

export async function getMailConfig(env: CloudflareEnv): Promise<MailConfig | null> {
  const raw = await env.REGISTRY.get(CFG_KEY);
  if (!raw) return null;
  try {
    const cfg = JSON.parse(raw) as MailConfig;
    if (!cfg || typeof cfg.provider !== 'string') return null;
    return cfg;
  } catch {
    return null;
  }
}

export async function setMailConfig(env: CloudflareEnv, cfg: MailConfig): Promise<void> {
  await env.REGISTRY.put(CFG_KEY, JSON.stringify(cfg));
}

export async function clearMailConfig(env: CloudflareEnv): Promise<void> {
  await env.REGISTRY.delete(CFG_KEY);
}

export async function sendViaMailConfig(
  env: CloudflareEnv,
  msg: { to: string; from: string; subject: string; text: string; html?: string },
): Promise<MailSendResult> {
  const cfg = await getMailConfig(env);
  if (!cfg || cfg.provider === 'none') {
    return { status: 'email-failed', detail: 'no external mail server configured' };
  }
  const dest = cfg.toEmail || msg.to || 'info@pilserlabs.com';
  const sender = cfg.apiFrom || cfg.fromEmail || msg.from || 'info@pilserlabs.com';

  if (cfg.provider === 'api' && cfg.apiUrl) {
    try {
      const res = await fetch(cfg.apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({ from: sender, to: dest, subject: msg.subject, text: msg.text, html: msg.html }),
      });
      if (res.ok) return { status: 'email-sent', detail: `api ${res.status}` };
      const body = await res.text().catch(() => '');
      return { status: 'email-rejected', detail: `api ${res.status} ${body.slice(0, 200)}` };
    } catch (e) {
      return { status: 'email-failed', detail: `api error: ${String(e)}` };
    }
  }

  if (cfg.provider === 'smtp' && cfg.smtpHost) {
    try {
      const sc: SmtpCfg = { smtpHost: cfg.smtpHost };
      if (cfg.smtpPort !== undefined) sc.smtpPort = cfg.smtpPort;
      if (cfg.smtpUser !== undefined) sc.smtpUser = cfg.smtpUser;
      if (cfg.smtpPass !== undefined) sc.smtpPass = cfg.smtpPass;
      if (cfg.smtpSecure !== undefined) sc.smtpSecure = cfg.smtpSecure;
      const smtpMsg: { from: string; to: string; subject: string; text: string; html?: string } = {
        from: sender,
        to: dest,
        subject: msg.subject,
        text: msg.text,
      };
      if (msg.html) smtpMsg.html = msg.html;
      return await sendSmtp(sc, smtpMsg);
    } catch (e) {
      return { status: 'email-failed', detail: `smtp error: ${String(e)}` };
    }
  }

  return { status: 'email-failed', detail: 'incomplete mail configuration' };
}

// ---- minimal SMTP client over cloudflare:sockets ----

interface SmtpCfg {
  smtpHost: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpSecure?: boolean;
}

function encodeMime(header: string, value: string): string {
  const buf = new TextEncoder().encode(value);
  if (buf.length === value.length) return `${header}: ${value}`;
  let hex = '=?UTF-8?B?';
  hex += btoa(value);
  hex += '?=';
  return `${header}: ${hex}`;
}

async function sendSmtp(cfg: SmtpCfg, msg: { from: string; to: string; subject: string; text: string; html?: string }): Promise<MailSendResult> {
  const { connect } = await import('cloudflare:sockets');
  const port = cfg.smtpPort ?? (cfg.smtpSecure ? 465 : 587);
  const socket = connect(
    { hostname: cfg.smtpHost, port },
    { secureTransport: cfg.smtpSecure ? 'on' : 'starttls', allowHalfOpen: true },
  );

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  let buffer = '';

  const readLine = async (): Promise<string> => {
    for (;;) {
      const nl = buffer.indexOf('\n');
      if (nl >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        return line;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('smtp connection closed');
      buffer += decoder.decode(value, { stream: true });
    }
  };

  const expect = async (codes: number[]): Promise<string> => {
    const line = await readLine();
    const code = Number(line.slice(0, 3));
    if (!codes.includes(code)) throw new Error(`smtp ${codes.join('/')} expected, got ${line}`);
    let last = line;
    while (line.length > 3 && line[3] === '-') {
      last = await readLine();
    }
    return last;
  };

  const send = async (c: string): Promise<void> => {
    await writer.write(new TextEncoder().encode(`${c}\r\n`));
  };

  try {
    await expect([220]);
    await send(`EHLO pilserlabs.com`);
    await expect([250]);
    await send(`MAIL FROM:<${msg.from}>`);
    await expect([250]);
    await send(`RCPT TO:<${msg.to}>`);
    await expect([250, 251]);
    await send('DATA');
    await expect([354]);

    const date = new Date().toUTCString();
    const boundary = `_pl_${Date.now().toString(16)}`;
    let data = `Date: ${date}\r\n`;
    data += encodeMime('From', msg.from) + '\r\n';
    data += encodeMime('To', msg.to) + '\r\n';
    data += encodeMime('Subject', msg.subject) + '\r\n';
    data += 'MIME-Version: 1.0\r\n';
    data += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;
    data += `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${msg.text}\r\n`;
    if (msg.html) {
      data += `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${msg.html}\r\n`;
    }
    data += `--${boundary}--\r\n.\r\n`;

    await send(data);
    const finalLine = await expect([250]);
    await send('QUIT');
    return { status: 'email-sent', detail: `smtp ${finalLine}` };
  } finally {
    try {
      socket.close();
    } catch {
      /* noop */
    }
  }
}
