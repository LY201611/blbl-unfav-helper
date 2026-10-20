// BLBL 取消收藏助手 · Popup
// 通过 background 把动作转发到当前 B站标签页的 content script；
// 快捷键绑定存 chrome.storage.sync（content.js 监听变更即时生效）。

const $ = (id) => document.getElementById(id);
const HK_KEY = "blblBindings";
const HK_DEFAULT = { skip: "z", unfav: "x", unfav_skip: "c" };

async function refreshStatus() {
  const el = $("status");
  try {
    const res = await chrome.runtime.sendMessage({ ping: true });
    if (res && res.ok && res.mediaId) {
      el.innerHTML = `收藏夹 <b>ml${res.mediaId}</b><br>当前 <b>${res.bvid || "?"}</b> ${res.title ? "· " + res.title.slice(0, 18) : ""}`;
    } else {
      el.textContent = "当前标签不是 B站收藏夹连播页（/list/ml…）";
    }
  } catch (e) {
    el.textContent = "无法连接页面（请在 B站标签页使用）";
  }
}

function loadHotkeys() {
  chrome.storage.sync.get(HK_KEY, (res) => {
    const b = Object.assign({}, HK_DEFAULT, (res && res[HK_KEY]) || {});
    $("hk-skip").value = b.skip;
    $("hk-unfav").value = b.unfav;
    $("hk-unfav-skip").value = b.unfav_skip;
  });
}

function saveHotkeys() {
  const b = {
    skip: $("hk-skip").value.trim() || HK_DEFAULT.skip,
    unfav: $("hk-unfav").value.trim() || HK_DEFAULT.unfav,
    unfav_skip: $("hk-unfav-skip").value.trim() || HK_DEFAULT.unfav_skip,
  };
  chrome.storage.sync.set({ [HK_KEY]: b }, () => {
    const btn = $("btn-save-hk");
    btn.textContent = "已保存 ✓";
    setTimeout(() => { btn.textContent = "保存快捷键"; }, 1200);
  });
}

async function act(action) {
  try {
    await chrome.runtime.sendMessage({ forward: action });
    setTimeout(refreshStatus, 400);
  } catch (e) {
    $("status").textContent = "操作失败：" + e;
  }
}

$("btn-skip").addEventListener("click", () => act("skip"));
$("btn-unfav").addEventListener("click", () => act("unfav"));
$("btn-unfav-skip").addEventListener("click", () => act("unfav_skip"));
$("btn-save-hk").addEventListener("click", saveHotkeys);

refreshStatus();
loadHotkeys();
