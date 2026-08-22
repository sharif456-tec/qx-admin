/* Admin session hardening: refresh the Supabase session before protected Cloudflare actions. */
async function ensureFreshAdminSession(){
  if(!session?.refresh_token) throw Error('Admin session is missing. Please login again.');
  try{
    const r=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{
      method:'POST',
      headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({refresh_token:session.refresh_token})
    });
    const text=await r.text();
    let data={}; try{data=text.trim()?JSON.parse(text):{};}catch{data={};}
    if(!r.ok || !data.access_token) throw Error(data.error_description||data.msg||'Supabase session refresh failed. Please login again.');
    session=data;
    return session;
  }catch(e){
    session=null; isAdmin=false;
    throw e;
  }
}

async function adminFetch(path, options={}){
  await ensureFreshAdminSession();
  const headers={...(options.headers||{}),Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'};
  return fetch(path,{...options,headers});
}
