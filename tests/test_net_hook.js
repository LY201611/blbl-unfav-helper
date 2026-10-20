// net-hook.js 单测（node 打桩 window/document/fetch/XHR，验证 MAIN world 嗅探逻辑）
const path = require("path");
const NET = path.join(__dirname, "..", "extension", "net-hook.js");

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? "PASS" : "FAIL") + " " + name + (cond ? "" : "  << " + (extra || "")));
  if (!cond) fails++;
}

// 伪 DOM 元素（支持 className/classList + 挂 __vue__ 等扩展属性）
function fakeEl(opts) {
  opts = opts || {};
  const classes = new Set((opts.cls || "").split(/\s+/).filter(Boolean));
  const el = {
    tagName: opts.tag || "DIV",
    get className() { return [...classes].join(" "); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
    classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    parentElement: null,
  };
  if (opts.vue) el.__vue__ = opts.vue;
  return el;
}

// 每次全新加载：重置全局与补丁，避免重复包裹 fetch/XHR
function loadFresh() {
  const domAttr = {};
  const listeners = {};
  global.window = global;
  global.__blblNetInstalled = false;
  global.document = {
    documentElement: {
      setAttribute: (k, v) => { domAttr[k] = v; },
      getAttribute: (k) => (k in domAttr ? domAttr[k] : null),
      dispatchEvent: (ev) => { (listeners[ev && ev.type] || []).forEach(fn => fn(ev)); return true; },
    },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent: (ev) => { (listeners[ev && ev.type] || []).forEach(fn => fn(ev)); return true; },
    querySelector: (sel) => (global.__favBtn && (sel === ".video-toolbar-left-item.video-fav" || sel === ".video-fav" || sel === '[title="收藏（E）"]')) ? global.__favBtn : null,
  };
  global.__domAttr = domAttr;
  global.__listeners = listeners;
  const origFetch = (...a) => Promise.resolve({ ok: true });
  global.fetch = origFetch;
  global.XMLHttpRequest = function () {};
  global.XMLHttpRequest.prototype.open = function () { /* noop */ };
  delete require.cache[require.resolve(NET)];
  require(NET);
  return { origFetch };
}

(function () {
  let ctx = loadFresh();
  check("注入后设置 __blblNetInstalled", global.__blblNetInstalled === true);
  check("暴露 __blblNetCapture/__blblNetCur", typeof global.__blblNetCapture === "function" && typeof global.__blblNetCur === "function");

  // 1) capture：playurl 带 bvid
  let cur = global.__blblNetCapture("https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1abc123&cid=999&qn=64");
  check("capture playurl bvid", cur.bvid === "BV1abc123", JSON.stringify(cur));
  check("capture 写入 data-blbl-cur", /BV1abc123/.test(global.__domAttr["data-blbl-cur"] || ""), global.__domAttr["data-blbl-cur"]);

  // 2) capture：avid 形式（无 bvid）
  ctx = loadFresh();
  cur = global.__blblNetCapture("https://api.bilibili.com/x/player/playurl?avid=456789&cid=1");
  check("capture avid(无bvid) -> aid=456789", cur.aid === 456789 && cur.bvid === "", JSON.stringify(cur));

  // 3) 同请求同时带 aid+bvid → 一并取
  ctx = loadFresh();
  cur = global.__blblNetCapture("https://api.bilibili.com/x/player/playurl?bvid=BV1zzz&avid=111222&cid=1");
  check("capture bvid+avid 同请求", cur.bvid === "BV1zzz" && cur.aid === 111222, JSON.stringify(cur));

  // 4) 避免串视频：先 bvid=BVA，再 aid-only 请求不应污染（保留 bvid、不改 aid 之外）
  ctx = loadFresh();
  global.__blblNetCapture("https://api.bilibili.com/x/player/playurl?bvid=BV1AAA&cid=1");
  cur = global.__blblNetCapture("https://api.bilibili.com/x/player/playurl?avid=999999&cid=2"); // 只有 aid，且已有 bvid
  check("已有 bvid 时 aid-only 不覆盖", cur.bvid === "BV1AAA" && cur.aid === 0, JSON.stringify(cur));
  // 新 bvid 请求整体替换（aid 复位，避免混上一个视频的 aid）
  cur = global.__blblNetCapture("https://api.bilibili.com/x/player/playurl?bvid=BV1BBB&cid=3");
  check("新 bvid 整体替换(aid复位)", cur.bvid === "BV1BBB" && cur.aid === 0, JSON.stringify(cur));

  // 5) 无关 URL 不捕获
  ctx = loadFresh();
  cur = global.__blblNetCapture("https://api.bilibili.com/x/v3/fav/resource/list?media_id=1683373112&pn=1");
  check("无关 URL(media_id) 不捕获", cur.bvid === "" && cur.aid === 0, JSON.stringify(cur));

  // 6) fetch 被劫持：调用页面 fetch 会触发 capture
  ctx = loadFresh();
  global.fetch("https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1fetch01&cid=1");
  check("hook fetch 捕获 bvid", global.__blblNetCur().bvid === "BV1fetch01", JSON.stringify(global.__blblNetCur()));

  // 7) fetch 传 Request 对象（input.url）
  ctx = loadFresh();
  global.fetch({ url: "https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1reqobj&cid=1" });
  check("hook fetch(Request.url) 捕获", global.__blblNetCur().bvid === "BV1reqobj", JSON.stringify(global.__blblNetCur()));

  // 8) XHR.open 被劫持
  ctx = loadFresh();
  const xhr = new global.XMLHttpRequest();
  xhr.open("GET", "https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1xhr99&cid=1");
  check("hook XHR.open 捕获 bvid", global.__blblNetCur().bvid === "BV1xhr99", JSON.stringify(global.__blblNetCur()));

  // ---- 收藏按钮 UI 同步（必须在 MAIN world：__vue__ 是 expando，隔离世界看不到）----
  ctx = loadFresh();
  check("安装后标记 data-blbl-main=1", global.document.documentElement.getAttribute("data-blbl-main") === "1");
  check("暴露 __blblSyncFavUI / __blblFavDiag", typeof global.__blblSyncFavUI === "function" && typeof global.__blblFavDiag === "function");

  const parentVm = { $data: { faved: true }, $props: {} };
  const favBtn = fakeEl({
    cls: "video-fav video-toolbar-left-item on",
    vue: { $props: { faved: true, favedWhenEnter: true, favSignal: 0 }, $data: {}, $parent: parentVm },
  });
  global.__favBtn = favBtn;
  ctx = loadFresh();
  global.__favBtn = favBtn;
  let r = global.__blblSyncFavUI(false);
  check("syncFavUI 熄灭：prop faved=false", favBtn.__vue__.$props.faved === false, String(favBtn.__vue__.$props.faved));
  check("syncFavUI 熄灭：父层 $data.faved=false", parentVm.$data.faved === false, String(parentVm.$data.faved));
  check("syncFavUI 熄灭：移除 on 类", !favBtn.classList.contains("on"), favBtn.className);
  check("syncFavUI 熄灭：同步 _prevClass", !/(^|\s)on(\s|$)/.test(favBtn._prevClass || ""), String(favBtn._prevClass));
  check("syncFavUI 不误改 favedWhenEnter", favBtn.__vue__.$props.favedWhenEnter === true, String(favBtn.__vue__.$props.favedWhenEnter));
  r = global.__blblSyncFavUI(true);
  check("syncFavUI 点亮：prop faved=true", favBtn.__vue__.$props.faved === true && parentVm.$data.faved === true);
  check("syncFavUI 点亮：加回 on 类", favBtn.classList.contains("on"), favBtn.className);
  check("syncFavUI 返回 hits>0", r && r.hits > 0, JSON.stringify(r));

  // DOM 事件桥接：content.js(隔离世界) 通过属性+事件触发主世界同步
  // 从 document 派发（content.js 隔离世界的真实做法，带 bubbles）
  global.document.documentElement.setAttribute("data-blbl-fav-sync", "0");
  global.document.dispatchEvent({ type: "blbl-fav-sync" });
  check("document 派发可触发熄灭", favBtn.__vue__.$props.faved === false && !favBtn.classList.contains("on"), favBtn.className);
  global.document.documentElement.setAttribute("data-blbl-fav-sync", "1");
  global.document.dispatchEvent({ type: "blbl-fav-sync" });
  check("document 派发可触发点亮", favBtn.__vue__.$props.faved === true && favBtn.classList.contains("on"), favBtn.className);
  // 从 documentElement 派发（双保险监听）
  global.document.documentElement.setAttribute("data-blbl-fav-sync", "0");
  global.document.documentElement.dispatchEvent({ type: "blbl-fav-sync" });
  check("documentElement 派发亦可触发", favBtn.__vue__.$props.faved === false && !favBtn.classList.contains("on"), favBtn.className);

  // 诊断
  const dg = global.__blblFavDiag();
  check("__blblFavDiag 返回 cls/hasVue/chain", dg.hasBtn === true && dg.hasVue === true && Array.isArray(dg.chain) && dg.chain.length >= 1, JSON.stringify(dg).slice(0, 160));
  check("__blblFavDiag 含 props.faved", dg.chain[0].fav && "props.faved" in dg.chain[0].fav, JSON.stringify(dg.chain[0].fav));

  // 无按钮时不崩
  ctx = loadFresh();
  global.__favBtn = null;
  const rNone = global.__blblSyncFavUI(false);
  check("无收藏按钮时安全返回", rNone && rNone.ok === false, JSON.stringify(rNone));

  console.log("\nRESULT: " + (fails === 0 ? "ALL PASS" : fails + " FAIL"));
  process.exit(fails === 0 ? 0 : 1);
})();
