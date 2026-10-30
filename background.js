 'use strict';
async function cacheFollowingAvatars(result) {
  if(!result?.following)return result;
  // Keep small avatar bytes locally so rendering does not depend on hotlink requests.
  let budget=2*1024*1024;
  await Promise.all(Object.values(result.following).map(async person=>{
    if(!person.avatar || budget<=0)return;
    try {
      const url=new URL(person.avatar);
      if(url.protocol!=='https:' || url.hostname!=='pbs.twimg.com')return;
      const response=await fetch(url.href,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(8000)});
      const mime=(response.headers.get('content-type')||'').split(';')[0];
      if(!response.ok || !['image/jpeg','image/png','image/webp','image/gif'].includes(mime))return;
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(!bytes.length || bytes.length>65536 || bytes.length>budget)return;
      budget-=bytes.length;
      let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
      person.avatarData=`data:${mime};base64,${btoa(binary)}`;
    } catch { /* The original URL remains available as a fallback. */ }
  }));
  return result;
}

const jobs = new Map();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['xf-load-following','xf-load-posts'].includes(message?.type) || !/^https:\/\/x\.com\//.test(sender.url || '')) return;
  const handle = message.handle;
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle || '')) { respond({error:'账号无效'}); return; }
  const posts=message.type==='xf-load-posts';
  const key=`${message.type}:${handle}`;
  const label=posts?'发帖记录':'关注列表';
  if (!jobs.has(key)) {
    const job = (async () => {
      let tab;
      try {
        tab = await chrome.tabs.create({url:posts?`https://x.com/${handle}?xf_post_source=1`:`https://x.com/${handle}/following?xf_follow_source=1`,active:false});
        return await new Promise(resolve => {
          let requested = false;
          const finish = value => { clearTimeout(deadline); chrome.tabs.onUpdated.removeListener(updated); resolve(value); };
          const request = () => {
            if (requested) return; requested = true;
            chrome.tabs.sendMessage(tab.id,{type:posts?'xf-collect-posts':'xf-collect-following',handle,expected:message.expected}).then(finish,()=>finish({error:`${label}暂时无法读取`}));
          };
          const updated = (id,info) => { if (id===tab.id && info.status==='complete') request(); };
          const deadline = setTimeout(()=>finish({error:`${label}读取超时`}),posts?135000:45000);
          chrome.tabs.onUpdated.addListener(updated);
          chrome.tabs.get(tab.id).then(current=>{if(current.status==='complete')request();},()=>finish({error:'读取页面已关闭'}));
        });
      } catch { return {error:`${label}暂时无法读取`}; }
      finally { if(tab?.id) await chrome.tabs.remove(tab.id).catch(()=>{}); }
    })();
    jobs.set(key,job);
    job.finally(()=>jobs.delete(key));
  }
  jobs.get(key).then(result=>posts?result:cacheFollowingAvatars(result)).then(respond,()=>respond({error:`${label}暂时无法读取`}));
  return true;
});

const adCacheDuration=2*60*60*1000;
let adRequest;
let adRetryAt=0;
async function loadAd(){
  try {
    const {xfAdCache}=await chrome.storage.local.get('xfAdCache');
    if(xfAdCache && Number.isFinite(xfAdCache.fetchedAt) && Date.now()>=xfAdCache.fetchedAt && Date.now()-xfAdCache.fetchedAt<adCacheDuration)return xfAdCache.ad;
  } catch { /* Fetch normally if local storage is unavailable. */ }
  if(Date.now()<adRetryAt)return {enabled:false};
  try {
    const response=await fetch('https://aiheadshotnow.com/api/xflomo/ad?source=xflomo',{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error();
    const body=await response.text();if(body.length>10000)throw Error();
    const value=JSON.parse(body);
    let ad={enabled:false};
    if(value.enabled===true){
      const url=new URL(value.url);
      if(url.protocol!=='https:' || url.username || url.password || typeof value.text!=='string' || !value.text.trim() || value.text.length>120 || typeof value.badge!=='string' || !value.badge.trim() || value.badge.length>12)throw Error();
      ad={enabled:true,badge:value.badge,text:value.text,url:url.href};
    }
    const fetchedAt=Date.now();
    await chrome.storage.local.set({xfAdCache:{ad,fetchedAt}}).catch(()=>{});
    adRetryAt=0;
    return ad;
  } catch {
    adRetryAt=Date.now()+60000;
    return {enabled:false};
  }
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='xf-load-ad' || !/^https:\/\/x\.com\//.test(sender.url||''))return;
  if(!adRequest)adRequest=loadAd().finally(()=>{adRequest=null;});
  adRequest.then(respond);return true;
});
