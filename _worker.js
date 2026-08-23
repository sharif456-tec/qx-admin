const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true, service: 'QX Cloud License Gateway' });
      if (url.pathname === '/api/telegram-status' && request.method === 'GET') return await telegramStatus(env);
      if (url.pathname === '/api/register' && request.method === 'POST') return await register(request, env);
      if (url.pathname === '/api/approve-license' && request.method === 'POST') return await approveLicense(request, env);
      if (url.pathname === '/api/resend-license' && request.method === 'POST') return await resendLicense(request, env);
      if (url.pathname === '/api/telegram-webhook' && request.method === 'POST') return await telegramWebhook(request, env);
      if (url.pathname === '/api/send-license' && request.method === 'POST') return await sendLicense(request, env);
      if (url.pathname.startsWith('/api/')) return json({ ok:false, error:'Not found' }, 404);
      return env.ASSETS.fetch(request);
    } catch (e) { return json({ ok:false, error:e?.message || 'Unexpected server error.' }, e?.status || 500); }
  }
};

function json(data, status=200) { return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS }); }
function corsHeaders(request) { const origin = request.headers.get('Origin') || '*'; return { ...JSON_HEADERS, 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'POST, OPTIONS' }; }
function httpError(message, status) { const e = new Error(message); e.status = status; return e; }

async function supabase(requestUrl, env, path, options={}) {
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...(options.headers || {}) };
  return fetch(`${env.SUPABASE_URL}${path}`, { ...options, headers });
}

async function telegramStatus(env) {
  const result = { ok: true, telegram_token_configured: !!env.TELEGRAM_BOT_TOKEN, webhook_url: null, webhook_status: 'unknown', last_update: null, last_chat_id: null, last_username: null, telegram_api_error: null, supabase_status: 'unknown' };
  if (!env.TELEGRAM_BOT_TOKEN) { result.ok = false; result.webhook_status = 'token_missing'; return json(result, 500); }

  const meResp = await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.TELEGRAM_BOT_TOKEN)}/getMe`);
  const me = await meResp.json().catch(() => ({}));
  if (!meResp.ok || !me.ok) { result.ok = false; result.webhook_status = 'token_invalid'; result.telegram_api_error = me.description || 'Telegram getMe failed'; return json(result, 502); }
  result.bot = { id: me.result.id, username: me.result.username, first_name: me.result.first_name };

  const whResp = await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.TELEGRAM_BOT_TOKEN)}/getWebhookInfo`);
  const wh = await whResp.json().catch(() => ({}));
  if (!whResp.ok || !wh.ok) { result.ok = false; result.webhook_status = 'webhook_info_error'; result.telegram_api_error = wh.description || 'Telegram getWebhookInfo failed'; return json(result, 502); }
  result.webhook_url = wh.result?.url || null;
  result.webhook_status = result.webhook_url === 'https://qx-admin.pages.dev/api/telegram-webhook' ? 'configured' : (result.webhook_url ? 'wrong_url' : 'not_configured');
  result.last_update = wh.result?.last_error_date ? new Date(wh.result.last_error_date * 1000).toISOString() : null;
  result.telegram_webhook_last_error = wh.result?.last_error_message || null;
  result.pending_update_count = wh.result?.pending_update_count ?? null;

  try {
    const sb = await supabase(null, env, '/rest/v1/telegram_chats?select=chat_id,username,last_seen_at&order=last_seen_at.desc&limit=1');
    if (sb.ok) {
      const rows = await sb.json();
      result.supabase_status = 'connected';
      if (rows?.[0]) { result.last_chat_id = String(rows[0].chat_id); result.last_username = rows[0].username || null; result.last_update = rows[0].last_seen_at || result.last_update; }
    } else { result.supabase_status = 'error'; result.supabase_error = await sb.text(); }
  } catch (e) { result.supabase_status = 'error'; result.supabase_error = e?.message || String(e); }

  return json(result);
}

async function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) throw httpError('Missing admin authentication.', 401);
  const userResp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth } });
  if (!userResp.ok) throw httpError('Supabase session is invalid or expired.', 401);
  const user = await userResp.json();
  const adminResp = await supabase(request, env, `/rest/v1/admin_users?select=user_id,email&user_id=eq.${encodeURIComponent(user.id)}&limit=1`);
  if (!adminResp.ok) throw httpError('Unable to verify admin account.', 500);
  const admins = await adminResp.json();
  if (!Array.isArray(admins) || !admins.length) throw httpError('Admin access required.', 403);
  return { user, bearer: auth };
}

async function register(request, env) {
  const body = await request.json(); const name = String(body.name || '').trim(); const email = String(body.email || '').trim().toLowerCase(); const telegram = String(body.telegram || '').trim(); const deviceId = String(body.device_id || '').trim(); const deviceName = String(body.device_name || 'Kiwi/Chrome Android').trim();
  if (!name || !email || !telegram || !deviceId) return new Response(JSON.stringify({ok:false,error:'Name, email, Telegram and device ID are required.'}), {status:400,headers:corsHeaders(request)});
  if (!/^\S+@\S+\.\S+$/.test(email)) return new Response(JSON.stringify({ok:false,error:'Invalid email address.'}), {status:400,headers:corsHeaders(request)});
  const existingResp = await supabase(request, env, `/rest/v1/license_registrations?select=id,status&email=eq.${encodeURIComponent(email)}&device_id=eq.${encodeURIComponent(deviceId)}&status=eq.pending&limit=1`); if (!existingResp.ok) throw new Error(`Supabase request lookup failed: ${await existingResp.text()}`); const existing = await existingResp.json(); if (existing.length) return new Response(JSON.stringify({ok:true,status:'pending',request_id:existing[0].id}), {headers:corsHeaders(request)});
  let telegramChatId = null; const telegramUsername = telegram.replace(/^@/, '').trim().toLowerCase(); if (telegramUsername) { const tgLookup = await supabase(request, env, `/rest/v1/telegram_chats?select=chat_id,username&username=ilike.${encodeURIComponent(telegramUsername)}&limit=1`); if (tgLookup.ok) { const tgRows = await tgLookup.json(); telegramChatId = tgRows?.[0]?.chat_id ? String(tgRows[0].chat_id) : null; } }
  const insertResp = await supabase(request, env, '/rest/v1/license_registrations', {method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({name,email,telegram,telegram_chat_id:telegramChatId,device_id:deviceId,device_name:deviceName,status:'pending'})}); if (!insertResp.ok) throw new Error(`Supabase registration save failed: ${await insertResp.text()}`); const rows = await insertResp.json(); return new Response(JSON.stringify({ok:true,status:'pending',request_id:rows?.[0]?.id || null,telegram_linked:!!telegramChatId}), {headers:corsHeaders(request)});
}

async function approveLicense(request, env) {
  const { bearer } = await requireAdmin(request, env); const body = await request.json(); const requestId = String(body.request_id || '').trim(); if (!requestId) throw httpError('request_id is required.', 400);
  const rpc = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/admin_approve_license`, {method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY, Authorization:bearer, 'content-type':'application/json'},body:JSON.stringify({p_registration_id:Number(requestId)})}); const data = await rpc.json().catch(()=>({})); if (!rpc.ok || !data?.ok) return json({ok:false,error:data?.message||data?.hint||data?.error||'Supabase approval failed.'}, 400);
  const lic = data.license || {}; const req = data.registration || data.request || {}; const sent = await telegramSend(env, String(req.telegram_chat_id || '').trim(), lic); if (!sent.ok) return json({ok:false,error:`License activated in Supabase, but Telegram delivery failed: ${sent.error}`,license:lic,delivery_failed:true}, 502);
  await supabase(request, env, `/rest/v1/licenses?id=eq.${encodeURIComponent(lic.id)}`, {method:'PATCH',body:JSON.stringify({last_telegram_sent_at:new Date().toISOString(),updated_at:new Date().toISOString()})}); return json({ok:true,license:lic,telegram:sent});
}

async function resendLicense(request, env) { await requireAdmin(request, env); const body = await request.json(); const licenseId = String(body.license_id || '').trim(); if (!licenseId) throw httpError('license_id is required.', 400); const r = await supabase(request, env, `/rest/v1/licenses?select=*&id=eq.${encodeURIComponent(licenseId)}&limit=1`); if (!r.ok) throw new Error(await r.text()); const rows = await r.json(); const lic = rows?.[0]; if (!lic) throw httpError('License not found.', 404); const q = await supabase(request, env, `/rest/v1/license_registrations?select=*&license_id=eq.${encodeURIComponent(licenseId)}&limit=1`); if (!q.ok) throw new Error(await q.text()); const req = (await q.json())?.[0]; if (!req?.telegram_chat_id) throw httpError('No Telegram Chat ID is linked to this license.', 400); const sent = await telegramSend(env, req.telegram_chat_id, lic); if (!sent.ok) return json({ok:false,error:sent.error},502); await supabase(request, env, `/rest/v1/licenses?id=eq.${encodeURIComponent(licenseId)}`, {method:'PATCH',body:JSON.stringify({last_telegram_sent_at:new Date().toISOString(),updated_at:new Date().toISOString()})}); return json({ok:true,telegram:sent}); }
async function sendLicense(request, env) { await requireAdmin(request, env); const body = await request.json(); const chatId = String(body.telegram_chat_id || '').trim(); const licenseKey = String(body.license_key || '').trim(); if (!chatId || !licenseKey) throw httpError('telegram_chat_id and license_key are required.', 400); return json(await telegramSend(env, chatId, {license_key:licenseKey, plan:body.plan, expires_at:body.expires_at, max_devices:body.max_devices})); }
async function telegramSend(env, chatId, lic) { if (!env.TELEGRAM_BOT_TOKEN) return {ok:false,error:'TELEGRAM_BOT_TOKEN is not configured.'}; if (!chatId) return {ok:false,error:'Applicant has no Telegram Chat ID. Ask them to start the bot first.'}; const text=['✅ QX LICENSE APPROVED','',`License: ${lic.license_key || ''}`,lic.plan ? `Plan: ${lic.plan}` : null,lic.expires_at ? `Expires: ${lic.expires_at}` : null,lic.max_devices ? `Device Limit: ${lic.max_devices}` : null,'','Your QX license has been activated. Enter this key in the extension.'].filter(Boolean).join('\n'); const tg=await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.TELEGRAM_BOT_TOKEN)}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text})}); const result=await tg.json().catch(()=>({})); if(!tg.ok||!result.ok)return{ok:false,error:result.description||'Telegram send failed.'}; return{ok:true,chat_id:chatId,telegram_message_id:result.result?.message_id||null}; }

async function telegramWebhook(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.SUPABASE_SERVICE_ROLE_KEY) throw httpError('Telegram/Supabase server secrets are not configured.', 500);
  const update=await request.json(); const msg=update?.message; if(!msg?.chat?.id)return json({ok:true,ignored:true}); const chatId=String(msg.chat.id); const username=msg.from?.username?String(msg.from.username):null; const firstName=msg.from?.first_name||null; const lastName=msg.from?.last_name||null; const text=String(msg.text||'').trim(); const startArg=text.startsWith('/start')?text.replace(/^\/start\s*/,'').trim():'';
  const save=await supabase(request,env,'/rest/v1/telegram_chats',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({chat_id:chatId,username,first_name:firstName,last_name:lastName,start_payload:startArg||null,last_seen_at:new Date().toISOString()})}); if(!save.ok)throw new Error(`Supabase telegram_chats write failed: ${await save.text()}`);
  if(startArg||username){ await supabase(request,env,'/rest/v1/rpc/link_telegram_chat',{method:'POST',body:JSON.stringify({p_email:startArg||'',p_telegram_chat_id:chatId,p_username:username})}); if(username){ await supabase(request,env,`/rest/v1/license_registrations?telegram=ilike.${encodeURIComponent('@'+username)}&status=eq.pending`,{method:'PATCH',body:JSON.stringify({telegram_chat_id:chatId,updated_at:new Date().toISOString()})}); await supabase(request,env,`/rest/v1/license_registrations?telegram=ilike.${encodeURIComponent(username)}&status=eq.pending`,{method:'PATCH',body:JSON.stringify({telegram_chat_id:chatId,updated_at:new Date().toISOString()})}); } }
  const reply='✅ Telegram connected. Your Chat ID has been registered. If you already submitted a license request, it is now linked to this Telegram account.'; await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.TELEGRAM_BOT_TOKEN)}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text:reply})}); return json({ok:true,chat_id:chatId});
}
