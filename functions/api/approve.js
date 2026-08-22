// functions/index.js
export async function onRequest(context) {
  const { request, env } = context;

  // শুধুমাত্র POST রিকোয়েস্ট এক্সেপ্ট করবে (সুপাবেজ ওয়েবহুক বা অ্যাডমিন প্যানেল থেকে আসা)
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed. Please use POST.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // ১. সিকিউরিটি টোকেন যাচাই (Authorization Check)
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || authHeader !== `Bearer ${env.ADMIN_SECRET_TOKEN}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized request! Secret token mismatch.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ২. ইনকামিং পেলোড রিড করা
    const payload = await request.json();
    
    // সুপাবেজ ওয়েবহুক থেকে আসলে ডাটা payload.record এ থাকে, অ্যাডমিন প্যানেল থেকে ডিরেক্ট আসলে মূল অবজেক্টে থাকে
    const record = payload.record || payload; 

    if (!record) {
      return new Response(JSON.stringify({ error: 'Invalid payload. No record found.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ৩. ডাটাবেজের ভ্যারিয়েবলগুলো সংগ্রহ করা
    const userName = record.name || 'User';
    const userEmail = record.email || 'N/A';
    const telegramId = record.telegram || 'N/A';
    const chatId = record.telegram_chat_id;
    const deviceName = record.device_name || 'Unknown Device';

    if (!chatId) {
      return new Response(JSON.stringify({ error: 'Missing telegram_chat_id in request.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ৪. টেলিগ্রাম বটের মেসেজ ফরম্যাট সাজানো
    const messageText = `🆕 *New License Request Notification*\!\n\n` +
                        `👤 *Name:* ${userName.replace(/[_*\[\]()~`>#+-=|{}.!]/g, '\\$&')}\n` +
                        `📧 *Email:* ${userEmail.replace(/[_*\[\]()~`>#+-=|{}.!]/g, '\\$&')}\n` +
                        `📱 *Telegram User:* ${telegramId.replace(/[_*\[\]()~`>#+-=|{}.!]/g, '\\$&')}\n` +
                        `💻 *Device:* ${deviceName.replace(/[_*\[\]()~`>#+-=|{}.!]/g, '\\$&')}\n` +
                        `🆔 *Chat ID:* \`${chatId}\`\n\n` +
                        `⏳ Status is pending. Please approve from your Admin Dashboard.`;

    const telegramUrl = `https://api.telegram.org/bot\${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

    // ৫. টেলিগ্রাম এপিআই কল করা
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
      const telError = await telegramResponse.text();
      return new Response(JSON.stringify({ error: 'Telegram Bot API error', details: telError }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true, message: 'Request received and sent to Telegram.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
