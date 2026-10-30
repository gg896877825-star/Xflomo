(() => {
  'use strict';
  if(globalThis.__xfAdSlot)return;
  globalThis.__xfAdSlot=true;
  if(/[?&]xf_(?:post|follow)_source=/.test(location.search))return;
  const hideDuration=72*60*60*1000;
  let ad=null,enabled=true,hiddenUntil=0,hideTimer;
  let skinEnabled=document.documentElement.classList.contains('xf-on');
  const clear=()=>{const visible=document.documentElement.classList.contains('xf-ad-visible');document.querySelector('#xf-ad-slot')?.remove();document.documentElement.classList.remove('xf-ad-visible');if(visible)globalThis.__xfSkin?.refresh();};
  // X mounts its portal asynchronously; keep the ad beside it, below #layers.
  function syncAdHost(){
    const bar=document.querySelector('#xf-ad-slot');
    const host=document.querySelector('#layers')?.parentElement;
    if(bar && host && bar.parentElement!==host)host.append(bar);
  }
  new MutationObserver(syncAdHost).observe(document.documentElement,{childList:true,subtree:true});
  function render(){
    clear();
    clearTimeout(hideTimer);
    const remaining=hiddenUntil-Date.now();
    if(remaining>0){hideTimer=setTimeout(refresh,remaining);return;}
    if(!enabled || !ad?.enabled || innerWidth<=760 || !document.body || !document.documentElement.classList.contains('xf-on'))return;
    const bar=document.createElement('aside');bar.id='xf-ad-slot';bar.dataset.xfOwned='true';bar.setAttribute('aria-label','Xflomo 广告');
    const content=document.createElement('div');content.className='xf-ad-content';
    const badge=document.createElement('span');badge.className='xf-ad-badge';badge.textContent=ad.badge;
    const message=document.createElement('span');message.className='xf-ad-message';message.textContent=ad.text;message.title=ad.text;
    const link=document.createElement('a');link.className='xf-ad-cta';link.href=ad.url;link.target='_blank';link.rel='sponsored noopener noreferrer';link.textContent='立即查看';
    const arrow=document.createElement('span');arrow.className='xf-ad-arrow';arrow.setAttribute('aria-hidden','true');arrow.textContent='→';link.append(arrow);
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','关闭 Xflomo 广告');close.title='关闭广告，72小时内不再展示';close.addEventListener('click',()=>{hiddenUntil=Date.now()+hideDuration;chrome.storage.local.set({xfAdsHiddenUntil:hiddenUntil,xfAdsHidden:false}).catch(()=>{});render();});
    content.append(badge,message,link);bar.append(content,close);(document.querySelector('#layers')?.parentElement || document.querySelector('#react-root') || document.body).append(bar);document.documentElement.classList.add('xf-ad-visible');globalThis.__xfSkin?.refresh();
  }
  async function refresh(){if(hiddenUntil>Date.now()){render();return;}try{ad=await chrome.runtime.sendMessage({type:'xf-load-ad'});}catch{ad=null;}render();}
  chrome.storage.local.get({enabled:true,xfAdsHidden:false,xfAdsHiddenUntil:0}).then(value=>{
    enabled=value.enabled;
    hiddenUntil=Number.isFinite(value.xfAdsHiddenUntil)?value.xfAdsHiddenUntil:0;
    if(value.xfAdsHidden && !hiddenUntil){hiddenUntil=Date.now()+hideDuration;chrome.storage.local.set({xfAdsHiddenUntil:hiddenUntil,xfAdsHidden:false}).catch(()=>{});}
    refresh();
  });
  chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.enabled)enabled=changes.enabled.newValue;if(changes.xfAdsHiddenUntil)hiddenUntil=Number.isFinite(changes.xfAdsHiddenUntil.newValue)?changes.xfAdsHiddenUntil.newValue:0;render();});
  new MutationObserver(()=>{const next=document.documentElement.classList.contains('xf-on');if(next===skinEnabled)return;skinEnabled=next;render();}).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',render);
})();
