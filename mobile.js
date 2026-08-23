/* QX Admin mobile shell — UI only. Existing business/API functions are untouched. */
(function(){
  function init(){
    const app=document.getElementById('appScreen');
    const side=document.querySelector('.side');
    const main=document.querySelector('.main');
    if(!app||!side||!main)return;
    if(document.getElementById('qxMobileBtn'))return;
    const style=document.createElement('style');
    style.textContent=`
      #qxMobileBtn{display:none;position:fixed;top:12px;left:12px;z-index:120;width:44px;height:44px;border:1px solid #245a7b;border-radius:12px;background:#0b2034;color:#fff;font-size:22px;box-shadow:0 8px 25px #0008}
      #qxMobileShade{display:none;position:fixed;inset:0;background:#0009;z-index:105}
      #qxMobileNav{display:none}
      @media(max-width:799px){
        #qxMobileBtn{display:block}.side{position:fixed!important;left:0;top:0;bottom:0;width:280px!important;height:100vh!important;transform:translateX(-105%);transition:transform .25s ease;z-index:110;overflow:auto;border-right:1px solid #245a7b!important;border-bottom:0!important;padding:18px!important}
        body.qx-menu-open .side{transform:translateX(0)}body.qx-menu-open #qxMobileShade{display:block}
        .main{padding:70px 12px 82px!important}.top{gap:8px}.top h1{font-size:24px}.badge{font-size:10px}
        .grid{grid-template-columns:1fr 1fr!important;gap:8px!important}.card{padding:12px!important}.value{font-size:22px!important}
        .panel{padding:12px!important;margin-top:10px!important}.actions .btn,.btn{min-height:42px}.tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
        .modal{align-items:end!important;padding:0!important}.modal>div{width:100%!important;max-height:88vh!important;border-radius:20px 20px 0 0!important;padding:18px!important}
        #qxMobileNav{display:flex;position:fixed;left:8px;right:8px;bottom:8px;height:60px;z-index:100;background:#071a2bf5;border:1px solid #245a7b;border-radius:18px;box-shadow:0 10px 35px #000b;align-items:center;justify-content:space-around;gap:4px;padding:5px}
        #qxMobileNav button{flex:1;border:0;background:transparent;color:#dff7ff;border-radius:12px;font-size:11px;font-weight:800;min-height:48px}.qx-active{background:#123b60!important;color:#4ddcff!important}
      }
    `;
    document.head.appendChild(style);
    const btn=document.createElement('button');btn.id='qxMobileBtn';btn.type='button';btn.textContent='☰';btn.setAttribute('aria-label','Open menu');
    const shade=document.createElement('div');shade.id='qxMobileShade';
    document.body.append(btn,shade);
    btn.onclick=()=>document.body.classList.toggle('qx-menu-open');
    shade.onclick=()=>document.body.classList.remove('qx-menu-open');
    const nav=document.createElement('nav');nav.id='qxMobileNav';
    const items=[['overview','⌂','Home'],['requests','📥','Requests'],['licenses','🔑','Licenses'],['devices','📱','Devices'],['telegram','✈','Telegram']];
    items.forEach(([v,icon,label])=>{const b=document.createElement('button');b.type='button';b.innerHTML=`<div>${icon}</div><span>${label}</span>`;b.onclick=()=>{document.body.classList.remove('qx-menu-open');if(typeof window.load==='function')window.load(v)};nav.appendChild(b)});
    document.body.appendChild(nav);
    document.querySelectorAll('.side .nav .btn').forEach(b=>b.addEventListener('click',()=>document.body.classList.remove('qx-menu-open')));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
