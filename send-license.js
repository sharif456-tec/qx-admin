export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return json({ ok:false, error:'Missing admin authentication.' }, 401);

    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    const botToken = env.TELEGRAM_BOT_TOKEN;
    if (!supabaseUrl || !supabaseKey) return json({ ok:false, error:'Supabase server configuration is missing.' }, 500);
    if (!botToken) return json({ ok:false, error:'TELEGRAM_BOT_TOKEN is not configured in Cloudflare.' }, 500);

    // Validate the logged-in Supabase session before allowing a Telegram send.
    const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseKey, Authorization: auth }
    });
    if (!userResp.ok) return json({ ok:false, error:'Supabase session is invalid or expired.' }, 401);
    const user = await userResp.json();

    const body = await request.json();
    const chatId = String(body.telegram_chat_id || '').trim();
    const licenseKey = String(body.license_key || '').trim();
    if (!chatId || !licenseKey) return json({ ok:false, error:'telegram_chat_id and license_key are required.' }, 400);

    const text = [
      '✅ LICENSE APPROVED',
      '',
      `License: ${licenseKey}`,
      body.plan ? `Plan: ${body.plan}` : null,
      body.expires_at ? `Expires: ${body.expires_at}` : null,
      body.max_devices ? `Device Limit: ${body.max_devices}` : null,
      '',
      'Your QX license has been activated.'
    ].filter(Boolean).join('\n');

    const tg = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    const result = await tg.json();
    if (!tg.ok || !result.ok) return json({ ok:false, error: result.description || 'Telegram send failed.' }, 502);

    return json({ ok:true, sent_to: chatId, admin_user: user.email || user.id, telegram_message_id: result.result?.message_id || null });
  } catch (e) {
    return json({ ok:false, error:e?.message || 'Unexpected server error.' }, 500);
  }
}

function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
