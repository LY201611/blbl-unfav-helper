// BLBL 取消收藏助手 · 后台 Service Worker（MV3）
// 职责：把 popup 的操作请求转发到当前 B站标签页的 content script。
// 快捷键改由 content.js 的「页面内可配置按键监听」处理（支持任意单键如 z/x/c，
// 全屏时按键事件仍冒泡到页面，capture 阶段可捕获），不再使用 manifest commands
// （后者被 Chrome/Edge 强制要求含 Ctrl/Alt，无法绑定单字母）。

const BILI_RE = /^https?:\/\/([^/]*\.)?bilibili\.com\//i;

async function getActiveBiliTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return null;
  if (!BILI_RE.test(tab.url || "")) return null;
  return tab;
}

async function sendToContent(tabId, action, retry = true) {
  try {
    return await chrome.tabs.sendMessage(tabId, { action });
  } catch (e) {
    if (retry) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content.js"],
        });
        return await chrome.tabs.sendMessage(tabId, { action });
      } catch (e2) {
        return { ok: false, error: String(e2) };
      }
    }
    return { ok: false, error: String(e) };
  }
}

// 供 popup 复用同一发送逻辑
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg && msg.forward) {
      const tab = await getActiveBiliTab();
      if (!tab) { sendResponse({ ok: false, error: "not-bili" }); return; }
      sendResponse(await sendToContent(tab.id, msg.forward));
    } else if (msg && msg.ping) {
      const tab = await getActiveBiliTab();
      if (!tab) { sendResponse({ ok: false, error: "not-bili" }); return; }
      sendResponse(await sendToContent(tab.id, "ping"));
    }
  })();
  return true;
});
