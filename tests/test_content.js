// content.js 逻辑单测（node + DOM/fetch 打桩，不发真实网络）
// 注意：本文件放在项目 tests/ 下，不能放 extension/ 内——
//       Edge 禁止加载含 "_" 开头文件名的扩展目录。
const path = require("path");
const CONTENT = path.join(__dirname, "..", "extension", "content.js");

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? "PASS" : "FAIL") + " " + name + (cond ? "" : "  << " + (extra || "")));
  if (!cond) fails++;
}

// 伪元素：支持 className/classList/getAttribute/setAttribute/querySelectorAll
function fakeEl(opts) {
  opts = opts || {};
  const classes = new Set((opts.cls || "").split(/\s+/).filter(Boolean));
  const attrs = Object.assign({}, opts.attrs || {});
  const children = opts.children || [];
  const el = {
    tagName: opts.tag || "DIV",
    parentElement: opts.parent || null,
    textContent: opts.text || "",
    outerHTML: opts.html || "",
    get className() { return [...classes].join(" "); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
    classList: {
      contains: (c) => classes.has(c),
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
    },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    hasAttribute: (k) => k in attrs,
    querySelectorAll: (sel) => children,
  };
  if (opts.vue) el.__vueParentComponent = opts.vue;   // Vue3: { setupState:{ isFav:{value:true}, ... } }
  if (opts.vue2) el.__vue__ = opts.vue2;              // Vue2: { data:{ isFav:true, ... } }
  return el;
}

function makeEnv(env) {
  const qs = (sel) => {
    if (sel === 'link[rel="canonical"]') return env.canonical || null;
    if (sel === 'meta[property="og:url"]') return env.og || null;
    if (sel === ".bpx-player-ctrl-next") return env.nextBtn || null;
    if (sel === "[data-aid]") return env.dataAid ? { getAttribute: () => env.dataAid } : null;
    if (sel === ".video-toolbar-left-item.video-fav" || sel === ".video-fav" || sel === '[title="收藏（E）"]') return env.favButton || null;
    return null;
  };
  const isFavSel = (sel) => /favorite|fav[-_]|收藏/.test(sel);
  const qsa = (sel) => {
    if (sel === 'a[href*="/video/BV"]') return env.activeEls || [];
    if (isFavSel(sel)) return env.favButtons || [];
    return [];
  };
  const el = () => ({ style: {}, textContent: "", });
  global.window = global;
  global.__INITIAL_STATE__ = env.state || undefined;
  global.player = env.player || undefined;
  global.__pinia = env.pinia || undefined;
  global.document = {
    title: env.title || "",
    cookie: env.cookie || "",
    getElementById: () => null,
    querySelector: qs,
    querySelectorAll: qsa,
    createElement: el,
    dispatchEvent: (ev) => { global.__dispatched.push(ev && ev.type); global.__dispatchedEv = ev; return true; },
    documentElement: (function () {
      const attrs = {};
      return {
        appendChild: () => {},
        attrs: attrs,
        getAttribute: (name) => {
          if (name === "data-blbl-cur") return env.netCurRaw || null;
          if (name === "data-blbl-main") return env.mainReady ? "1" : null;
          return (name in attrs) ? attrs[name] : null;
        },
        setAttribute: (k, v) => { attrs[k] = String(v); },
        dispatchEvent: (ev) => { global.__dispatched.push(ev && ev.type); global.__dispatchedEv = ev; return true; },
      };
    })(),
  };
  global.__dispatched = [];
  if (typeof global.CustomEvent !== "function") {
    global.CustomEvent = function (type) { this.type = type; };
  }
  global.location = { pathname: env.pathname || "/", href: "" };
  let capturedListener = null;
  global.__listeners = [];
  global.addEventListener = (type, fn, cap) => { global.__listeners.push({ type, fn, cap }); };
  global.chrome = {
    runtime: { onMessage: { addListener: (fn) => { capturedListener = fn; } } },
    storage: {
      sync: { get: (k, cb) => cb((env.storage && env.storage[k]) ? { [k]: env.storage[k] } : {}) },
      onChanged: { addListener: () => {} },
    },
  };
  global.__capturedListener = () => capturedListener;
  global.__fetchCalls = [];
  global.fetch = (url, opts) => {
    global.__fetchCalls.push({ url, opts });
    let body;
    if (/fav\/resource\/list/.test(url)) {
      body = { code: 0, data: { medias: env.medias || [] } };
    } else if (/batch-del/.test(url)) {
      body = { code: env.delCode === undefined ? 0 : env.delCode, message: env.delMsg || "0" };
    } else if (/view\?bvid=/.test(url)) {
      body = { code: 0, data: { aid: env.viewAid || 0 } };
    } else {
      body = { code: 0, data: {} };
    }
    return Promise.resolve({ json: () => Promise.resolve(body) });
  };
}

function loadFresh(env) {
  makeEnv(env);
  global.__blblAssistant = false;
  delete require.cache[require.resolve(CONTENT)];
  require(CONTENT);
  return global.__blblAssistantAPI;
}

(async () => {
  let api = loadFresh({ pathname: "/list/ml1683373112" });
  check("getMediaId 列表页 -> 1683373112", api.getMediaId() === "1683373112", api.getMediaId());
  api = loadFresh({ pathname: "/video/BV1xx411c7xA/" });
  check("getMediaId 视频页 -> null", api.getMediaId() === null, String(api.getMediaId()));

  api = loadFresh({ pathname: "/list/ml1", canonical: { href: "https://www.bilibili.com/video/BV1CANON01/" } });
  check("readBvid canonical", api.readBvid() === "BV1CANON01", api.readBvid());
  api = loadFresh({ pathname: "/list/ml1", state: { videoData: { bvid: "BV1STATE02" } } });
  check("readBvid state 回退", api.readBvid() === "BV1STATE02", api.readBvid());
  api = loadFresh({ pathname: "/list/ml1", og: { content: "https://www.bilibili.com/video/BV1OGURL03/" } });
  check("readBvid og:url 回退", api.readBvid() === "BV1OGURL03", api.readBvid());
  api = loadFresh({ pathname: "/video/BV1LOCAT04/" });
  check("readBvid location 回退", api.readBvid() === "BV1LOCAT04", api.readBvid());
  api = loadFresh({ pathname: "/list/ml1" });
  check("readBvid 全无 -> 空", api.readBvid() === "", JSON.stringify(api.readBvid()));

  // ---- readCurrent：avid 多源（连播页关键，batch-del 需要 avid）----
  api = loadFresh({ pathname: "/list/ml1", state: { aid: 999 } });
  check("readCurrent IS.aid -> 999", api.readCurrent().avid === 999, JSON.stringify(api.readCurrent()));
  api = loadFresh({ pathname: "/list/ml1", state: { videoData: { aid: 888, bvid: "BV1VD" } } });
  check("readCurrent videoData.aid+bvid", api.readCurrent().avid === 888 && api.readCurrent().bvid === "BV1VD", JSON.stringify(api.readCurrent()));
  api = loadFresh({ pathname: "/list/ml1", player: { aid: 777 } });
  check("readCurrent player.aid -> 777", api.readCurrent().avid === 777, JSON.stringify(api.readCurrent()));
  api = loadFresh({ pathname: "/list/ml1", dataAid: "555" });
  check("readCurrent data-aid -> 555", api.readCurrent().avid === 555, JSON.stringify(api.readCurrent()));
  api = loadFresh({ pathname: "/list/ml1", pinia: { _s: new Map([["video", { aid: 444, bvid: "BV1PIN" }]]) } });
  check("readCurrent pinia(Map) -> 444", api.readCurrent().avid === 444, JSON.stringify(api.readCurrent()));
  // net-hook（MAIN world 写 <html data-blbl-cur>）为首选源
  api = loadFresh({ pathname: "/list/ml1", netCurRaw: JSON.stringify({ aid: 0, bvid: "BV1NET", ts: 1 }) });
  check("readCurrent net-hook bvid", api.readCurrent().bvid === "BV1NET" && api.readCurrent().src === "net-hook", JSON.stringify(api.readCurrent()));
  api = loadFresh({ pathname: "/list/ml1", netCurRaw: JSON.stringify({ aid: 321, bvid: "BV1NET", ts: 1 }), state: { aid: 999 } });
  check("readCurrent net-hook avid 优先于 IS", api.readCurrent().avid === 321 && api.readCurrent().src === "net-hook", JSON.stringify(api.readCurrent()));
  api = loadFresh({ pathname: "/list/ml1" });
  check("readDiag 结构完整", (() => { const d = api.readDiag(); return typeof d.hasIS === "boolean" && typeof d.hasPlayer === "boolean" && Array.isArray(d.ISkeys); })(), JSON.stringify(api.readDiag()));

  const medias = [
    { id: 11, bvid: "BV1AAA" }, { id: 22, bvid: "BV1BBB" }, { id: 33, bvid: "BV1CCC" },
  ];
  api = loadFresh({
    pathname: "/list/ml1683373112", canonical: { href: "https://www.bilibili.com/video/BV1AAA/" },
    medias, nextBtn: null,
  });
  let r = await api.goNext();
  check("goNext 无原生按钮 -> 导航", r.via === "nav", JSON.stringify(r));
  check("goNext 导航到 BV1BBB", /\/video\/BV1BBB\//.test(global.location.href), global.location.href);

  api = loadFresh({
    pathname: "/list/ml1683373112", canonical: { href: "https://www.bilibili.com/video/BV1CCC/" },
    medias, nextBtn: null,
  });
  r = await api.goNext();
  check("goNext 末尾 -> end", r.ok === false && r.reason === "end", JSON.stringify(r));

  let clicked = false;
  api = loadFresh({ pathname: "/list/ml1", nextBtn: { disabled: false, click: () => { clicked = true; } } });
  r = await api.goNext();
  check("goNext 原生按钮 clicked", clicked && r.via === "native", JSON.stringify(r));

  api = loadFresh({
    pathname: "/list/ml1683373112", canonical: { href: "https://www.bilibili.com/video/BV1AAA/" },
    medias, cookie: "SESSDATA=abc; bili_jct=TESTCSRF; x=1",
  });
  const ures = await api.doUnfav();
  check("doUnfav 成功", ures.ok === true && ures.bvid === "BV1AAA", JSON.stringify(ures));
  const delCall = global.__fetchCalls.find((c) => /batch-del/.test(c.url));
  check("调用了 batch-del", !!delCall);
  const bodyStr = delCall ? delCall.opts.body.toString() : "";
  check("body media_id=1683373112", /media_id=1683373112/.test(bodyStr), bodyStr);
  check("body resources=11:2(avid:type)", /resources=11%3A2/.test(bodyStr), bodyStr);
  check("body csrf=TESTCSRF", /csrf=TESTCSRF/.test(bodyStr), bodyStr);
  check("credentials include", delCall.opts.credentials === "include");

  // 仅有 avid（无 bvid）也能取消收藏——连播页常见：只暴露 aid 不暴露 bvid
  api = loadFresh({
    pathname: "/list/ml1683373111", state: { aid: 11 },
    medias: [{ id: 11, bvid: "BV1AAA" }, { id: 22, bvid: "BV1BBB" }],
    cookie: "SESSDATA=a; bili_jct=CS; x=1",
  });
  const ures2 = await api.doUnfav();
  check("doUnfav 仅有avid也成功", ures2.ok === true && ures2.avid === 11, JSON.stringify(ures2));
  const del2 = global.__fetchCalls.filter(c => /batch-del/.test(c.url)).pop();
  check("仅avid: resources=11:2", !!del2 && /resources=11%3A2/.test(del2.opts.body.toString()), del2 && del2.opts.body.toString());

  // 页面啥都不暴露（hasIS/hasPlayer/hasPinia/dataAid 全空），只靠 net-hook 的 bvid
  api = loadFresh({
    pathname: "/list/ml1683373111", netCurRaw: JSON.stringify({ aid: 0, bvid: "BV1NETX", ts: 1 }),
    medias: [{ id: 11, bvid: "BV1NETX" }, { id: 22, bvid: "BV1YYY" }],
    cookie: "SESSDATA=a; bili_jct=CS; x=1",
  });
  const ures3 = await api.doUnfav();
  check("doUnfav 仅靠 net-hook(bvid) 成功", ures3.ok === true && ures3.bvid === "BV1NETX", JSON.stringify(ures3));
  const del3 = global.__fetchCalls.filter(c => /batch-del/.test(c.url)).pop();
  check("仅net-hook: resources=11:2(经播放列表映射avid)", !!del3 && /resources=11%3A2/.test(del3.opts.body.toString()), del3 && del3.opts.body.toString());

  api = loadFresh({ pathname: "/list/ml73630712", canonical: { href: "https://www.bilibili.com/video/BV1PING/" }, title: "测试视频_bilibili_弹幕" });
  let pingResp = null;
  const listener = global.__capturedListener();
  listener({ action: "ping" }, {}, (resp) => { pingResp = resp; });
  await new Promise((r) => setTimeout(r, 0));
  check("ping 回 mediaId+bvid+title", pingResp && pingResp.mediaId === "73630712" && pingResp.bvid === "BV1PING" && pingResp.title === "测试视频", JSON.stringify(pingResp));

  // ---- 快捷键：默认 z/x/c + capture 监听注册 ----
  api = loadFresh({ pathname: "/list/ml1" });
  check("默认绑定 z/x/c", JSON.stringify(api.getBindings()) === JSON.stringify({ skip: "z", unfav: "x", unfav_skip: "c" }), JSON.stringify(api.getBindings()));
  check("注册 keydown capture 监听", global.__listeners.some(l => l.type === "keydown" && l.cap === true));

  // ---- parseBinding ----
  check("parseBinding z", JSON.stringify(api.parseBinding("z")) === JSON.stringify({ key: "z", mods: { ctrl: false, alt: false, shift: false, meta: false } }), JSON.stringify(api.parseBinding("z")));
  const pb = api.parseBinding("Ctrl+Shift+Z");
  check("parseBinding Ctrl+Shift+Z", pb.key === "z" && pb.mods.ctrl && pb.mods.shift && !pb.mods.alt, JSON.stringify(pb));

  // ---- matchBinding ----
  const mkEv = (key, mods = {}, target = null) => ({
    key, target, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta,
    preventDefault() { this.pd = true; }, stopPropagation() { this.sp = true; },
  });
  check("match z 命中 plain z", api.matchBinding(mkEv("z"), "z") === true);
  check("match z 不命中 ctrl+z", api.matchBinding(mkEv("z", { ctrl: true }), "z") === false);
  check("match z 不命中 x", api.matchBinding(mkEv("x"), "z") === false);
  check("match ctrl+z 命中 ctrl+z", api.matchBinding(mkEv("z", { ctrl: true }), "ctrl+z") === true);
  check("match alt+1 命中 alt+1", api.matchBinding(mkEv("1", { alt: true }), "alt+1") === true);
  check("match alt+1 不命中 plain 1", api.matchBinding(mkEv("1"), "alt+1") === false);

  // ---- handleKey 派发（走真实代码路径，观测副作用）----
  let hkClicked = false;
  api = loadFresh({ pathname: "/list/ml1", nextBtn: { disabled: false, click: () => { hkClicked = true; } } });
  const evZ = mkEv("z");
  await api.handleKey(evZ);
  check("handleKey z -> 跳过(原生下一集点击)", hkClicked === true);
  check("handleKey 消费按键(preventDefault+stopPropagation)", evZ.pd === true && evZ.sp === true);

  api = loadFresh({
    pathname: "/list/ml1683373111", canonical: { href: "https://www.bilibili.com/video/BV1AAA/" },
    medias: [{ id: 11, bvid: "BV1AAA" }], cookie: "SESSDATA=a; bili_jct=CS; x=1",
  });
  const evX = mkEv("x");
  await api.handleKey(evX);
  check("handleKey x -> 取消收藏(batch-del)", global.__fetchCalls.some(c => /batch-del/.test(c.url)));

  let clicked2 = false;
  api = loadFresh({ pathname: "/list/ml1", nextBtn: { disabled: false, click: () => { clicked2 = true; } } });
  await api.handleKey(mkEv("z", {}, { tagName: "INPUT" }));
  check("handleKey 输入框目标不触发", clicked2 === false);

  // ---- 自定义绑定（storage 传入 skip=q）----
  let clicked3 = false;
  api = loadFresh({ pathname: "/list/ml1", nextBtn: { disabled: false, click: () => { clicked3 = true; } }, storage: { blblBindings: { skip: "q" } } });
  check("自定义绑定 skip=q 生效", api.getBindings().skip === "q", JSON.stringify(api.getBindings()));
  await api.handleKey(mkEv("q"));
  check("handleKey q -> 跳过(自定义)", clicked3 === true);
  clicked3 = false;
  await api.handleKey(mkEv("z"));
  check("改绑后 z 不再触发跳过", clicked3 === false);

  // ---- 收藏按钮 UI：真实按钮 .video-fav，高亮 = on 类；驱动 Vue + 切 on ----
  // 1) 无 Vue 实例：只切 on 类（兜底）
  const favBtn = fakeEl({ cls: "video-fav video-toolbar-left-item on", tag: "DIV" });
  api = loadFresh({ pathname: "/list/ml1", favButton: favBtn });
  const off = api.setFavButton(false);
  check("setFavButton(false) 熄灭 .video-fav", off.found === true && off.changed === true && off.via === "class", JSON.stringify(off));
  check("熄灭后移除 on 类", !favBtn.classList.contains("on"), favBtn.className);
  check("熄灭后保留 video-fav / toolbar 类", favBtn.classList.contains("video-fav") && favBtn.classList.contains("video-toolbar-left-item"), favBtn.className);
  check("熄灭后同步 _prevClass(Vue2 diff 跟踪器)", !/(^|\s)on(\s|$)/.test(favBtn._prevClass || ""), String(favBtn._prevClass));
  const on = api.setFavButton(true);
  check("setFavButton(true) 点亮", on.found === true && favBtn.classList.contains("on"), favBtn.className);
  check("点亮后同步 _prevClass(Vue2 diff 跟踪器)", /(^|\s)on(\s|$)/.test(favBtn._prevClass || ""), String(favBtn._prevClass));

  // 2) 有 Vue3 实例：setVueFav 命中 isFav ref，via=vue+class
  const isFavRef = { value: true };
  const favVue = fakeEl({ cls: "video-fav video-toolbar-left-item on", tag: "DIV",
    vue: { setupState: { isFav: isFavRef, favCount: { value: 4482 }, title: { value: "x" } } } });
  api = loadFresh({ pathname: "/list/ml1", favButton: favVue });
  const offV = api.setFavButton(false);
  check("setVueFav 命中 isFav ref", offV.via === "vue+class" && isFavRef.value === false, JSON.stringify(offV) + " isFav=" + isFavRef.value);
  check("Vue 驱动同时切 on 类", !favVue.classList.contains("on"), favVue.className);
  const onV = api.setFavButton(true);
  check("setVueFav 点亮 ref", onV.via === "vue+class" && isFavRef.value === true, JSON.stringify(onV));
  // 非 fav 布尔/数字不被误改
  check("favCount 数字未被误改", favVue.__vueParentComponent.setupState.favCount.value === 4482);

  // 2.5) Vue 实例在祖先元素上（.video-fav 自身不带）→ 沿父链向上找到（关键修复）
  const parentInst = { setupState: { isFav: { value: true } } };
  const parentEl = fakeEl({ cls: "video-toolbar-left", tag: "DIV", vue: parentInst });
  const childFav = fakeEl({ cls: "video-fav video-toolbar-left-item on", tag: "DIV", parent: parentEl });
  api = loadFresh({ pathname: "/list/ml1", favButton: childFav });
  const offAnc = api.setFavButton(false);
  check("Vue 实例在祖先→沿父链命中", offAnc.via === "vue+class" && parentInst.setupState.isFav.value === false && !childFav.classList.contains("on"), JSON.stringify(offAnc));
  api.setFavButton(true);
  check("祖先实例点亮 ref", parentInst.setupState.isFav.value === true && childFav.classList.contains("on"));

  // 3) Vue2 风格 data.isFav
  const favV2 = fakeEl({ cls: "video-fav video-toolbar-left-item on", tag: "DIV",
    vue2: { data: { isFav: true, favState: true, loading: false } } });
  api = loadFresh({ pathname: "/list/ml1", favButton: favV2 });
  const offV2 = api.setFavButton(false);
  check("Vue2 data.isFav 被置 false", offV2.via === "vue+class" && favV2.__vue__.data.isFav === false, JSON.stringify(offV2));

  // 3b) Vue2 真实形态：prop `faved`（连播页 .video-fav 实测到的 prop；on 类绑定其上）
  const favV2p = fakeEl({ cls: "video-fav video-toolbar-left-item on", tag: "DIV",
    vue2: { $props: { faved: true, favedWhenEnter: true, favSignal: 0 }, $data: {} } });
  api = loadFresh({ pathname: "/list/ml1", favButton: favV2p });
  const offV2p = api.setFavButton(false);
  check("Vue2 prop faved 置 false", offV2p.via === "vue+class" && favV2p.__vue__.$props.faved === false, JSON.stringify(offV2p));
  check("Vue2 熄灭同时切 on 类", !favV2p.classList.contains("on"), favV2p.className);
  check("favedWhenEnter 不被误改", favV2p.__vue__.$props.favedWhenEnter === true, String(favV2p.__vue__.$props.favedWhenEnter));
  const onV2p = api.setFavButton(true);
  check("Vue2 prop faved 置 true(点亮)", onV2p.via === "vue+class" && favV2p.__vue__.$props.faved === true && favV2p.classList.contains("on"));

  // 3c) 父层也持有 faved → 一并改（才能让手动收藏 false→true 真正重渲）
  const parentV2 = { $data: { faved: true }, $props: {} };
  const favV2c = fakeEl({ cls: "video-fav on", tag: "DIV",
    vue2: { $props: { faved: true }, $data: {}, $parent: parentV2 } });
  api = loadFresh({ pathname: "/list/ml1", favButton: favV2c });
  api.setFavButton(false);
  check("Vue2 父层 $data.faved 一并置 false", favV2c.__vue__.$props.faved === false && parentV2.$data.faved === false,
    JSON.stringify({ self: favV2c.__vue__.$props.faved, parent: parentV2.$data.faved }));
  api.setFavButton(true);
  check("Vue2 父层 $data.faved 一并置 true", favV2c.__vue__.$props.faved === true && parentV2.$data.faved === true);

  // 3d) 主世界桥接：net-hook 就绪(data-blbl-main=1) → 改 Vue 必须走 MAIN world，
  //     故 content.js 通过 DOM 属性+事件桥接，via=main-world
  const favBridge = fakeEl({ cls: "video-fav video-toolbar-left-item on", tag: "DIV" });
  api = loadFresh({ pathname: "/list/ml1", favButton: favBridge, mainReady: true });
  const offBridge = api.setFavButton(false);
  check("主世界就绪→走 DOM 事件桥接", offBridge.via === "main-world", JSON.stringify(offBridge));
  check("桥接派发 blbl-fav-sync 事件", global.__dispatched.indexOf("blbl-fav-sync") >= 0, JSON.stringify(global.__dispatched));
  check("桥接事件 bubbles=true(否则到不了 document 上的监听)", global.__dispatchedEv && global.__dispatchedEv.bubbles === true, JSON.stringify(global.__dispatchedEv && { type: global.__dispatchedEv.type, bubbles: global.__dispatchedEv.bubbles }));
  check("桥接写入 data-blbl-fav-sync=0", global.document.documentElement.attrs["data-blbl-fav-sync"] === "0", JSON.stringify(global.document.documentElement.attrs));
  check("桥接同时本地切 on 类", !favBridge.classList.contains("on"), favBridge.className);
  check("桥接同步 _prevClass", !/(^|\s)on(\s|$)/.test(favBridge._prevClass || ""), String(favBridge._prevClass));
  const onBridge = api.setFavButton(true);
  check("桥接点亮写入 =1", global.document.documentElement.attrs["data-blbl-fav-sync"] === "1" && favBridge.classList.contains("on"), favBridge.className);
  // 主世界未就绪 → 回退本地
  api = loadFresh({ pathname: "/list/ml1", favButton: favBridge });
  const offLocal = api.setFavButton(false);
  check("主世界未就绪→回退本地", offLocal.via !== "main-world", JSON.stringify(offLocal));

  // 4) 有实例但无 fav 布尔属性 → setVueFav 返回 false，回退 class
  const favNoKey = fakeEl({ cls: "video-fav video-toolbar-left-item on", tag: "DIV",
    vue: { setupState: { loading: { value: false }, title: { value: "t" } } } });
  api = loadFresh({ pathname: "/list/ml1", favButton: favNoKey });
  const offNoKey = api.setFavButton(false);
  check("无 fav 布尔属性→回退 class", offNoKey.via === "class" && !favNoKey.classList.contains("on"), JSON.stringify(offNoKey));

  // 5) diagVueFav 导出 fav 键 + 祖先链
  api = loadFresh({ pathname: "/list/ml1", favButton: favVue });
  const dv = api.diagVueFav();
  check("diagVueFav 导出 favKeys+chain", dv.hasButton === true && dv.hasInstance === true && "setupState.isFav" in dv.favKeys && Array.isArray(dv.chain) && dv.chain.length >= 1, JSON.stringify(dv.favKeys));
  // 无实例时：hasInstance false 但仍给 chain
  api = loadFresh({ pathname: "/list/ml1", favButton: fakeEl({ cls: "video-fav on", tag: "DIV" }) });
  const dv2 = api.diagVueFav();
  check("diagVueFav 无实例也返回 chain", dv2.hasButton === true && dv2.hasInstance === false && Array.isArray(dv2.chain), JSON.stringify(dv2).slice(0, 120));

  // 6) 无收藏按钮
  api = loadFresh({ pathname: "/list/ml1" });
  const none = api.setFavButton(false);
  check("无收藏按钮 found=false", none.found === false && none.changed === false, JSON.stringify(none));

  // 7) 接线：doUnfav 灭 → doSkip 亮（真实 .video-fav）
  const favW = fakeEl({ cls: "video-fav video-toolbar-left-item on", tag: "DIV" });
  api = loadFresh({
    pathname: "/list/ml1683373111", netCurRaw: JSON.stringify({ aid: 11, bvid: "BV1AAA", ts: 1 }),
    medias: [{ id: 11, bvid: "BV1AAA" }, { id: 22, bvid: "BV1BBB" }],
    cookie: "SESSDATA=a; bili_jct=CS", favButton: favW,
    nextBtn: { disabled: false, click: () => {} },
  });
  await api.doUnfav();
  check("doUnfav 后 .video-fav 熄灭", !favW.classList.contains("on"), favW.className);
  await api.doSkip();
  check("doSkip 后 .video-fav 点亮", favW.classList.contains("on"), favW.className);

  // ---- 广谱诊断 diagFavoriteAll（宽匹配，供将来看 DOM）----
  api = loadFresh({ pathname: "/list/ml1", favButtons: [fakeEl({ cls: "video-fav video-toolbar-left-item on", tag: "DIV", text: "收藏", html: "<div class='video-fav video-toolbar-left-item on'>收藏</div>" })] });
  const dfa = api.diagFavoriteAll();
  check("diagFavoriteAll 返回候选含 html/cls", Array.isArray(dfa) && dfa.length >= 1 && /video-fav/.test(dfa[0].cls) && dfa[0].html.length > 0, JSON.stringify(dfa).slice(0, 160));
  api = loadFresh({ pathname: "/list/ml1" });
  check("diagFavoriteAll 无候选返回空数组", Array.isArray(api.diagFavoriteAll()) && api.diagFavoriteAll().length === 0);

  console.log("\nRESULT: " + (fails === 0 ? "ALL PASS" : fails + " FAIL"));
  process.exit(fails === 0 ? 0 : 1);
})();
