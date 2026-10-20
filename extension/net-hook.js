// BLBL 取消收藏助手 · 网络嗅探（MAIN world，document_start 注入）
// 背景：部分 B站连播页不暴露 __INITIAL_STATE__ / player / pinia，DOM 也无 data-aid，
//       导致读不到「当前播放视频」。但播放器播放/切换视频时必然请求带 bvid/avid 的接口
//       （如 x/player/.../playurl?bvid=BVxx&cid=..）。此处 hook 页面 fetch/XHR，
//       抓最近一次含 bvid/avid 的请求，写入 <html data-blbl-cur>，供隔离世界 content.js 读取。
// 注意：本文件运行在页面的 MAIN world（manifest world:"MAIN"），不能使用 chrome.* API。
(function () {
  if (window.__blblNetInstalled) return;
  window.__blblNetInstalled = true;

  let cur = { aid: 0, bvid: "", ts: 0 };

  function matchBvid(u) {
    let m = u.match(/[?&]bvid=(BV[0-9A-Za-z]+)/);
    if (m) return m[1];
    m = u.match(/\/video\/(BV[0-9A-Za-z]+)/);
    return m ? m[1] : "";
  }
  function matchAid(u) {
    let m = u.match(/[?&]aid=(\d{3,})/);
    if (m) return +m[1];
    m = u.match(/[?&]avid=(\d{3,})/);
    return m ? +m[1] : 0;
  }

  // 抓到含 bvid 的请求 → 整体替换 cur（同一请求里若带 aid 一并取）；
  // 只有 aid 的请求 → 仅在没有 bvid 时兜底。避免把不同视频的 aid/bvid 混在一起。
  function capture(url) {
    try {
      const u = typeof url === "string" ? url : (url && url.url) || String(url || "");
      const bvid = matchBvid(u);
      const aid = matchAid(u);
      if (bvid) {
        cur = { aid: aid || 0, bvid: bvid, ts: Date.now() };
        writeDom();
      } else if (aid && !cur.bvid) {
        cur = { aid: aid, bvid: "", ts: Date.now() };
        writeDom();
      }
    } catch (e) {}
    return cur;
  }

  function writeDom() {
    try {
      document.documentElement.setAttribute("data-blbl-cur", JSON.stringify(cur));
    } catch (e) {}
  }

  // hook fetch
  try {
    const of = window.fetch;
    if (typeof of === "function") {
      window.fetch = function () {
        try {
          const input = arguments[0];
          capture(input && input.url ? input.url : input);
        } catch (e) {}
        return of.apply(this, arguments);
      };
    }
  } catch (e) {}
  // hook XHR
  try {
    const oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function () {
      try { capture(arguments[1]); } catch (e) {}
      return oo.apply(this, arguments);
    };
  } catch (e) {}

  // ---- 收藏按钮 UI 同步（必须在 MAIN world 做）----
  // 关键：Vue 把实例挂在 DOM 元素的 __vue__ 上，这是「JS 扩展属性(expando)」，
  // 跨 world 不可见——隔离世界的 content.js 读它永远是 undefined。
  // 所以改 Vue2 的 faved prop / _prevClass 必须在本文件（MAIN world）执行。
  const FAV_BOOL_RE = /^(faved|isFav|favState|favorited|isFavorited|hasFav|fav|collected|isCollected)$/;
  function getFavBtn() {
    return document.querySelector(".video-toolbar-left-item.video-fav")
        || document.querySelector(".video-fav")
        || document.querySelector('[title="收藏（E）"]')
        || null;
  }
  function syncFavUI(favored) {
    const btn = getFavBtn();
    if (!btn) return { ok: false, reason: "no-btn" };
    let hits = 0, levels = 0;
    // 1) 驱动 Vue2 组件链上的「是否已收藏」布尔量（自身 $props.faved + $parent 各层）
    let v = btn.__vue__ || btn.__vueParentComponent, d = 0;
    while (v && d < 8) {
      levels++;
      let levelHits = 0;
      const targets = [];
      try { if (v.$props || v._props) targets.push(v.$props || v._props); } catch (e) {}
      try { if (v.$data || v._data) targets.push(v.$data || v._data); } catch (e) {}
      for (const c of targets) {
        for (const k in c) {
          if (!FAV_BOOL_RE.test(k)) continue;
          let val; try { val = c[k]; } catch (e) { continue; }
          if (typeof val !== "boolean" || val === favored) continue;
          try { c[k] = favored; hits++; levelHits++; } catch (e) {}
        }
      }
      // 写完强制该层重渲染（否则可能只改了值、界面不跟着变）
      if (levelHits > 0) { try { if (typeof v.$forceUpdate === "function") v.$forceUpdate(); } catch (e) {} }
      v = v.$parent; d++;
    }
    // 2) 切 on 类，并同步 Vue2 的 class diff 跟踪器 _prevClass
    const cls = (typeof btn.className === "string") ? btn.className : "";
    const hasOn = /(^|\s)on(\s|$)/.test(cls);
    let next = cls;
    if (favored && !hasOn) next = (cls.trim() + " on").trim();
    else if (!favored && hasOn) next = cls.replace(/(^|\s)on(\s|$)/, " ").replace(/\s+/g, " ").trim();
    if (next !== cls) {
      btn.className = next;
      try { btn._prevClass = next; } catch (e) {}
    }
    return { ok: true, hits: hits, levels: levels, cls: btn.className };
  }
  // 诊断：按钮类/__vue__/组件链各层 fav 布尔量（F12 主世界可直接调用）
  window.__blblFavDiag = function () {
    const btn = getFavBtn();
    if (!btn) return { hasBtn: false };
    const out = { hasBtn: true, cls: btn.className, prevClass: btn._prevClass, hasVue: !!btn.__vue__ };
    const chain = []; let v = btn.__vue__, d = 0;
    while (v && d < 8) {
      const it = { d: d, name: (v.$options && v.$options.name) || "" };
      const src = [];
      try { if (v.$props || v._props) src.push(["props", v.$props || v._props]); } catch (e) {}
      try { if (v.$data || v._data) src.push(["data", v.$data || v._data]); } catch (e) {}
      it.fav = {};
      for (const [lb, c] of src) {
        for (const k in c) {
          if (!/fav|collect|favor/i.test(k)) continue;
          let val; try { val = c[k]; } catch (e) { continue; }
          it.fav[lb + "." + k] = (typeof val === "boolean" || typeof val === "number" || typeof val === "string") ? val : typeof val;
        }
      }
      chain.push(it); v = v.$parent; d++;
    }
    out.chain = chain;
    return out;
  };
  window.__blblSyncFavUI = syncFavUI;

  // 供隔离世界 content.js 通过 DOM 事件/属性触发（DOM 是两世界共享的桥梁）
  function markInstalled() {
    try { document.documentElement.setAttribute("data-blbl-main", "1"); } catch (e) {}
  }
  markInstalled();
  document.addEventListener("DOMContentLoaded", markInstalled);
  const onFavSync = function () {
    const favored = document.documentElement.getAttribute("data-blbl-fav-sync") === "1";
    syncFavUI(favored);
  };
  // 双保险：document 与 documentElement 都监听（兼容不同派发目标/是否冒泡）
  document.addEventListener("blbl-fav-sync", onFavSync);
  try { document.documentElement.addEventListener("blbl-fav-sync", onFavSync); } catch (e) {}

  // 调试/测试导出（MAIN world 内）
  window.__blblNetCapture = capture;
  window.__blblNetCur = function () { return cur; };
})();
