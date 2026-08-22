export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });

    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // Supabase -> Cloudflare license notification / admin-originated protected POST.
    if (request.method === 'POST' && (url.pathname === '/' || url.pathname === '/api/license-notification')) {
      try {
        const authHeader = request.headers.get('Authorization');
        const expectedToken = env.ADMIN_SECRET_TOKEN ? `Bearer ${env.ADMIN_SECRET_TOKEN}` : null;
        if (!expectedToken || authHeader !== expectedToken) return json({ error: 'Unauthorized request' }, 401);

        const payload = await request.json();
        const record = payload.record || payload;
        if (!record?.telegram_chat_id) return json({ error: 'Invalid payload or missing telegram_chat_id' }, 400);
        if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'TELEGRAM_BOT_TOKEN is missing' }, 500);

        const esc = v => String(v ?? '').replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
        const chatId = record.telegram_chat_id;
        const messageText = `🆕 *New License Request Notification*\\!\n\n` +
          `👤 *Name:* ${esc(record.name || 'User')}\n` +
          `📧 *Email:* ${esc(record.email || 'N/A')}\n` +
          `📱 *Telegram User:* ${esc(record.telegram || 'N/A')}\n` +
          `💻 *Device:* ${esc(record.device_name || 'Unknown Device')}\n` +
          `🆔 *Chat ID:* \\`${esc(chatId)}\\`\n\n` +
          `⏳ Status is pending\\. Please approve from your Admin Dashboard\\.`;

        const telegramResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: messageText, parse_mode: 'MarkdownV2' })
        });
        if (!telegramResponse.ok) return json({ error: 'Telegram API Error', details: await telegramResponse.text() }, 502);
        return json({ success: true, message: 'Notification sent to Telegram.' }, 200);
      } catch (error) { return json({ error: 'Internal Server Error', message: error.message }, 500); }
    }

    // Extension registration endpoint. Stores a pending request in Supabase.
    if (request.method === 'POST' && url.pathname === '/api/register') {
      try {
        if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase variables are missing' }, 500);
        const body = await request.json();
        if (!body.telegram_chat_id) return json({ error: 'telegram_chat_id is required' }, 400);
        const response = await fetch(`${env.SUPABASE_URL}/rest/v1/license_registrations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Prefer': 'return=representation' },
          body: JSON.stringify({ name: body.name || 'User', email: body.email || null, telegram: body.telegram || null, telegram_chat_id: body.telegram_chat_id, device_name: body.device_name || 'Unknown Device' })
        });
        const text = await response.text();
        if (!response.ok) return json({ error: 'Supabase registration failed', details: text }, 502);
        return json({ success: true, registration: JSON.parse(text) }, 200);
      } catch (error) { return json({ error: 'Registration failed', message: error.message }, 500); }
    }

    // Telegram webhook endpoint. Telegram update is acknowledged safely; actual license flow remains in Supabase.
    if (request.method === 'POST' && url.pathname === '/api/telegram-webhook') {
      try {
        const update = await request.json();
        const chatId = update?.message?.chat?.id;
        if (!chatId) return json({ ok: true, ignored: true }, 200);
        return json({ ok: true }, 200);
      } catch (error) { return json({ ok: false, error: error.message }, 400); }
    }

    // Default browser visit loads Pages assets.
    return env.ASSETS.fetch(request);
  }
};