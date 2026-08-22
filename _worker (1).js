export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Handle POST requests from Supabase Webhook or Admin Panel
    if (request.method === 'POST') {
      try {
        // Security Authorization Check
        const authHeader = request.headers.get('Authorization');
        const expectedToken = env.ADMIN_SECRET_TOKEN ? `Bearer ${env.ADMIN_SECRET_TOKEN}` : null;

        if (!authHeader || authHeader !== expectedToken) {
          return new Response(JSON.stringify({ 
            error: 'Unauthorized request!', 
            debug: 'Token mismatch. Check Supabase Headers and Cloudflare Env Variables.' 
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const payload = await request.json();
        const record = payload.record || payload; 

        if (!record || !record.telegram_chat_id) {
          return new Response(JSON.stringify({ error: 'Invalid payload or missing telegram_chat_id.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // Collect database variables
        const userName = record.name || 'User';
        const userEmail = record.email || 'N/A';
        const telegramId = record.telegram || 'N/A';
        const chatId = record.telegram_chat_id;
        const deviceName = record.device_name || 'Unknown Device';

        // Escape special characters to prevent Telegram MarkdownV2 crashes
        const safeName = userName.replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
        const safeEmail = userEmail.replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
        const safeTelegram = telegramId.replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
        const safeDevice = deviceName.replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');

        // Construct Telegram Message
        const messageText = `🆕 *New License Request Notification*\\!\n\n` +
                            `👤 *Name:* ${safeName}\n` +
                            `📧 *Email:* ${safeEmail}\n` +
                            `📱 *Telegram User:* ${safeTelegram}\n` +
                            `💻 *Device:* ${safeDevice}\n` +
                            `🆔 *Chat ID:* \\`${chatId}\\`\n\n` +
                            `⏳ Status is pending\. Please approve from your Admin Dashboard\.`;

        // Check Telegram Bot Token
        if (!env.TELEGRAM_BOT_TOKEN) {
          return new Response(JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN is missing in Cloudflare variables.' }), { status: 500 });
        }

        const telegramUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

        // Call Telegram API
        const telegramResponse = await fetch(telegramUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: messageText,
            parse_mode: 'MarkdownV2'
          })
        });

        if (!telegramResponse.ok) {
          const errorText = await telegramResponse.text();
          return new Response(JSON.stringify({ error: 'Telegram API Error', details: errorText }), { status: 502 });
        }

        return new Response(JSON.stringify({ success: true, message: 'Notification sent to Telegram.' }), { 
          status: 200, 
          headers: { 'Content-Type': 'application/json' } 
        });

      } catch (error) {
        return new Response(JSON.stringify({ error: 'Internal Server Error', message: error.message }), { 
          status: 500, 
          headers: { 'Content-Type': 'application/json' } 
        });
      }
    }

    // 2. Default browser visit (GET Request) loads your original website frontend assets
    return env.ASSETS.fetch(request);
  }
};