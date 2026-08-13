export default {
  async email(message, env, ctx) {
    const to = String(message.to || '');
    const from = String(message.from || '');
    const subject = message.headers.get('subject') || '';
    let body = '';
    try {
      body = await new Response(message.raw).text();
    } catch (e) {
      body = '(unreadable body)';
    }

    const ensure = async () => {
      try {
        await env.DB.exec(
          'CREATE TABLE IF NOT EXISTS email_log (id INTEGER PRIMARY KEY AUTOINCREMENT, direction TEXT NOT NULL DEFAULT "in", from_addr TEXT NOT NULL DEFAULT "", to_addr TEXT NOT NULL DEFAULT "", subject TEXT NOT NULL DEFAULT "", body TEXT NOT NULL DEFAULT "", status TEXT NOT NULL DEFAULT "received", meta TEXT NOT NULL DEFAULT "", created_at TEXT NOT NULL DEFAULT (datetime("now")))',
        );
      } catch (e) {
        console.error('email_log ensure failed', String(e));
      }
    };

    const insert = async (status, meta = '') => {
      try {
        await env.DB.prepare(
          'INSERT INTO email_log (direction, from_addr, to_addr, subject, body, status, meta) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
        ).bind('in', from, to, subject, body.slice(0, 4000), status, meta).run();
      } catch (e) {
        console.error('email_log insert failed', String(e));
      }
    };

    await ensure();
    try {
      await message.forward('smjsoftmakersinter1212@gmail.com');
      await insert('forwarded', JSON.stringify({ via: 'pilserlabs-main-website' }));
    } catch (e) {
      await insert('forward-failed', String(e).slice(0, 300));
    }
  },
};
