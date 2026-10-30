(() => {
  'use strict';
  function page(body,handle,cutoff){
    if(body?.errors?.length)throw Error('X 暂时无法返回发帖记录');
    const user=body?.data?.user?.result;
    const instructions=user?.timeline?.timeline?.instructions || user?.timeline_v2?.timeline?.instructions;
    if(!Array.isArray(instructions))throw Error('发帖记录格式暂不支持');
    const posts={};let cursor='',items=0,reached=false;
    function visit(value,pinned=false){
      if(!value || typeof value!=='object')return;
      pinned ||= value.type==='TimelinePinEntry';
      if(value.cursorType==='Bottom' && typeof value.value==='string')cursor=value.value;
      // Read timeline items only; never count a tweet nested inside a quote/repost.
      if(value.itemType==='TimelineTombstone'){items++;return;}
      if(value.tweet_results){
        items++;
        const tweet=value.tweet_results.result?.tweet || value.tweet_results.result;
        const author=tweet?.core?.user_results?.result;
        const who=author?.core?.screen_name || author?.legacy?.screen_name;
        const legacy=tweet?.legacy;
        const id=tweet?.rest_id || legacy?.id_str;
        const date=Date.parse(legacy?.created_at);
        if(who?.toLowerCase()===handle.toLowerCase() && /^\d+$/.test(id||'') && Number.isFinite(date) && !legacy?.retweeted_status_result){
          posts[id]=new Date(date).toISOString();
          if(!pinned && date<cutoff)reached=true;
        }
        return;
      }
      for(const child of Object.values(value))if(child && typeof child==='object')visit(child,pinned);
    }
    visit(instructions);
    return {posts,cursor,complete:reached || items===0 || !cursor};
  }
  globalThis.__xfHistoryCore={page};
})();
