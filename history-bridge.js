(() => {
  'use strict';
  if(window.__xfHistoryBridge || !new URL(location.href).searchParams.has('xf_post_source'))return;
  window.__xfHistoryBridge=true;
  let template,active=false;
  const matches=url=>/\/(?:UserOriginalsTimeline|UserTweets)$/.test(new URL(url,location.origin).pathname);
  const originalFetch=window.fetch;
  const open=XMLHttpRequest.prototype.open,header=XMLHttpRequest.prototype.setRequestHeader,send=XMLHttpRequest.prototype.send;
  const requests=new WeakMap();
  XMLHttpRequest.prototype.open=function(method,url,...args){requests.set(this,{method,url:String(url),headers:{}});return open.call(this,method,url,...args);};
  XMLHttpRequest.prototype.setRequestHeader=function(key,value){const request=requests.get(this);if(request)request.headers[key]=value;return header.call(this,key,value);};
  XMLHttpRequest.prototype.send=function(...args){
    const request=requests.get(this);
    if(request && matches(request.url))this.addEventListener('load',()=>{
      if(this.status<200 || this.status>=300)return;
      try{template={...request,body:this.responseType==='json'?this.response:JSON.parse(this.responseText)};}catch{}
    },{once:true});
    return send.apply(this,args);
  };
  window.fetch=function(...args){
    const result=originalFetch.apply(this,args),url=String(args[0]?.url||args[0]);
    if(matches(url))result.then(async response=>{
      if(!response.ok)return;
      const headers=Object.fromEntries(new Headers(args[1]?.headers || args[0]?.headers || {}).entries());
      template={url,headers,method:'GET',body:await response.clone().json()};
    }).catch(()=>{});
    return result;
  };
  window.addEventListener('message',async event=>{
    if(event.source!==window || event.origin!==location.origin || event.data?.type!=='xf-history-request' || active)return;
    const {handle,id}=event.data;
    if(!/^[A-Za-z0-9_]{1,15}$/.test(handle||'') || location.pathname.toLowerCase()!==`/${handle}`.toLowerCase())return;
    active=true;const posts={},cutoff=new Date();cutoff.setMonth(cutoff.getMonth()-4);
    const started=Date.now();let complete=false,error='';
    try{
      while(!template && Date.now()-started<20000)await new Promise(resolve=>setTimeout(resolve,250));
      if(!template)throw Error('个人主页未返回发帖记录');
      const request=template;let body=request.body;const cursors=new Set();
      for(let round=0;round<100 && Date.now()-started<110000;round++){
        const result=globalThis.__xfHistoryCore.page(body,handle,+cutoff);Object.assign(posts,result.posts);
        window.postMessage({type:'xf-history-progress',id,posts},location.origin);
        if(result.complete){complete=true;break;}
        if(cursors.has(result.cursor))throw Error('历史记录分页未继续');
        cursors.add(result.cursor);
        const url=new URL(request.url,location.origin),variables=JSON.parse(url.searchParams.get('variables'));
        variables.cursor=result.cursor;url.searchParams.set('variables',JSON.stringify(variables));
        const response=await originalFetch.call(window,url.href,{method:'GET',headers:request.headers,credentials:'include',signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw Error('X 暂时限制了历史记录读取');
        body=await response.json();
        await new Promise(resolve=>setTimeout(resolve,350));
      }
    }catch(failure){error=failure.message;}
    finally{active=false;window.postMessage({type:'xf-history-result',id,posts,complete,error},location.origin);}
  });
})();
