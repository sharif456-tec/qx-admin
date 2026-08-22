export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' } });

    // Telegram webhook: automatically link Telegram account/chat to Supabase.
    if (request.method === 'POST' && url.pathname === '/api/telegram-webhook') {
      try {
        const update = await request.json();
        const message = update?.message || update?.edited_message;
        const chat = message?.chat;
        const from = message?.from || chat;
        if (!chat?.id) return json({ ok: true, ignored: true });
        if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ ok: false, error: 'Supabase variables are missing' }, 500);

        const chatRow = {
          chat_id: String(chat.id),
          username: from?.username || chat.username || null,
          first_name: from?.first_name || chat.first_name || null,
          last_name: from?.last_name || chat.last_name || null,
          start_payload: typeof message?.text === 'string' && message.text.startsWith('/start ') ? message.text.slice(7).trim() : null,
          last_seen_at: new Date().toISOString()
        };
        const response = await fetch(`${env.SUPABASE_URL}/rest/v1/telegram_chats?on_conflict=chat_id`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Prefer': 'resolution=merge-duplicates,return=minimal'
          },
          body: JSON.stringify(chatRow)
        });
        if (!response.ok) return json({ ok: false, error: 'Supabase Telegram link failed', details: await response.text() }, 502);

        // Optional /start payload can be used by the client to identify the registration context.
        return json({ ok: true, linked: true, chat_id: String(chat.id), username: chatRow.username });
      } catch (error) { return json({ ok: false, error: error.message }, 400); }
    }

    // Extension registration: Telegram chat_id can be supplied explicitly or resolved by username.
    if (request.method === 'POST' && url.pathname === '/api/register') {
      try {
        if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase variables are missing' }, 500);
        const body = await request.json();
        let chatId = body.telegram_chat_id ? String(body.telegram_chat_id) : null;
        if (!chatId && body.telegram) {
          const username = String(body.telegram).replace(/^@/, '');
          const lookup = await fetch(`${env.SUPABASE_URL}/rest/v1/telegram_chats?select=chat_id&username=eq.${encodeURIComponent(username)}&limit=1`, {
            headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
          });
          if (lookup.ok) {
            const rows = await lookup.json();
            chatId = rows?.[0]?.chat_id || null;
          }
        }
        if (!chatId) return json({ error: 'Telegram account is not linked. Start the Telegram bot first.' }, 400);

        const response = await fetch(`${env.SUPABASE_URL}/rest/v1/license_registrations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Prefer': 'return=representation' },
          body: JSON.stringify({ name: body.name || 'User', email: body.email || null, telegram: body.telegram || null, telegram_chat_id: chatId, device_name: body.device_name || 'Unknown Device' })
        });
        const text = await response.text();
        if (!response.ok) return json({ error: 'Supabase registration failed', details: text }, 502);
        return json({ success: true, registration: JSON.parse(text) });
      } catch (error) { return json({ error: 'Registration failed', message: error.message }, 500); }
    }

    // Supabase -> Cloudflare license notification.
    if (request.method === 'POST' && (url.pathname === '/' || url.pathname === '/api/license-notification')) {
      try {
        const expectedToken = env.ADMIN_SECRET_TOKEN ? `Bearer ${env.ADMIN_SECRET_TOKEN}` : null;
        if (!expectedToken || request.headers.get('Authorization') !== expectedToken) return json({ error: 'Unauthorized request' }, 401);
        const payload = await request.json();
        const record = payload.record || payload;
        if (!record?.telegram_chat_id) return json({ error: 'Missing telegram_chat_id' }, 400);
        if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'TELEGRAM_BOT_TOKEN is missing' }, 500);
        const esc = v => String(v ?? '').replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
        const messageText = `🆕 *New License Request Notification*\\!\n\n👤 *Name:* ${esc(record.name || 'User')}\n📧 *Email:* ${esc(record.email || 'N/A')}\n📱 *Telegram User:* ${esc(record.telegram || 'N/A')}\n💻 *Device:* ${esc(record.device_name || 'Unknown Device')}\n🆔 *Chat ID:* \\`${esc(record.telegram_chat_id)}\\`\n\n⏳ Status is pending\\. Please approve from your Admin Dashboard\\.`;
        const telegramResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: record.telegram_chat_id, text: messageText, parse_mode: 'MarkdownV2' }) });
        if (!telegramResponse.ok) return json({ error: 'Telegram API Error', details: await telegramResponse.text() }, 502);
        return json({ success: true, message: 'Notification sent to Telegram.' });
      } catch (error) { return json({ error: 'Internal Server Error', message: error.message }, 500); }
    }

    return env.ASSETS.fetch(request);
  }
};