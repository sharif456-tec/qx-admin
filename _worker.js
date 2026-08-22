const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
      if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok:true, service:'QX Cloud License Gateway' });
      if (url.pathname === '/api/register' && request.method === 'POST') return await register(request, env);
      if (url.pathname === '/api/approve-license' && request.method === 'POST') return await approveLicense(request, env);
      if (url.pathname === '/api/resend-license' && request.method === 'POST') return await resendLicense(request, env);
      if (url.pathname === '/api/telegram-webhook' && request.method === 'POST') return await telegramWebhook(request, env);
      if (url.pathname === '/api/send-license' && request.method === 'POST') return await sendLicense(request, env);
      if (url.pathname.startsWith('/api/')) return json({ok:false,error:'Not found'},404);
      return env.ASSETS.fetch(request);
    } catch(e) { return json({ok:false,error:e?.message||'Unexpected server error.'},e?.status||500,request); }
  }
};

function json(data,status=200,request=null){ return new Response(JSON.stringify(data??{}),{status,headers:request?corsHeaders(request):JSON_HEADERS}); }
function corsHeaders(request){ const origin=request.headers.get('Origin')||'*'; return {...JSON_HEADERS,'access-control-allow-origin':origin,'access-control-allow-headers':'content-type, authorization','access-control-allow-methods':'POST, OPTIONS'}; }
async function supabase(env,path,options={}){ const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'content-type':'application/json',...(options.headers||{})}; return fetch(`${env.SUPABASE_URL}${path}`,{...options,headers}); }
function httpError(message,status){const e=new Error(message);e.status=status;return e;}
async function readJson(request){const text=await request.text();if(!text.trim())throw httpError('Request body is empty.',400);try{return JSON.parse(text)}catch{throw httpError('Request body is not valid JSON.',400)}}

async function requireAdmin(request,env){
  const auth=request.headers.get('Authorization')||'';
  if(!auth.startsWith('Bearer ')) throw httpError('Missing admin authentication.',401);
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY) throw httpError('Cloudflare Supabase secrets are not configured.',500);
  // Validate the browser's access token through Supabase Auth. Use the trusted service key only as the API key; never expose it to the browser.
  const userResp=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:auth}});
  const userRaw=await userResp.text();
  let user={}; try{userRaw.trim()&&(user=JSON.parse(userRaw))}catch{}
  if(!userResp.ok||!user?.id) throw httpError(`Supabase session validation failed (${userResp.status}): ${user?.msg||user?.message||userRaw||'invalid or expired session'}`,401);
  const adminResp=await supabase(env,`/rest/v1/admin_users?select=user_id,email&user_id=eq.${encodeURIComponent(user.id)}&limit=1`);
  const adminRaw=await adminResp.text();
  let admins=[]; try{adminRaw.trim()&&(admins=JSON.parse(adminRaw))}catch{}
  if(!adminResp.ok) throw httpError(`Admin lookup failed (${adminResp.status}): ${adminRaw||'empty response'}`,500);
  if(!Array.isArray(admins)||!admins.length) throw httpError('Admin access required.',403);
  return {user,bearer:auth};
}

async function register(request,env){
 const body=await readJson(request),name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase(),telegram=String(body.telegram||'').trim(),deviceId=String(body.device_id||'').trim(),deviceName=String(body.device_name||'Kiwi/Chrome Android').trim();
 if(!name||!email||!telegram||!deviceId)return json({ok:false,error:'Name, email, Telegram and device ID are required.'},400,request);
 if(!/^\S+@\S+\.\S+$/.test(email))return json({ok:false,error:'Invalid email address.'},400,request);
 const existingResp=await supabase(env,`/rest/v1/license_registrations?select=id,status&email=eq.${encodeURIComponent(email)}&device_id=eq.${encodeURIComponent(deviceId)}&status=eq.pending&limit=1`);
 if(!existingResp.ok)throw new Error(`Supabase request lookup failed: ${await existingResp.text()}`);
 const existing=await existingResp.json();if(existing.length)return json({ok:true,status:'pending',request_id:existing[0].id},200,request);
 const insertResp=await supabase(env,'/rest/v1/license_registrations',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({name,email,telegram,device_id:deviceId,device_name:deviceName,status:'pending'})});
 if(!insertResp.ok)throw new Error(`Supabase registration save failed: ${await insertResp.text()}`);
 const rows=await insertResp.json();return json({ok:true,status:'pending',request_id:rows?.[0]?.id||null},200,request);
}

async function approveLicense(request,env){
 await requireAdmin(request,env);const body=await readJson(request),requestId=String(body.request_id||'').trim();
 if(!/^\d+$/.test(requestId))throw httpError('request_id must be a valid registration ID.',400);
 const rpc=await supabase(env,'/rest/v1/rpc/admin_approve_license_registration',{method:'POST',body:JSON.stringify({p_registration_id:Number(requestId)})});
 const raw=await rpc.text();let data={};try{raw.trim()&&(data=JSON.parse(raw))}catch{}
 if(!rpc.ok||!data?.ok)return json({ok:false,error:data?.message||data?.hint||data?.error||raw||'Supabase approval failed.'},400,request);
 const lic=data.license||{},reg=data.registration||{},chatId=String(reg.telegram_chat_id||'').trim();
 const sent=await telegramSend(env,chatId,lic);
 if(!sent.ok)return json({ok:false,error:`License activated in Supabase, but Telegram delivery failed: ${sent.error}`,license:lic,delivery_failed:true},502,request);
 await supabase(env,`/rest/v1/licenses?id=eq.${encodeURIComponent(lic.id)}`,{method:'PATCH',body:JSON.stringify({last_telegram_sent_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
 return json({ok:true,license:lic,telegram:sent},200,request);
}

async function resendLicense(request,env){await requireAdmin(request,env);const body=await readJson(request),licenseId=String(body.license_id||'').trim();if(!licenseId)throw httpError('license_id is required.',400);const r=await supabase(env,`/rest/v1/licenses?select=*&id=eq.${encodeURIComponent(licenseId)}&limit=1`);if(!r.ok)throw new Error(await r.text());const lic=(await r.json())?.[0];if(!lic)throw httpError('License not found.',404);const q=await supabase(env,`/rest/v1/license_registrations?select=*&license_id=eq.${encodeURIComponent(licenseId)}&limit=1`);if(!q.ok)throw new Error(await q.text());const req=(await q.json())?.[0];if(!req?.telegram_chat_id)throw httpError('No Telegram Chat ID is linked to this license.',400);const sent=await telegramSend(env,req.telegram_chat_id,lic);if(!sent.ok)return json({ok:false,error:sent.error},502,request);await supabase(env,`/rest/v1/licenses?id=eq.${encodeURIComponent(licenseId)}`,{method:'PATCH',body:JSON.stringify({last_telegram_sent_at:new Date().toISOString(),updated_at:new Date().toISOString()})});return json({ok:true,telegram:sent},200,request)}
async function sendLicense(request,env){await requireAdmin(request,env);const body=await readJson(request),chatId=String(body.telegram_chat_id||'').trim(),licenseKey=String(body.license_key||'').trim();if(!chatId||!licenseKey)throw httpError('telegram_chat_id and license_key are required.',400);return json(await telegramSend(env,chatId,{license_key:licenseKey,plan:body.plan,expires_at:body.expires_at,max_devices:body.max_devices}),200,request)}
async function telegramSend(env,chatId,lic){if(!env.TELEGRAM_BOT_TOKEN)return {ok:false,error:'TELEGRAM_BOT_TOKEN is not configured.'};if(!chatId)return {ok:false,error:'Applicant has no Telegram Chat ID. Ask them to start the bot first.'};const text=['✅ QX LICENSE APPROVED','',`License: ${lic.license_key||''}`,lic.plan?`Plan: ${lic.plan}`:null,lic.expires_at?`Expires: ${lic.expires_at}`:null,lic.max_devices?`Device Limit: ${lic.max_devices}`:null,'','Your QX license has been activated. Enter this key in the extension.'].filter(Boolean).join('\n');const tg=await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.TELEGRAM_BOT_TOKEN)}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text})});const raw=await tg.text();let result={};try{raw.trim()&&(result=JSON.parse(raw))}catch{}if(!tg.ok||!result.ok)return {ok:false,error:result.description||raw||'Telegram send failed.'};return {ok:true,chat_id:chatId,telegram_message_id:result.result?.message_id||null}}

async function telegramWebhook(request,env){if(!env.TELEGRAM_BOT_TOKEN||!env.SUPABASE_SERVICE_ROLE_KEY)throw httpError('Telegram/Supabase server secrets are not configured.',500);const update=await readJson(request),msg=update?.message;if(!msg?.chat?.id)return json({ok:true,ignored:true},200,request);const chatId=String(msg.chat.id),username=msg.from?.username?String(msg.from.username):null,firstName=msg.from?.first_name||null,lastName=msg.from?.last_name||null,text=String(msg.text||'').trim(),startArg=text.startsWith('/start')?text.replace(/^\/start\s*/,'').trim():'';const save=await supabase(env,'/rest/v1/telegram_chats',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({chat_id:chatId,username,first_name:firstName,last_name:lastName,start_payload:startArg||null,last_seen_at:new Date().toISOString()})});if(!save.ok)throw new Error(`Supabase telegram_chats write failed: ${await save.text()}`);if(startArg||username)await supabase(env,'/rest/v1/rpc/link_telegram_chat',{method:'POST',body:JSON.stringify({p_email:startArg||'',p_telegram_chat_id:chatId,p_username:username})});await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.TELEGRAM_BOT_TOKEN)}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text:'✅ Telegram connected. Your Chat ID has been registered. If you already submitted a license request, it is now linked to this Telegram account.'})});return json({ok:true,chat_id:chatId},200,request)}