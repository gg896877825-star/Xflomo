(() => {
  'use strict';
  if (globalThis.__xfSkin) { globalThis.__xfSkin.refresh(); return; }
  const hasStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local;
  const state = { enabled: true, accounts: {}, handle: '', route: '', expanded: true, followingStatus: '', followingError: '' };
  let timer, saving, destroyed = false;
  const parsedScripts = new WeakSet();
  const core = globalThis.__xfCore;
  const requestedFollowing = new Set();
  const requestedPosts = new Set();
  const retriedAvatars = new Set();
  const networkAvatars={};
  const navigationLabels=new Map();
  const postSource = new URL(location.href).searchParams.has('xf_post_source');
  const sourcePage = postSource || new URL(location.href).searchParams.has('xf_follow_source');
  const qs = (selector, root = document) => root.querySelector(selector);
  const text = node => node?.textContent?.trim() || '';
  const handleOf = href => { if (!href) return ''; try { return new URL(href, location.origin).pathname.split('/')[1] || ''; } catch { return ''; } };
  const element = (tag, props = {}, value) => { const node = document.createElement(tag); Object.assign(node, props); if (value !== undefined) node.textContent = value; return node; };
  function followingAvatar(cell) {
    const link=[...cell.querySelectorAll('a[href]')].find(a=>/^\/[A-Za-z0-9_]+$/.test(a.getAttribute('href')||'') && text(a));
    const known=networkAvatars[handleOf(link?.href).toLowerCase()];
    if(known)return known;
    const host=qs('[data-testid^="UserAvatar-Container-"]',cell);
    if(!host)return '';
    const img=qs('img',host);
    const source=img?.currentSrc || img?.getAttribute('src') || img?.getAttribute('data-src');
    if(source && /^https:\/\//.test(source))return source;
    const background=qs('[style*="background-image"]',host)?.style.backgroundImage || '';
    return background.match(/url\(["']?(https:\/\/[^"')]+)["']?\)/)?.[1] || '';
  }
  function receiveAvatars(event) {
    if(event.source!==window || event.origin!==location.origin || event.data?.type!=='xf-avatar-records')return;
    let changed=false;
    for(const [handle,url] of Object.entries(event.data.users||{})) {
      if(!/^[A-Za-z0-9_]{1,15}$/.test(handle) || typeof url!=='string' || !/^https:\/\/pbs\.twimg\.com\//.test(url))continue;
      networkAvatars[handle.toLowerCase()]=url;
      const entry=Object.entries(state.accounts[state.handle]?.following||{}).find(([key])=>key.toLowerCase()===handle.toLowerCase())?.[1];
      if(entry && entry.avatar!==url){entry.avatar=url;delete entry.avatarData;changed=true;}
    }
    if(changed){save();renderFollowing();}
  }
  window.addEventListener('message',receiveAvatars);
  window.postMessage({type:'xf-request-avatar-records'},location.origin);
  function account() { return state.accounts[state.handle] ||= { name: state.handle, avatar: '', stats: {}, posts: {}, following: {} }; }
  function save() {
    if (!hasStorage || sourcePage) return;
    clearTimeout(saving);
    saving = setTimeout(() => chrome.storage.local.set({ accounts: state.accounts }).catch(() => {}), 700);
  }
  function syncLayoutWidth() {
    const root=document.documentElement;
    if(!root || !state.enabled || destroyed)return;
    // X preserves the layout width with margin-right while locking page scroll.
    const width=root.getBoundingClientRect().width;
    if(width>0)root.style.setProperty('--xf-layout-width',`${width}px`);
  }
  const layoutObserver=typeof ResizeObserver==='function'?new ResizeObserver(syncLayoutWidth):null;
  if(document.documentElement)layoutObserver?.observe(document.documentElement);
  function apply() {
    if (destroyed) return;
    if (!document.documentElement) return;
    document.documentElement.classList.toggle('xf-on', state.enabled);
    document.documentElement.classList.toggle('xf-off', !state.enabled);
    document.documentElement.classList.toggle('xf-chat',state.enabled && /^\/i\/chat(?:\/|$)/.test(location.pathname));
    syncLayoutWidth();
    document.querySelectorAll('[data-xf-owned]:not(#xf-heat-tooltip)').forEach(e => { e.hidden = !state.enabled; });
    if (!state.enabled || destroyed) { hideHeatTooltip(); return; }
    const header = qs('header[role="banner"]');
    const main = qs('main[role="main"]');
    const primary = qs('[data-testid="primaryColumn"]') || main;
    if (!header || !main) return;
    header.parentElement.classList.add('xf-shell');
    let cursor = primary === main ? null : primary.parentElement;
    while (cursor && cursor !== main) { cursor.classList.add('xf-main-inner'); cursor = cursor.parentElement; }
    const rail = header.firstElementChild?.firstElementChild;
    if (rail) rail.classList.add('xf-rail');
    const profileLink = qs('[data-testid="AppTabBar_Profile_Link"]');
    const switcherHandle = text(qs('[data-testid="SideNav_AccountSwitcher_Button"]')).match(/@([A-Za-z0-9_]+)/)?.[1];
    const nextHandle = handleOf(profileLink?.getAttribute('href')) || switcherHandle || state.handle;
    if (!nextHandle) return;
    if (nextHandle !== state.handle) { state.postsStatus='';state.postsError='';state.handle = nextHandle; document.querySelectorAll('[data-xf-owned]:not(#xf-ad-slot)').forEach(e => e.remove()); }
    const data = account();
    for (const script of document.scripts || []) {
      if (script.src || parsedScripts.has(script) || !script.textContent.includes('__INITIAL_STATE__')) continue;
      const profile = core?.profileFromScript(script.textContent, state.handle);
      if (profile) {
        parsedScripts.add(script);
        Object.assign(data.stats, profile.stats);
        if (profile.name) data.name = profile.name;
        if (profile.avatar) data.avatar = profile.avatar;
        save();
      }
    }
    const switcher = qs('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (switcher) {
      const spans = [...switcher.querySelectorAll('span')].map(text).filter(Boolean);
      data.name = spans.find(s => !s.startsWith('@')) || data.name;
      data.avatar = qs('img', switcher)?.src || data.avatar;
    }
    // Style only the common outer surface; native editor controls stay untouched.
    for(const editor of primary.querySelectorAll('[data-testid="tweetTextarea_0"][contenteditable="true"]')) {
      if(editor.closest('article, [role="dialog"]'))continue;
      let row=editor.parentElement;
      while(row && row!==primary) {
        if(row.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]') && row.querySelector('[data-testid^="UserAvatar"], [data-testid="Tweet-User-Avatar"]'))break;
        row=row.parentElement;
      }
      if(row && row!==primary && !row.querySelector('article, section[role="region"]'))row.classList.add('xf-compose-card');
    }
    for(const region of primary.querySelectorAll('section[role="region"]')) {
      let wrap=region;
      while(wrap && wrap!==primary){wrap.classList.add('xf-feed-width');wrap=wrap.parentElement;}
    }
    for(const [who,person] of Object.entries(data.following)) {
      const native=[...primary.querySelectorAll('[data-testid^="UserAvatar-Container-"]')].find(e=>e.dataset.testid.toLowerCase()===`useravatar-container-${who.toLowerCase()}`);
      const url=native?.querySelector('img')?.getAttribute('src') || networkAvatars[who.toLowerCase()];
      if(url && /^https:\/\/pbs\.twimg\.com\//.test(url) && person.avatar!==url){person.avatar=url;delete person.avatarData;save();}
    }
    const path = location.pathname;
    const ownProfile = path.toLowerCase() === `/${state.handle}`.toLowerCase();
    if (ownProfile) {
      for (const kind of ['following', 'followers', 'verified_followers']) {
        const link = qs(`a[href="/${state.handle}/${kind}"]`, primary);
        if (link) data.stats[kind === 'following' ? 'following' : 'followers'] = text(qs('span', link)) || text(link).split(/\s/)[0];
      }
      const titles = [...primary.querySelectorAll('h2')];
      const titleWrap = titles[0]?.parentElement;
      const countText = text(titleWrap?.parentElement);
      const postCount = countText.match(/([\d,.]+[万亿KMkm]?)\s*(?:帖子|posts)/i);
      if (postCount) data.stats.posts = postCount[1];
      for (const article of primary.querySelectorAll('article[data-testid="tweet"]')) {
        const name = qs('[data-testid="User-Name"]', article);
        const author = name && [...name.querySelectorAll('a[href]')].find(a => !a.href.includes('/status/'));
        if (handleOf(author?.href).toLowerCase() !== state.handle.toLowerCase()) continue;
        const time = qs('time[datetime]', article);
        const permalink = time?.closest('a')?.getAttribute('href');
        const id = permalink?.match(/\/status\/(\d+)/)?.[1];
        if (id && time?.dateTime) data.posts[id] = time.dateTime;
      }
      save();
    }
    if (new RegExp(`^/${state.handle}/(following|verified_followers|followers)/?$`, 'i').test(path) && /\/following\/?$/.test(path)) {
      for (const cell of primary.querySelectorAll('[data-testid="UserCell"]')) {
        const links = [...cell.querySelectorAll('a[href]')];
        const link = links.find(a => /^\/[A-Za-z0-9_]+$/.test(a.getAttribute('href') || '') && text(a));
        const who = handleOf(link?.href);
        if (!who || who.toLowerCase() === state.handle.toLowerCase()) continue;
        if (!cell.querySelector('button[data-testid$="-unfollow"]')) { delete data.following[who]; continue; }
        const avatar=followingAvatar(cell) || data.following[who]?.avatar || '';
        data.following[who] = { name: text(link).split('@')[0].trim() || who, avatar, ...(avatar===data.following[who]?.avatar && data.following[who]?.avatarData ? {avatarData:data.following[who].avatarData}: {}) };
      }
      save();
    }
    const anchor = qs('nav', header);
    if (anchor) [...anchor.querySelectorAll(':scope > a[href]')].forEach(a => a.classList.toggle('xf-selected', a.getAttribute('href') === path));
    if (anchor && !qs('#xf-profile')) {
      const panel = element('section', { id: 'xf-profile', className: 'xf-panel' }); panel.dataset.xfOwned = 'true';
      rail.prepend(panel);
    }
    if (anchor && !qs('#xf-following')) {
      const panel = element('section', { id: 'xf-following', className: 'xf-panel' }); panel.dataset.xfOwned = 'true';
      const post = qs('[data-testid="SideNav_NewTweet_Button"]', header);
      rail.append(panel);
    }
    for(const tab of primary.querySelectorAll('[role="tablist"] [role="tab"]')) {
      if(!tab.closest('.xf-compose-card, [role="dialog"], [data-testid="toolBar"]'))tab.classList.add('xf-page-tab');
    }
    // Match only page chrome, stopping before any content or composer surface.
    for(const seed of primary.querySelectorAll('.xf-page-tab, h2, [data-testid="app-bar-back"], [role="search"]')) {
      if(seed.closest('article, .xf-compose-card, [role="dialog"], section[role="region"]'))continue;
      for(let wrap=seed;wrap && wrap!==primary;wrap=wrap.parentElement) {
        if(wrap.querySelector('article, section[role="region"], [data-testid="tweetTextarea_0"]'))break;
        wrap.classList.add('xf-page-chrome');
        if (getComputedStyle(wrap).position === 'sticky') wrap.classList.add('xf-sticky-chrome');
      }
    }
    configureNavigation(anchor);
    renderProfile(); renderFollowing();
    updateFollowingSelection();
    positionNativeAccount();
    loadFollowing();
    loadPosts();
    state.route = path;
  }
  let profileKey = '', followKey = '';
  function renderProfile() {
    const panel = qs('#xf-profile'); if (!panel) return;
    const data = account();
    const key = JSON.stringify([state.handle,data.name,data.avatar,data.stats,data.posts,state.postsStatus,state.postsError,new Date().toDateString()]);
    if (key === profileKey && panel.childElementCount) return; profileKey = key;
    panel.replaceChildren();
    const heading = element('div',{className:'xf-heading'});
    heading.setAttribute('aria-hidden','true');
    if (data.avatar) heading.append(element('img',{src:data.avatar,alt:''}));
    const identity = element('div'); identity.append(element('div',{className:'xf-name'},data.name),element('div',{className:'xf-handle'},`@${state.handle}`)); heading.append(identity); panel.append(heading);
    const stats = element('div',{className:'xf-stats'});
    for (const [key,label] of [['posts','帖子'],['following','正在关注'],['followers','关注者']]) {
      const item=element('a',{className:'xf-stat',href:`/${state.handle}${key==='posts'?'':'/'+key}`}); item.append(element('strong',{},data.stats[key] ?? '…'),element('span',{},label)); stats.append(item);
    }
    if (stats.childElementCount) panel.append(stats);
    const activity=element('section',{className:'xf-activity'});
    activity.setAttribute('aria-label','发帖活动');
    panel.append(activity);
    const heat=element('div',{className:'xf-heat'}); heat.setAttribute('aria-label','已读取的本人帖子，按天统计');
    const counts={};
    for (const dt of Object.values(data.posts)) { const d=new Date(dt); if(!Number.isNaN(+d)) { const k=localDay(d);counts[k]=(counts[k]||0)+1; } }
    const today=new Date();today.setHours(0,0,0,0);
    const end=new Date(today);end.setDate(end.getDate()+(6-end.getDay()));
    const start=new Date(end);start.setDate(start.getDate()-111);
    for (let i=0;i<112;i++) {
      const date=new Date(start);date.setDate(date.getDate()+i);
      const count=counts[localDay(date)]||0;
      const label=`${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日 · ${count} 条帖子`;
      const square=element('span',{className:'xf-day'});
      const level=count===0?0:count===1?1:count<=3?2:count<=7?3:count<=15?4:5;
      square.dataset.level=String(level);
      square.setAttribute('aria-label',label);
      if(date>today) {square.style.visibility='hidden';square.setAttribute('aria-hidden','true');}
      else {
        if(count>0)square.tabIndex=0;
        square.addEventListener('mouseenter',()=>showHeatTooltip(square,label));
        square.addEventListener('mouseleave',hideHeatTooltip);
        square.addEventListener('focus',()=>showHeatTooltip(square,label));
        square.addEventListener('blur',hideHeatTooltip);
      }
      heat.append(square);
    }
    activity.append(heat);
    if (state.postsStatus === 'loading') activity.append(element('p',{className:'xf-note'},'正在读取发帖记录…'));
    if (state.postsError) {
      const retry=element('button',{type:'button',className:'xf-post-retry'},state.postsStatus==='error'?'读取失败，点击重试':'历史记录未读完，点击继续');
      retry.title=state.postsError;retry.addEventListener('click',()=>{requestedPosts.delete(state.handle);loadPosts(true);});activity.append(retry);
    }
    const months=element('div',{className:'xf-months'}); const labels=new Set();for(let i=0;i<112;i++){const d=new Date(start);d.setDate(d.getDate()+i);if(d<=today)labels.add(core.monthName(d.getMonth()));}for(const label of labels)months.append(element('span',{},label));activity.append(months);



  }
  let heatTooltip, activeHeatSquare;
  function hideHeatTooltip() {
    if(!heatTooltip)return;
    activeHeatSquare?.removeAttribute('aria-describedby');
    activeHeatSquare=null;
    heatTooltip.hidden=true;
  }
  function showHeatTooltip(square,label) {
    if(!heatTooltip || !heatTooltip.isConnected) {
      heatTooltip=element('div',{id:'xf-heat-tooltip',className:'xf-heat-tooltip',hidden:true});
      heatTooltip.dataset.xfOwned='true';heatTooltip.setAttribute('role','tooltip');
      document.body.append(heatTooltip);
    }
    activeHeatSquare?.removeAttribute('aria-describedby');activeHeatSquare=square;
    heatTooltip.textContent=label;heatTooltip.hidden=false;
    square.setAttribute('aria-describedby','xf-heat-tooltip');
    const rect=square.getBoundingClientRect();
    const width=heatTooltip.offsetWidth;
    heatTooltip.style.left=`${Math.max(8,Math.min(innerWidth-width-8,rect.left+rect.width/2-width/2))}px`;
    heatTooltip.style.top=`${Math.max(8,rect.top-heatTooltip.offsetHeight-9)}px`;
  }
  const dismissTooltip=()=>{hideHeatTooltip();positionNativeAccount();};
  document.addEventListener('scroll',dismissTooltip,true);
  document.addEventListener('keydown',dismissTooltip);
  function localDay(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
  function renderFollowing() {
    const panel=qs('#xf-following');if(!panel)return;
    const data=account();const entries=Object.entries(data.following);const key=JSON.stringify([state.handle,entries,state.followingStatus,state.followingError]);
    if(key===followKey&&panel.childElementCount)return;followKey=key;
    panel.replaceChildren();const head=element('div',{className:'xf-follow-head'});head.append(element('span',{},'关注的博主'));
    panel.append(head);
    const list=element('div',{className:'xf-follow-list'});list.setAttribute('aria-label','关注账号列表');panel.append(list);
    const populate=()=>{list.replaceChildren();const rows=entries;for(const [handle,value]of rows){const link=element('a',{className:'xf-person',href:`/${handle}`});const avatar=element('span',{className:'xf-person-avatar'},(value.name||handle).slice(0,1).toUpperCase());avatar.setAttribute('aria-hidden','true');if(value.avatarData || value.avatar){const img=element('img',{alt:'',decoding:'async',referrerPolicy:'no-referrer'});img.addEventListener('error',()=>{img.remove();if(!retriedAvatars.has(state.handle)){retriedAvatars.add(state.handle);delete value.avatarData;data.followingUpdatedAt=0;save();requestedFollowing.delete(state.handle);loadFollowing(true);}},{once:true});img.src=value.avatarData||value.avatar;avatar.append(img);}link.append(avatar);const label=element('div');label.append(element('div',{className:'xf-name'},value.name),element('div',{className:'xf-handle'},`@${handle}`));link.append(label);list.append(link);}if(!entries.length)list.append(element('p',{className:'xf-note'},state.followingStatus==='loading'?'正在读取关注列表…':state.followingError||'暂无关注账号'));else if(!rows.length)list.append(element('p',{className:'xf-note'},'没有匹配的账号'));};populate();
    if(state.followingError){const retry=element('button',{type:'button',className:'xf-follow-retry'},'重新读取');retry.addEventListener('click',()=>{requestedFollowing.delete(state.handle);loadFollowing(true);});panel.append(retry);}


  }
  function updateFollowingSelection() {
    const path=location.pathname.toLowerCase().replace(/\/$/,'');
    for(const link of document.querySelectorAll('#xf-following .xf-person')) {
      const href=link.getAttribute('href').toLowerCase();
      const selected=path===href || path.startsWith(href+'/');
      link.classList.remove('xf-selected');
      link.classList.toggle('xf-person-selected',selected);
      if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
    }
  }
  function navigateOwnedLink(event) {
    if(!state.enabled || destroyed || event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
    const link=event.target instanceof Element ? event.target.closest('[data-xf-owned] a[href]') : null;
    if(!link || link.hasAttribute('download') || (link.target && link.target!=='_self'))return;
    const target=new URL(link.href,location.href);
    if(target.origin!==location.origin)return;
    event.preventDefault();
    if(target.href===location.href)return;
    // Notify X's existing browser router without replacing the document or rail.
    history.pushState({...history.state,key:`xf${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`},'',target.pathname+target.search+target.hash);
    window.dispatchEvent(new PopStateEvent('popstate',{state:history.state}));
  }
  const routeChanged=()=>{updateFollowingSelection();apply();};
  document.addEventListener('click',navigateOwnedLink);
  window.addEventListener('popstate',routeChanged);
  function configureNavigation(nav) {
    if (!nav) return;
    for(const item of nav.querySelectorAll(':scope > a[href], :scope > button')) {
      const key=item.getAttribute('href') || item.getAttribute('data-testid') || '';
      const labels=[...item.querySelectorAll('span')].filter(span=>!span.closest('[data-xf-owned]') && text(span) && !/^[\d\s+.,]+$/.test(text(span)));
      const label=text(labels[0]) || item.getAttribute('aria-label') || item.getAttribute('title') || navigationLabels.get(key);
      if(label)navigationLabels.set(key,label);
      const visible=labels.some(span=>span.getBoundingClientRect().width>0 && span.getBoundingClientRect().height>0 && getComputedStyle(span).visibility!=='hidden');
      let fallback=qs('.xf-nav-label',item);
      if(visible || !label || innerWidth<=760){fallback?.remove();continue;}
      if(!fallback){fallback=element('span',{className:'xf-nav-label'});fallback.dataset.xfOwned='true';fallback.setAttribute('aria-hidden','true');(item.firstElementChild || item).append(fallback);}
      if(fallback.textContent!==label)fallback.textContent=label;
    }
    qs('.xf-post-label',qs('[data-testid="SideNav_NewTweet_Button"]') || nav)?.remove();
    // Remove the native full-height scrolling wrappers around the menu.
    for(let host=nav.parentElement;host && !host.classList.contains('xf-rail');host=host.parentElement)host.classList.add('xf-nav-host');
    const following=qs('#xf-following');
    if(following && following.parentElement!==nav)nav.append(following);
    nav.classList.remove('xf-nav-expanded');
    nav.classList.add('xf-nav-all');
    nav.querySelector('#xf-nav-toggle')?.remove();
    nav.querySelectorAll('.xf-nav-secondary').forEach(item=>item.classList.remove('xf-nav-secondary'));
  }
  function positionNativeAccount() {
    const native=qs('[data-testid="SideNav_AccountSwitcher_Button"]');
    if(document.documentElement.classList.contains('xf-chat')){native?.classList.remove('xf-account-compact');return;}
    const heading=qs('#xf-profile .xf-heading');
    if(!native || !heading)return;
    native.classList.remove('xf-account-compact');
    const data=account();
    const identity=[...native.querySelectorAll('span')].some(span=>{
      const value=text(span),rect=span.getBoundingClientRect();
      return (value.includes(`@${state.handle}`) || value===data.name) && rect.width>0 && rect.height>0 && getComputedStyle(span).visibility!=='hidden';
    });
    native.classList.toggle('xf-account-compact',!identity);
    const nav=qs('header[role="banner"] nav');
    if(nav)document.documentElement.style.setProperty('--xf-nav-top',`${nav.getBoundingClientRect().top}px`);
    const rect=heading.getBoundingClientRect();
    document.documentElement.style.setProperty('--xf-account-left',`${rect.left}px`);
    document.documentElement.style.setProperty('--xf-account-top',`${rect.top}px`);
    document.documentElement.style.setProperty('--xf-account-width',`${rect.width}px`);
    native.removeAttribute('aria-hidden');
    native.setAttribute('tabindex','0');
  }
  window.addEventListener('resize',positionNativeAccount);
  async function loadPosts(force=false) {
    if(sourcePage || !hasStorage || !chrome.runtime?.sendMessage || !state.handle)return;
    const handle=state.handle,data=account();
    if(requestedPosts.has(handle) || (!force && data.postsHistoryVersion===2 && data.postsUpdatedAt && Date.now()-data.postsUpdatedAt<5*60*1000))return;
    requestedPosts.add(handle);state.postsStatus='loading';state.postsError='';renderProfile();
    try {
      const response=await chrome.runtime.sendMessage({type:'xf-load-posts',handle});
      if(destroyed || state.handle!==handle)return;
      if(!response || response.error)throw new Error(response?.error||'发帖记录暂时无法读取');
      Object.assign(data.posts,response.posts);
      data.postsUpdatedAt=response.complete?Date.now():0;
      data.postsHistoryVersion=response.complete?2:0;
      state.postsStatus='ready';state.postsError=response.complete?'':'部分记录尚未加载';save();
    } catch(error) { if(state.handle===handle){state.postsStatus='error';state.postsError=error.message;} }
    if(!destroyed && state.handle===handle){renderProfile();positionNativeAccount();}
  }
  async function collectPosts(handle) {
    if(!postSource || location.pathname.toLowerCase()!==`/${handle}`.toLowerCase())return {error:'页面不匹配'};
    return await new Promise(resolve=>{
      const id=`${Date.now()}-${Math.random()}`;
      let posts={};
      const finish=value=>{clearTimeout(timeout);window.removeEventListener('message',receive);resolve(value);};
      const receive=event=>{
        if(event.source!==window || event.origin!==location.origin || event.data?.id!==id)return;
        if(event.data.type==='xf-history-progress')posts=event.data.posts;
        if(event.data.type==='xf-history-result')finish({posts:event.data.posts,complete:event.data.complete,error:Object.keys(event.data.posts||{}).length?'':event.data.error});
      };
      const timeout=setTimeout(()=>finish(Object.keys(posts).length?{posts,complete:false}:{error:'读取历史记录超时，请重试'}),120000);
      window.addEventListener('message',receive);
      window.postMessage({type:'xf-history-request',handle,id},location.origin);
    });
  }

  async function loadFollowing(force=false) {
    if(sourcePage || !hasStorage || !chrome.runtime?.sendMessage || !state.handle) return;
    const handle=state.handle, data=account();
    if(requestedFollowing.has(handle)) return;
    if(!force && data.followingUpdatedAt && Date.now()-data.followingUpdatedAt<15*60*1000 && Number(data.stats.following)===Object.keys(data.following).length && Object.values(data.following).every(person=>person.avatarData)) return;
    requestedFollowing.add(handle);state.followingStatus='loading';state.followingError='';renderFollowing();
    try {
      const response=await chrome.runtime.sendMessage({type:'xf-load-following',handle,expected:Number(data.stats.following)});
      if(destroyed || state.handle!==handle)return;
      if(!response || response.error)throw new Error(response?.error||'关注列表暂时无法读取');
      if(response.complete) data.following=response.following;
      else Object.assign(data.following,response.following);
      data.followingUpdatedAt=response.complete?Date.now():0;
      state.followingStatus='ready';
      state.followingError=!response.complete?'部分账号尚未加载':Object.values(data.following).some(person=>!person.avatar)?'部分头像尚未加载':'';save();
    } catch(error) { if(state.handle===handle){state.followingStatus='error';state.followingError=error.message;} }
    if(!destroyed && state.handle===handle)renderFollowing();
  }
  async function collectFollowing(handle,expected) {
    if(!sourcePage || location.pathname.toLowerCase()!==`/${handle}/following`.toLowerCase())return {error:'页面不匹配'};
    const following={};let stable=0, last=-1, seenCells=false;
    for(let round=0;round<60;round++) {
      for(const cell of document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="UserCell"]')) {
        seenCells=true;
        if(!cell.querySelector('button[data-testid$="-unfollow"]'))continue;
        const link=[...cell.querySelectorAll('a[href]')].find(a=>/^\/[A-Za-z0-9_]+$/.test(a.getAttribute('href')||'')&&text(a));
        const who=handleOf(link?.href);
        if(who && who.toLowerCase()!==handle.toLowerCase())following[who]={name:text(link).split('@')[0].trim()||who,avatar:followingAvatar(cell)||following[who]?.avatar||''};
      }
      const count=Object.keys(following).length;
      if(Number.isFinite(expected) && count>=expected && Object.values(following).every(person=>person.avatar) && (expected>0 || document.querySelector('[data-testid="emptyState"]')))return {following,complete:true};
      stable=count===last?stable+1:0;last=count;
      if(seenCells && stable>=8 && Object.values(following).every(person=>person.avatar))return {following,complete:!Number.isFinite(expected)||count>=expected};
      window.scrollBy(0,Math.max(600,innerHeight-100));
      await new Promise(resolve=>setTimeout(resolve,400));
    }
    return Object.keys(following).length?{following,complete:false}:{error:'未能读取关注列表，请重试'};
  }
  if(typeof chrome!=='undefined' && chrome.runtime?.onMessage)chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    if(message?.type==='xf-collect-posts'){collectPosts(message.handle).then(respond,()=>respond({error:'读取失败'}));return true;}
    if(message?.type!=='xf-collect-following')return;
    collectFollowing(message.handle,message.expected).then(respond,()=>respond({error:'读取失败'}));return true;
  });
  const observer=new MutationObserver(records=>{
    if(records.every(r=>r.target instanceof Element && r.target.closest('[data-xf-owned]')))return;
    if (timer) return;
    timer=setTimeout(()=>{timer=null;apply();},0);
  });
  globalThis.__xfSkin={refresh:apply,setEnabled(value){state.enabled=!!value;apply();},destroy(){destroyed=true;layoutObserver?.disconnect();document.documentElement?.style.removeProperty('--xf-layout-width');window.removeEventListener('message',receiveAvatars);document.removeEventListener('click',navigateOwnedLink);window.removeEventListener('popstate',routeChanged);window.removeEventListener('resize',positionNativeAccount);document.removeEventListener('scroll',dismissTooltip,true);document.removeEventListener('keydown',dismissTooltip);observer.disconnect();clearTimeout(timer);clearTimeout(saving);document.documentElement?.classList.remove('xf-on','xf-off','xf-chat');document.querySelectorAll('[data-xf-owned]').forEach(e=>e.remove());const nativeAccount=qs('[data-testid="SideNav_AccountSwitcher_Button"]');if(nativeAccount){nativeAccount.removeAttribute('aria-hidden');nativeAccount.setAttribute('tabindex','0');}delete globalThis.__xfSkin;}};
  observer.observe(document,{childList:true,subtree:true});
  if(hasStorage){chrome.storage.local.get({enabled:true,accounts:{}}).then(saved=>{state.enabled=saved.enabled;state.accounts=saved.accounts;apply();}).catch(()=>apply());chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.enabled){state.enabled=changes.enabled.newValue;apply();}});}else apply();
})();
