(() => {
  'use strict';
  function profileFromScript(script, handle) {
    const marker = /(?:window\.)?__INITIAL_STATE__\s*=\s*/.exec(script);
    if (!marker || !handle) return null;
    const start = marker.index + marker[0].length;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < script.length; i++) {
      const ch = script[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        if (--depth !== 0) continue;
        try {
          const initial = JSON.parse(script.slice(start, i + 1));
          const user = Object.values(initial.entities?.users?.entities || {}).find(u =>
            (u.screen_name || u.core?.screen_name || '').toLowerCase() === handle.toLowerCase());
          if (!user) return null;
          const legacy = user.legacy || user;
          const stats = {};
          for (const [key, field] of [['posts','statuses_count'],['following','friends_count'],['followers','followers_count']]) {
            const count = legacy[field];
            if (Number.isSafeInteger(count) && count >= 0) stats[key] = String(count);
          }
          return { name: user.name || user.core?.name || legacy.name, avatar: legacy.profile_image_url_https || user.avatar?.image_url, stats };
        } catch { return null; }
      }
    }
    return null;
  }
  globalThis.__xfCore = {
    profileFromScript,
    monthName: month => ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'][month]
  };
})();
