// BLBL 取消收藏助手 · Content Script（MV3）
// 运行在 bilibili.com 页面上下文：同时具备登录态 Cookie、csrf(document.cookie)、播放器 DOM。
// 动作：
//   skip        跳过：播放下一个（原生「下一个」优先，导航兜底）
//   unfav       取消收藏：batch-del 移除当前视频，不打断播放
//   unfav_skip  取消收藏并跳过
// 说明：取消收藏作用于「当前连播收藏夹」（从 URL /list/ml<media_id> 解析）。

(() => {
  "use strict";
  if (window.__blblAssistant) return;
  window.__blblAssistant = true;

  // ---- 可配置快捷键（页面内按键监听，支持任意单键如 z/x/c）----
  // 说明：manifest commands 被 Chrome/Edge 强制要求含 Ctrl/Alt，无法绑单字母；
  //       故改用页面内 keydown（capture 阶段）。全屏时按键事件仍冒泡到页面，capture 可捕获。
  const DEFAULT_BINDINGS = { skip: "z", unfav: "x", unfav_skip: "c" };
  let bindings = { ...DEFAULT_BINDINGS };

  function normKey(k) {
    if (k === " " || k === "Spacebar") return "space";
    return String(k || "").toLowerCase();
  }
  // 解析 "ctrl+shift+z" / "z" / "alt+1" → {key, mods}
  function parseBinding(str) {
    const parts = String(str || "").toLowerCase().split("+").map(s => s.trim()).filter(Boolean);
    const key = parts.length ? parts[parts.length - 1] : "";
    const mods = { ctrl: false, alt: false, shift: false, meta: false };
    for (const p of parts.slice(0, -1)) {
      if (p === "ctrl" || p === "control") mods.ctrl = true;
      else if (p === "alt") mods.alt = true;
      else if (p === "shift") mods.shift = true;
      else if (p === "meta" || p === "cmd" || p === "command") mods.meta = true;
    }
    return { key: normKey(key), mods };
  }
  function matchBinding(ev, str) {
    const b = parseBinding(str);
    if (!b.key) return false;
    if (normKey(ev.key) !== b.key) return false;
    if (!!ev.ctrlKey !== b.mods.ctrl) return false;
    if (!!ev.altKey !== b.mods.alt) return false;
    if (!!ev.metaKey !== b.mods.meta) return false;
    // shift 不参与匹配（单字母大小写都算）
    return true;
  }
  function isEditableTarget(t) {
    if (!t) return false;
    const tag = (t.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (t.isContentEditable) return true;
    return false;
  }
  async function handleKey(ev) {
    if (isEditableTarget(ev.target)) return;         // 打字时不拦截
    for (const action of ["skip", "unfav", "unfav_skip"]) {
      if (matchBinding(ev, bindings[action])) {
        ev.preventDefault();
        ev.stopPropagation();
        if (action === "skip") await doSkip();
        else if (action === "unfav") await doUnfav();
        else if (action === "unfav_skip") await doUnfavSkip();
        return;
      }
    }
  }
  function loadBindings() {
    try {
      chrome.storage.sync.get("blblBindings", (res) => {
        if (res && res.blblBindings) bindings = { ...DEFAULT_BINDINGS, ...res.blblBindings };
      });
    } catch (e) {}
  }


  // ---- 工具：从 URL 取收藏夹 media_id ----
  function getMediaId() {
    const m = location.pathname.match(/\/list\/ml(\d+)/);
    return m ? m[1] : null;
  }

  // ---- 工具：识别当前播放视频（avid 为主键，batch-del 需要 avid）----
  // 连播页 /list/ml… 的 URL 不含 BV，canonical/og 也可能指向列表页，故不能只找 bvid；
  // 部分页面连 __INITIAL_STATE__/player/pinia 都不暴露，故首选「网络嗅探」结果：
  // net-hook.js（MAIN world）hook 页面 fetch/XHR，把最近一次含 bvid/avid 的请求
  // 写到 <html data-blbl-cur>，隔离世界通过 DOM 读它（DOM 是两世界共享桥梁）。
  function readNetCur() {
    try {
      const raw = document.documentElement.getAttribute("data-blbl-cur");
      if (!raw) return null;
      const n = JSON.parse(raw);
      if (n && (n.aid || n.bvid)) return { avid: +n.aid || 0, bvid: n.bvid || "", ts: n.ts || 0 };
    } catch (e) {}
    return null;
  }

  function readCurrent() {
    const out = { avid: 0, bvid: "", src: "" };
    // 1) 网络嗅探（最可靠：反映播放器实际正在请求/播放的视频）
    const net = readNetCur();
    if (net) {
      if (net.avid) { out.avid = net.avid; out.src = "net-hook"; }
      if (net.bvid) { out.bvid = net.bvid; out.src = out.src || "net-hook"; }
    }
    // 2) 页面全局 / DOM（net-hook 未命中时兜底）
    const S = (function(){ try { return window.__INITIAL_STATE__ || {}; } catch(e){ return {}; } })();
    const VD = (function(){ try { return S.videoData || {}; } catch(e){ return {}; } })();
    if (!out.avid && S.aid) { out.avid = +S.aid; out.src = out.src || "IS.aid"; }
    if (!out.avid && VD.aid) { out.avid = +VD.aid; out.src = out.src || "VD.aid"; }
    if (!out.bvid && S.bvid) { out.bvid = S.bvid; out.src = out.src || "IS.bvid"; }
    if (!out.bvid && VD.bvid) { out.bvid = out.bvid || VD.bvid; out.src = out.src || "VD.bvid"; }
    // player 对象
    try {
      const p = window.player;
      if (p) {
        if (!out.avid && p.aid) { out.avid = +p.aid; out.src = out.src || "player.aid"; }
        if (!out.bvid && p.bvid) { out.bvid = p.bvid; out.src = out.src || "player.bvid"; }
        if ((!out.avid || !out.bvid) && typeof p.getVideoMessage === "function") {
          const vm = p.getVideoMessage() || {};
          if (!out.avid && vm.aid) { out.avid = +vm.aid; out.src = out.src || "player.gvm.aid"; }
          if (!out.bvid && vm.bvid) { out.bvid = vm.bvid; out.src = out.src || "player.gvm.bvid"; }
        }
      }
    } catch (e) {}
    // Pinia store（较新 B站）
    try {
      const _s = window.__pinia && window.__pinia._s;
      if (_s) {
        const stores = (_s instanceof Map) ? [..._s.values()] : Object.values(_s);
        for (const st of stores) {
          if (!st) continue;
          if (!out.avid && st.aid) out.avid = +st.aid;
          if (!out.bvid && st.bvid) out.bvid = st.bvid;
          const vd = st.videoData || {};
          if (!out.avid && vd.aid) out.avid = +vd.aid;
          if (!out.bvid && vd.bvid) out.bvid = vd.bvid;
        }
        if (out.avid || out.bvid) out.src = out.src || "pinia";
      }
    } catch (e) {}
    // URL / meta（bvid）
    if (!out.bvid) {
      const cl = document.querySelector('link[rel="canonical"]');
      const ogm = document.querySelector('meta[property="og:url"]');
      const cand = (cl && cl.href) || (ogm && ogm.content) || "";
      const m = cand.match(/\/video\/(BV[0-9A-Za-z]+)/);
      if (m) { out.bvid = m[1]; out.src = out.src || "canonical/og"; }
    }
    if (!out.bvid) {
      const m = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
      if (m) { out.bvid = m[1]; out.src = out.src || "location"; }
    }
    // DOM data-aid
    if (!out.avid) {
      const el = document.querySelector("[data-aid]");
      if (el && el.getAttribute) { const a = +el.getAttribute("data-aid"); if (a) { out.avid = a; out.src = out.src || "data-aid"; } }
    }
    // active 播放列表项
    if (!out.bvid) {
      try {
        const els = document.querySelectorAll('a[href*="/video/BV"]');
        for (let i = els.length - 1; i >= 0; i--) {
          const c = els[i].closest("[class]");
          if (c && /active|current|playing|on\b/.test(c.className)) {
            const mm = els[i].getAttribute("href").match(/\/video\/(BV[0-9A-Za-z]+)/);
            if (mm) { out.bvid = mm[1]; out.src = out.src || "active-item"; break; }
          }
        }
      } catch (e) {}
    }
    return out;
  }

  // 诊断：识别失败时打印页面上到底有什么，便于精准修复
  function readDiag() {
    const cur = readCurrent();
    let dataAid = null;
    try { const el = document.querySelector("[data-aid]"); dataAid = el && el.getAttribute ? el.getAttribute("data-aid") : null; } catch (e) {}
    return {
      avid: cur.avid, bvid: cur.bvid, src: cur.src,
      net: readNetCur(),
      hasIS: !!window.__INITIAL_STATE__,
      hasPlayer: !!window.player,
      hasPinia: !!(window.__pinia && window.__pinia._s),
      dataAid,
      ISkeys: window.__INITIAL_STATE__ ? Object.keys(window.__INITIAL_STATE__).slice(0, 24) : [],
    };
  }

  // 兼容：只要 bvid（ping 展示用）
  function readBvid() {
    const c = readCurrent();
    return c.bvid || "";
  }

  function readTitle() {
    const t = document.title || "";
    const i = t.indexOf("_");
    return i > 0 ? t.slice(0, i) : t;
  }

  // ---- 工具：轻提示 ----
  let toastTimer = null;
  function toast(msg, ms = 2600) {
    let el = document.getElementById("__blbl_toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "__blbl_toast";
      el.style.cssText =
        "position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;" +
        "background:rgba(20,20,24,.92);color:#fff;padding:10px 16px;border-radius:10px;" +
        "font:14px/1.4 system-ui,'Microsoft YaHei',sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35);" +
        "max-width:80vw;pointer-events:none;";
      document.documentElement.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = "none"; }, ms);
  }

  // ---- 收藏夹资源（分页拉全量，建 bvid->avid 映射）----
  let playlistCache = null; // { mediaId, map: {bvid: avid}, order: [bvid] }
  async function fetchPlaylist(mediaId) {
    const all = [];
    let pn = 1;
    while (pn <= 60) {
      let j;
      try {
        const r = await fetch(
          `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${mediaId}&pn=${pn}&ps=20&platform=web&order=mtime`,
          { credentials: "include" }
        );
        j = await r.json();               // 412/风控会返回 HTML，.json() 会抛——catch 住
      } catch (e) { break; }              // 拉不到就停（主流程不依赖它：当前视频靠 net-hook，跳过靠原生下一集）
      if (!j || j.code !== 0) break;      // 非 0（如 -352 风控 / 412）也停
      const m = (j.data && j.data.medias) || [];
      for (const x of m) all.push(x);
      if (m.length < 20) break;
      pn++;
    }
    return all;
  }

  async function ensurePlaylist(mediaId) {
    if (playlistCache && playlistCache.mediaId === mediaId) return playlistCache;
    const medias = await fetchPlaylist(mediaId);
    const map = {}, order = [];
    for (const x of medias) {
      if (x && x.bvid) { map[x.bvid] = x.id; order.push(x.bvid); }
    }
    playlistCache = { mediaId, map, order };
    return playlistCache;
  }

  async function resolveAvid(bvid, mediaId) {
    if (mediaId) {
      const pl = await ensurePlaylist(mediaId);
      if (pl.map[bvid]) return pl.map[bvid];
    }
    // 夹外/未命中：用 view 接口反查 aid
    try {
      const r = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { credentials: "include" });
      const j = await r.json();
      return (j.data && j.data.aid) || 0;
    } catch (e) { return 0; }
  }

  // ---- 取消收藏 ----
  async function unfavorite(mediaId, avid) {
    const csrf = (document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/) || [])[1] || "";
    const r = await fetch("https://api.bilibili.com/x/v3/fav/resource/batch-del", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ media_id: mediaId, resources: `${avid}:2`, csrf }),
    });
    return await r.json();
  }

  // ---- 收藏按钮 UI 同步 ----
  // batch-del 只改服务端，播放器 UI 的收藏态是客户端缓存，不会自动刷新；
  // 且连播页拿不到 window.player。故：驱动 Vue 组件状态 + 直接切 .video-fav 的 on 类。
  function favButtonCandidates() {
    const sels = [
      ".video-toolbar-left-item.video-fav",
      ".video-fav",
      '[title="收藏（E）"]',
      '[class*="favorite"]',
      '[aria-label*="收藏"]',
      '[title*="收藏"]',
    ];
    const set = new Set();
    for (const s of sels) {
      try { document.querySelectorAll(s).forEach(el => set.add(el)); } catch (e) {}
    }
    return [...set];
  }
  // 真实收藏按钮：视频工具栏 .video-fav（title="收藏（E）"）；已收藏高亮 = 带 on 类。
  // 注意：页面右上角还有个 favorite-entry“收藏”入口链接，别混。
  function getFavButton() {
    try {
      return document.querySelector(".video-toolbar-left-item.video-fav")
          || document.querySelector(".video-fav")
          || document.querySelector('[title="收藏（E）"]')
          || null;
    } catch (e) { return null; }
  }
  // 直接切 .video-fav 的 on 类（即时视觉 + 兜底）。
  // 关键：同时同步 Vue2 的 class 跟踪器 el._prevClass——Vue2 重渲时拿"新算出的 class"
  // 跟 _prevClass 做 diff（不是跟真实 className 比）。只改 className 会让 _prevClass 停在旧值，
  // 之后手动收藏触发重渲时 diff 误判"没变"而跳过，导致图标不亮。同步 _prevClass 即可修复。
  function applyFavClass(btn, favored) {
    try {
      const cls = (typeof btn.className === "string") ? btn.className : "";
      const hasOn = /(^|\s)on(\s|$)/.test(cls);
      let next = cls;
      if (favored && !hasOn) next = (cls.trim() + " on").trim();
      else if (!favored && hasOn) next = cls.replace(/(^|\s)on(\s|$)/, " ").replace(/\s+/g, " ").trim();
      if (next !== cls) {
        btn.className = next;
        try { btn._prevClass = next; } catch (e) {}   // 同步 Vue2 class diff 跟踪器
      }
    } catch (e) {}
  }
  // 找到元素所属的 Vue 组件实例：沿 DOM 祖先链向上找（组件实例常挂在组件根元素，
  // 而 .video-fav 可能是嵌套元素，自身不带实例），命中 __vueParentComponent(Vue3)/__vue__(Vue2)。
  function findVueInstance(el) {
    let node = el, depth = 0;
    while (node && depth < 20) {
      const inst = node.__vueParentComponent || node.__vue__;
      if (inst && (inst.setupState || inst.data || inst.proxy || inst.$data)) return inst;
      node = node.parentElement; depth++;
    }
    return null;
  }
  // 在实例状态里找“收藏与否”的布尔响应式属性（ref 有 .value，reactive/data 直接是值）
  function findVueFavRef(inst) {
    if (!inst) return null;
    const states = [];
    try { if (inst.setupState) states.push(inst.setupState); } catch (e) {}
    try { if (inst.data) states.push(inst.data); } catch (e) {}
    const NAME_RE = /fav|collect|favor/i;
    for (const st of states) {
      if (!st) continue;
      for (const key in st) {
        if (!NAME_RE.test(key)) continue;
        const v = st[key];
        const inner = (v && typeof v === "object" && "value" in v) ? v.value : v;
        if (typeof inner === "boolean") {
          return (v && typeof v === "object" && "value" in v) ? { ref: v } : { obj: st, key };
        }
      }
    }
    return null;
  }
  // 尽力把 B站 组件自身的收藏状态改掉，让 Vue 重渲染——这样“之后手动收藏”也能正确联动。
  // Vue2 实测（连播页工具条）：.video-fav 组件有 prop `faved`（是否已收藏），on 类绑定其上；
  // 故沿组件链（自己 + $parent 若干层）把名为 faved/isFav/... 的布尔量设为目标值。
  // 直接写 $props/$data 内部对象可触发 Vue2 响应式（且不产生“避免直接改 prop”的告警）。
  const FAV_BOOL_RE = /^(faved|isFav|favState|favorited|isFavorited|hasFav|fav|collected|isCollected)$/;
  function setVueFavDeep(btn, favored) {
    let v = btn && (btn.__vue__ || btn.__vueParentComponent);
    let depth = 0, hits = 0, levels = 0;
    while (v && depth < 8) {
      levels++;
      const targets = [];
      try { if (v.$props || v._props) targets.push(v.$props || v._props); } catch (e) {}
      try { if (v.$data || v._data) targets.push(v.$data || v._data); } catch (e) {}
      for (const c of targets) {
        for (const k in c) {
          if (!FAV_BOOL_RE.test(k)) continue;
          let val; try { val = c[k]; } catch (e) { continue; }
          if (typeof val !== "boolean") continue;
          if (val === favored) continue;
          try { c[k] = favored; hits++; } catch (e) {}
        }
      }
      v = v.$parent; depth++;
    }
    return { hits, levels };
  }
  function setVueFav(btn, favored) {
    const deep = setVueFavDeep(btn, favored);
    if (deep.hits > 0) return true;
    // 兜底：Vue3 风格（setupState 里的 fav 布尔 ref）
    const inst = findVueInstance(btn);
    const found = findVueFavRef(inst);
    if (!found) return false;
    try {
      if (found.ref) found.ref.value = favored; else found.obj[found.key] = favored;
      return true;
    } catch (e) { return false; }
  }
  // 诊断：沿祖先链报告找到了哪些 Vue 实例、fav 相关键及类型，便于据实补属性名/判断是否 Vue
  function diagVueFav() {
    const btn = getFavButton();
    if (!btn) return { hasButton: false };
    const chain = [];
    let node = btn, depth = 0;
    while (node && depth < 20) {
      const inst = node.__vueParentComponent || node.__vue__;
      chain.push({
        d: depth,
        tag: node.tagName,
        cls: (typeof node.className === "string") ? node.className.slice(0, 40) : "",
        vue: !!inst,
        app: !!node.__vue_app__,
      });
      node = node.parentElement; depth++;
    }
    const inst = findVueInstance(btn);
    if (!inst) return { hasButton: true, hasInstance: false, chain };
    const dump = {};
    [["setupState", inst.setupState], ["data", inst.data]].forEach(([label, st]) => {
      if (!st) return;
      for (const key in st) {
        if (!/fav|collect|favor/i.test(key)) continue;
        const v = st[key];
        const inner = (v && typeof v === "object" && "value" in v) ? v.value : v;
        dump[label + "." + key] = typeof inner;
      }
    });
    // Vue2 组件链：每层名字 + fav 相关布尔量（props/data），定位真正持有"已收藏"状态的层
    const vueChain = [];
    let v = btn && (btn.__vue__ || btn.__vueParentComponent), d = 0;
    while (v && d < 8) {
      const it = { d: d, name: (v.$options && v.$options.name) || "" };
      const containers = [];
      try { if (v.$props || v._props) containers.push(["props", v.$props || v._props]); } catch (e) {}
      try { if (v.$data || v._data) containers.push(["data", v.$data || v._data]); } catch (e) {}
      it.fav = {};
      for (const [label, c] of containers) {
        for (const k in c) {
          if (!/fav|collect|favor|star|like/i.test(k)) continue;
          let val; try { val = c[k]; } catch (e) { continue; }
          it.fav[label + "." + k] = (typeof val === "boolean" || typeof val === "number" || typeof val === "string") ? val : typeof val;
        }
      }
      vueChain.push(it);
      v = v.$parent; d++;
    }
    return { hasButton: true, hasInstance: true, favKeys: dump, chain, vueChain };
  }
  // 按真实收藏态设置按钮：favored=true 点亮，false 熄灭。
  // 连播页里的视频默认都在收藏夹中（应亮）；取消当前一个后应灭；跳到下一个（仍在夹内）应重新亮。
  //
  // 重要：`.video-fav.__vue__` 是页面 Vue 挂的 JS 扩展属性(expando)，**跨 world 不可见**，
  // 隔离世界(content.js)读它恒为 undefined → 改 Vue 状态只能在 MAIN world 的 net-hook.js 做。
  // 故此处通过 DOM 事件/属性（两世界共享）桥接，让 net-hook 执行真正的同步。
  function setFavButton(favored) {
    const btn = getFavButton();
    if (!btn) return { found: false, changed: false };
    const mainReady = document.documentElement.getAttribute("data-blbl-main") === "1";
    if (mainReady) {
      try {
        document.documentElement.setAttribute("data-blbl-fav-sync", favored ? "1" : "0");
        // 必须 bubbles:true —— net-hook 的监听器挂在 document 上，
        // 不冒泡的话从 documentElement 派发的事件永远传不到 document。
        document.dispatchEvent(new CustomEvent("blbl-fav-sync", { bubbles: true }));
        // 隔离世界顺带切一次 on 类（即时视觉；Vue 状态由主世界改）
        applyFavClass(btn, favored);
        return { found: true, changed: true, via: "main-world" };
      } catch (e) { /* 落回本地兜底 */ }
    }
    // 兜底：net-hook 未就绪时，本地尽力（仅能改 DOM，改不到 Vue 状态）
    const vueOk = setVueFav(btn, favored);
    applyFavClass(btn, favored);
    return { found: true, changed: true, via: vueOk ? "vue+class" : "class" };
  }
  // 诊断：导出收藏按钮的标签/类/关键属性，便于按实际 DOM 精准修
  function diagFavButton() {
    const els = favButtonCandidates();
    return els.slice(0, 4).map(el => {
      let html = "";
      try { html = el.outerHTML ? el.outerHTML.slice(0, 300) : ""; } catch (e) {}
      return {
        tag: el.tagName, cls: (typeof el.className === "string") ? el.className : "",
        ariaPressed: el.getAttribute && el.getAttribute("aria-pressed"),
        ariaChecked: el.getAttribute && el.getAttribute("aria-checked"),
        html,
      };
    });
  }

  // 广谱诊断：按“类名/文字/aria”多路扫描，导出真正的收藏按钮 DOM，供精准修
  function diagFavoriteAll() {
    const out = [];
    const seen = new Set();
    const push = (el, why) => {
      if (!el || seen.has(el) || out.length >= 10) return;
      seen.add(el);
      let html = "";
      try { html = el.outerHTML ? el.outerHTML.slice(0, 360) : ""; } catch (e) {}
      out.push({
        why,
        tag: el.tagName,
        cls: (typeof el.className === "string") ? el.className : "",
        text: (el.textContent || "").trim().slice(0, 30),
        ariaLabel: el.getAttribute && el.getAttribute("aria-label"),
        ariaPressed: el.getAttribute && el.getAttribute("aria-pressed"),
        html,
      });
    };
    // 1) 类名含 fav/favorite（大小写不敏感，用多种写法兜底）
    ["[class*='favorite']", "[class*='fav']", "[class*='Fav']", "[class*='Favorite']"].forEach(s => {
      try { document.querySelectorAll(s).forEach(el => push(el, "cls~fav")); } catch (e) {}
    });
    // 2) 文字含“收藏/已收藏”
    try {
      document.querySelectorAll("button, [role='button'], [class*='btn'], [class*='control'], [class*='ctrl'], li, span, div").forEach(el => {
        const t = (el.textContent || "").replace(/\s+/g, "");
        if (t === "收藏" || t === "已收藏" || t.includes("取消收藏")) push(el, "text=收藏");
      });
    } catch (e) {}
    // 3) aria-label / title 含“收藏”
    ["[aria-label*='收藏']", "[title*='收藏']"].forEach(s => {
      try { document.querySelectorAll(s).forEach(el => push(el, "aria/title")); } catch (e) {}
    });
    // 4) 播放器控制条里的按钮（兜底，按 next 按钮的兄弟找）
    try {
      const next = document.querySelector(".bpx-player-ctrl-next");
      if (next && next.parentElement) {
        next.parentElement.querySelectorAll("[class]").forEach(el => push(el, "ctrlbar-sibling"));
      }
    } catch (e) {}
    return out;
  }


  // ---- 下一个 ----
  function clickNativeNext() {
    const b = document.querySelector(".bpx-player-ctrl-next");
    if (b && !b.disabled) { b.click(); return true; }
    return false;
  }

  async function goNext() {
    if (clickNativeNext()) return { ok: true, via: "native" };
    // 兜底：从收藏夹顺序算下一个 BV 并导航
    const mediaId = getMediaId();
    const cur = readBvid();
    if (mediaId && cur) {
      try {
        const pl = await ensurePlaylist(mediaId);
        const idx = pl.order.indexOf(cur);
        if (idx >= 0 && idx + 1 < pl.order.length) {
          location.href = `https://www.bilibili.com/video/${pl.order[idx + 1]}/`;
          return { ok: true, via: "nav" };
        }
        if (idx === pl.order.length - 1) return { ok: false, reason: "end" };
      } catch (e) {}
    }
    return { ok: false, reason: "no-next" };
  }

  // ---- 三个动作 ----
  async function doSkip() {
    const r = await goNext();
    // 跳到下一个（连播页里仍在收藏夹中）→ 收藏图标设“亮”
    if (r && r.ok) setFavButton(true);
    toast(r.ok ? "⏭ 已跳过 → 下一个" : (r.reason === "end" ? "已到收藏夹末尾" : "未找到下一个（请从收藏夹「播放全部」进入）"));
    return r;
  }

  async function doUnfav() {
    const mediaId = getMediaId();
    if (!mediaId) { toast("⚠ 请在收藏夹连播页使用（收藏夹里点「播放全部」）"); return { ok: false }; }
    const cur = readCurrent();
    let avid = cur.avid, bvid = cur.bvid;
    // 有 bvid 无 avid：用播放列表映射 / view 反查
    if (!avid && bvid) avid = await resolveAvid(bvid, mediaId);
    // 有 avid 无 bvid：从播放列表反查 bvid（仅用于显示，查不到不影响删除）
    if (avid && !bvid) {
      try {
        const pl = await ensurePlaylist(mediaId);
        for (const b in pl.map) { if (pl.map[b] === avid) { bvid = b; break; } }
      } catch (e) {}
    }
    if (!avid) {
      const d = readDiag();
      console.warn("[BLBL] 识别失败诊断:", d);
      toast(`⚠ 未能识别当前视频(avid)。诊断: ${JSON.stringify(d).slice(0, 180)}`, 6000);
      return { ok: false };
    }
    let res;
    try {
      res = await unfavorite(mediaId, avid);
    } catch (e) {
      toast("取消收藏请求失败：" + e); return { ok: false };
    }
    if (res && res.code === 0) {
      // 清理缓存中该项，后续「下一个」顺序自动前移
      if (playlistCache && bvid) { delete playlistCache.map[bvid]; playlistCache.order = playlistCache.order.filter(b => b !== bvid); }
      // 同步播放器收藏按钮：当前视频已移除 → 图标设“灭”
      const sync = setFavButton(false);
      // 仅在没能熄灭时打印诊断（正常成功不打，减少噪音）
      const fb = getFavButton();
      if (!sync.found) {
        console.warn("[BLBL] 未找到 .video-fav 收藏按钮，UI 可能仍显示已收藏。候选举=", diagFavoriteAll());
      } else if (fb && /(^|\s)on(\s|$)/.test(fb.className || "")) {
        console.warn("[BLBL] .video-fav 仍带 on(未熄灭)。候选举=", diagFavoriteAll(), " vueFav=", diagVueFav());
      } else if (sync.via === "class") {
        // 灭是灭了，但没驱动到 Vue 状态——手动收藏可能不联动；打印 Vue fav 键供补属性名
        console.info("[BLBL] 已灭但未驱动 Vue 状态（手动收藏联动存疑）。vueFav=", diagVueFav());
      }
      toast(`✅ 已取消收藏 ${bvid || ("av" + avid)}${sync.found && sync.changed ? "（按钮已熄灭）" : ""}`);
      return { ok: true, bvid: bvid || String(avid), avid, sync };
    }
    toast(`取消收藏失败 code=${res && res.code} ${(res && res.message) || ""}（请确认已登录）`);
    return { ok: false };
  }

  async function doUnfavSkip() {
    await doUnfav();
    const r = await goNext();
    // 跳到下一个（仍在收藏夹内）→ 图标设“亮”
    if (r && r.ok) setFavButton(true);
    return r;
  }

  // ---- 消息入口 ----
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        const action = msg && msg.action;
        if (action === "skip") { await doSkip(); sendResponse({ ok: true }); }
        else if (action === "unfav") { const r = await doUnfav(); sendResponse(r); }
        else if (action === "unfav_skip") { await doUnfavSkip(); sendResponse({ ok: true }); }
        else if (action === "ping") {
          sendResponse({ ok: true, mediaId: getMediaId(), bvid: readBvid(), title: readTitle() });
        } else {
          sendResponse({ ok: false, error: "unknown-action" });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // 异步 sendResponse
  });

  // ---- 初始化：快捷键 ----
  loadBindings();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.blblBindings) {
        bindings = { ...DEFAULT_BINDINGS, ...changes.blblBindings.newValue };
      }
    });
  } catch (e) {}
  // capture 阶段注册，先于页面/播放器处理；全屏时事件仍途经 window→document→target
  window.addEventListener("keydown", handleKey, true);

  // 调试/测试导出（浏览器中仅多一个全局引用，无副作用）
  window.__blblAssistantAPI = {
    getMediaId, readBvid, readCurrent, readDiag, readTitle, goNext, doSkip, doUnfav, doUnfavSkip,
    parseBinding, matchBinding, handleKey, loadBindings,
    favButtonCandidates, getFavButton, applyFavClass, findVueInstance, findVueFavRef, setVueFav, setVueFavDeep,
    setFavButton, diagFavButton, diagFavoriteAll, diagVueFav,
    DEFAULT_BINDINGS, getBindings: () => ({ ...bindings }),
  };
})();
