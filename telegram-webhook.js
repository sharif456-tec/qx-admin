// Cloudflare Pages Function: Telegram webhook for automatic Chat ID registration.
// It stores every bot conversation in public.telegram_chats via Supabase REST.
// If the user sends /start <email>, it also attempts to link that chat to a pending
// license request by calling the optional RPC `admin_link_telegram_chat`.
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const update = await request.json();
    const msg = update?.message;
    if (!msg?.chat?.id) return json({ ok: true, ignored: true });

    const chatId = String(msg.chat.id);
    const text = String(msg.text || '').trim();
    const username = msg.from?.username || null;
    const firstName = msg.from?.first_name || null;
    const lastName = msg.from?.last_name || null;
    const startArg = text.startsWith('/start') ? text.replace(/^\/start\s*/, '').trim() : '';

    const supabaseUrl = env.SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    const botToken = env.TELEGRAM_BOT_TOKEN;
    if (!supabaseUrl || !serviceKey || !botToken) return json({ ok:false, error:'Missing Telegram/Supabase server secrets.' }, 500);

    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    };

    // Requires the SQL migration included in this ZIP.
    const save = await fetch(`${supabaseUrl}/rest/v1/telegram_chats`, {
      method: 'POST', headers,
      body: JSON.stringify({
        chat_id: chatId,
        username,
        first_name: firstName,
        last_name: lastName,
        start_payload: startArg || null,
        last_seen_at: new Date().toISOString()
      })
    });
    if (!save.ok) return json({ ok:false, error:`Supabase telegram_chats write failed: ${await save.text()}` }, 500);

    let reply = '✅ Telegram connected. Your Chat ID has been registered.';
    if (startArg) {
      // Optional: pass an email as /start payload to link the applicant automatically.
      const link = await fetch(`${supabaseUrl}/rest/v1/rpc/admin_link_telegram_chat`, {
        method:'POST', headers,
        body:JSON.stringify({ p_email:startArg, p_telegram_chat_id:chatId })
      });
      if (link.ok) reply = '✅ Telegram connected. Your application is now linked to this Telegram account.';
      else reply = '✅ Telegram connected. Your Chat ID is registered; your application can now be linked by email in the Admin Dashboard.';
    }

    await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
      method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({chat_id:chatId,text:reply})
    });
    return json({ ok:true, chat_id:chatId });
  } catch (e) {
    return json({ ok:false, error:e?.message || 'Unexpected error.' }, 500);
  }
}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})}
