(() => {
  'use strict';
  if(globalThis.__xfAuthorCards)return;
  globalThis.__xfAuthorCards=true;
  const profiles=new Map();
  let scheduled=false, pending=null;
  const own=(article,selector)=>[...article.querySelectorAll(selector)].find(node=>node.closest('article')===article && !node.closest('[data-testid="quoteTweet"]'));
  const handleOf=name=>{
    const link=[...name.querySelectorAll('a[href]')].find(a=>/^\/[A-Za-z0-9_]{1,15}$/.test(new URL(a.href,location.origin).pathname));
    return link?new URL(link.href,location.origin).pathname.slice(1).toLowerCase():'';
  };
  const count=value=>value>=1e8?`${+(value/1e8).toFixed(1)}亿`:value>=1e4?`${+(value/1e4).toFixed(1)}万`:value.toLocaleString('zh-CN');
  function render(){
    scheduled=false;
    if(!document.documentElement.classList.contains('xf-on'))return;
    for(const article of document.querySelectorAll('article[data-testid="tweet"]')){
      const name=own(article,'[data-testid="User-Name"]');if(!name)continue;
      const handle=handleOf(name), profile=profiles.get(handle);
      const row=name.parentElement;if(!row)continue;
      const caret=own(article,'[data-testid="caret"]');
      let header=row;
      while(header.parentElement && header!==article && caret && !header.contains(caret))header=header.parentElement;
      if(header===article || !caret)continue;
      if(!header.classList.contains('xf-author-header'))header.classList.add('xf-author-header');
      // Insert before the entire native right-hand region, including labels and
      // subscription controls, rather than estimating an offset from the caret.
      let nameColumn=name;
      while(nameColumn.parentElement!==header)nameColumn=nameColumn.parentElement;
      if(!nameColumn.classList.contains('xf-author-name-column'))nameColumn.classList.add('xf-author-name-column');
      const children=[...header.children];
      const native=children.slice(children.indexOf(nameColumn)+1).filter(node=>!node.classList.contains('xf-author-actions'));
      const controls=native[0];if(!controls)continue;
      for(const node of native)if(!node.classList.contains('xf-native-actions'))node.classList.add('xf-native-actions');
      let actions=header.querySelector(':scope > .xf-author-actions');
      if(actions && actions.dataset.handle!==handle){actions.remove();actions=null;}
      let details=row.querySelector(':scope > .xf-author-details');
      if(details && details.dataset.handle!==handle){details.remove();details=null;row.classList.remove('xf-author-row');}
      if(!profile)continue;
      if(!details){
        details=document.createElement('div');details.className='xf-author-details';details.dataset.handle=handle;details.dataset.xfOwned='true';
        const bio=document.createElement('div');bio.className='xf-author-bio';
        details.append(bio);row.append(details);row.classList.add('xf-author-row');
      }
      if(!actions){
        actions=document.createElement('div');actions.className='xf-author-actions';actions.dataset.handle=handle;actions.dataset.xfOwned='true';
        const followers=document.createElement('span');followers.className='xf-author-followers';
        const button=document.createElement('button');button.type='button';button.className='xf-author-follow';
        button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();follow(article,handle,button);});
        actions.append(followers,button);header.insertBefore(actions,controls);
      }
      const bio=details.querySelector('.xf-author-bio');
      if(bio.textContent!==(profile.bio||''))bio.textContent=profile.bio||'';
      bio.title=profile.bio||'';bio.hidden=!profile.bio;
      const followers=actions.querySelector('.xf-author-followers');
      const label=Number.isSafeInteger(profile.followers)?`${count(profile.followers)} 粉丝`:'';
      if(followers.textContent!==label)followers.textContent=label;
      followers.title=Number.isSafeInteger(profile.followers)?`${profile.followers.toLocaleString('zh-CN')} 粉丝`:'';
      const button=actions.querySelector('button');
      const self=!!document.querySelector(`a[data-testid="AppTabBar_Profile_Link"][href="/${handle}" i]`);
      button.hidden=self || typeof profile.following!=='boolean';
      button.disabled=profile.following===true || pending?.handle===handle;
      const buttonLabel=profile.following?'已关注':pending?.handle===handle?'关注中':'关注';
      if(button.textContent!==buttonLabel)button.textContent=buttonLabel;
      button.dataset.following=String(profile.following===true);
      button.setAttribute('aria-label',`${buttonLabel} @${handle}`);
    }
  }
  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(render);}}
  function follow(article,handle,button){
    if(pending || profiles.get(handle)?.following!==false)return;
    const caret=own(article,'[data-testid="caret"]');if(!caret)return;
    const previous=new Set(document.querySelectorAll('[role="menu"]'));
    const job={handle};pending=job;button.disabled=true;
    let clicked=false;
    const stop=()=>{observer.disconnect();clearTimeout(timeout);if(pending===job)pending=null;schedule();};
    const confirm=()=>{profiles.get(handle).following=true;window.postMessage({type:'xf-confirm-follow',handle},location.origin);stop();};
    const observer=new MutationObserver(()=>{
      const success=[...document.querySelectorAll('[role="alert"], [data-testid="toast"]')].some(node=>{
        const label=node.textContent.trim();
        return new RegExp(`@${handle}(?![A-Za-z0-9_])`,'i').test(label) && /你关注了|You followed|You[’']re now following/i.test(label);
      });
      if(clicked && success){confirm();return;}
      if(clicked)return;
      for(const menu of document.querySelectorAll('[role="menu"]')){
        if(previous.has(menu))continue;
        const target=[...menu.querySelectorAll('[role="menuitem"]')].find(item=>{
          const label=item.textContent.trim();
          return label.toLowerCase().includes(`@${handle}`) && /^(关注\s*@|Follow\s+@)/i.test(label);
        });
        if(target){clicked=true;target.click();return;}
        const alreadyFollowing=[...menu.querySelectorAll('[role="menuitem"]')].some(item=>{
          const label=item.textContent.trim();
          return label.toLowerCase().includes(`@${handle}`) && /^(取消关注|Unfollow)\s*@/i.test(label);
        });
        if(alreadyFollowing){caret.click();confirm();return;}
      }
    });
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    const timeout=setTimeout(stop,8000);
    job.stop=stop;caret.click();schedule();
  }
  window.addEventListener('message',event=>{
    if(event.source!==window || event.origin!==location.origin || event.data?.type!=='xf-avatar-records')return;
    for(const [handle,value] of Object.entries(event.data.profiles||{})){
      if(!/^[A-Za-z0-9_]{1,15}$/.test(handle) || !value || typeof value!=='object')continue;
      const profile=profiles.get(handle.toLowerCase())||{};
      if(typeof value.bio==='string')profile.bio=value.bio.slice(0,2000);
      if(Number.isSafeInteger(value.followers) && value.followers>=0)profile.followers=value.followers;
      if(typeof value.following==='boolean')profile.following=value.following;
      profiles.set(handle.toLowerCase(),profile);
      if(pending?.handle===handle.toLowerCase() && profile.following===true)pending.stop();
    }
    schedule();
  });
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','href']});
  window.postMessage({type:'xf-request-avatar-records'},location.origin);
  schedule();
})();
