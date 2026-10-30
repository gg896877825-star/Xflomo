(() => {
  'use strict';
  if(window.__xfAvatarBridge)return;
  window.__xfAvatarBridge=true;
  const users={};
  const profiles={};
  const handlesById=new Map();
  const confirmedAt=new Map();
  function scan(value,startedAt=Date.now()) {
    if(!value || typeof value!=='object')return;
    const id=String(value.rest_id || value.id_str || '');
    const handle=value.core?.screen_name || value.legacy?.screen_name || value.screen_name || handlesById.get(id);
    if(id && handle)handlesById.set(id,handle);
    const avatar=value.avatar?.image_url || value.legacy?.profile_image_url_https || value.profile_image_url_https;
    if(/^[A-Za-z0-9_]{1,15}$/.test(handle||'') && /^https:\/\/pbs\.twimg\.com\//.test(avatar||''))users[handle.toLowerCase()]=avatar;
    if(/^[A-Za-z0-9_]{1,15}$/.test(handle||'')){
      const legacy=value.legacy || value;
      const profile=profiles[handle.toLowerCase()] ||= {};
      const bio=value.profile_bio?.description ?? legacy.description;
      const followers=value.relationship_counts?.followers ?? legacy.followers_count;
      const following=value.relationship_perspectives?.following ?? legacy.following;
      if(typeof bio==='string')profile.bio=bio.slice(0,2000);
      if(Number.isSafeInteger(followers) && followers>=0)profile.followers=followers;
      if(typeof following==='boolean' && startedAt>=(confirmedAt.get(handle.toLowerCase())||0))profile.following=following;
    }
    for(const child of Object.values(value))if(child && typeof child==='object')scan(child,startedAt);
  }
  function publish(){window.postMessage({type:'xf-avatar-records',users,profiles},location.origin);}
  function consume(body,startedAt){try{scan(typeof body==='string'?JSON.parse(body):body,startedAt);publish();}catch{}}
  const originalFetch=window.fetch;
  window.fetch=function(...args){const startedAt=Date.now();const result=originalFetch.apply(this,args);const url=String(args[0]?.url||args[0]);if((url.includes('/graphql/') || url.includes('/friendships/')))result.then(r=>r.clone().json().then(body=>consume(body,startedAt)).catch(()=>{})).catch(()=>{});return result;};
  const send=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send=function(...args){const startedAt=Date.now();this.addEventListener('load',()=>{if((this.responseURL?.includes('/graphql/') || this.responseURL?.includes('/friendships/'))){try{consume(this.responseType==='json'?this.response:this.responseText,startedAt);}catch{}}},{once:true});return send.apply(this,args);};
  window.addEventListener('message',event=>{
    if(event.source!==window || event.origin!==location.origin)return;
    if(event.data?.type==='xf-request-avatar-records')publish();
    if(event.data?.type==='xf-confirm-follow' && typeof event.data.handle==='string'){
      const handle=event.data.handle.toLowerCase();
      if(!profiles[handle])return;
      confirmedAt.set(handle,Date.now());profiles[handle].following=true;publish();
    }
  });
})();
