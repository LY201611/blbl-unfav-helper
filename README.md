# BLBL 取消收藏助手 · Unfav Helper for Bilibili

> 🤖 **本插件由 AI 全流程开发（AI-built）**：需求拆解、架构设计、全部源代码、调试排错、文档撰写均由 AI 助手完成；人类用户仅提供功能需求与真机测试反馈。详见文末「关于 AI 开发」。

[![developed by AI](https://img.shields.io/badge/developed%20by-AI-8A2BE2)](https://github.com/LY201611/blbl-unfav-helper)
[![manifest](https://img.shields.io/badge/manifest-MV3-blue)](https://developer.chrome.com/docs/extensions/mv3/)
[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-110%20passing-brightgreen)](./tests)
[![platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge-orange)](https://chromewebstore.google.com)

---

## 这是什么 / What is this

（中文）一个 **Chrome / Edge 浏览器扩展（Manifest V3）**，帮你一键清理 B站收藏夹连播页里不想留下的视频：

- 在收藏夹「播放全部」连播页，用快捷键 **跳过 / 取消收藏（继续播）/ 取消收藏并跳过**；
- 默认快捷键 `z` / `x` / `c`，可在弹窗里改成任意单键或组合键；
- 全屏播放时快捷键依然有效；
- 取消收藏只作用于「当前连播收藏夹」，复用浏览器登录态，无需单独登录。

（English）A browser extension (MV3) that lets you clean up a Bilibili *favorites* playlist with one keypress: **skip / unfavorite (keep playing) / unfavorite & skip**. Hotkeys are fully customizable, work in fullscreen, and only touch the current playlist. Reuses your browser login — no separate auth.

## 为什么做这个 / Why it exists

（中文）B站网页端在收藏夹连播时想取消收藏，要点好几下（退出全屏 → 点收藏 → 取消 → 确认），刷一堆收藏时很烦。这个扩展把"好几步"合成"一键"。

（English）Unfavoriting a video inside Bilibili's playlist player takes several clicks and breaks fullscreen. This extension collapses that into a single hotkey.

## 功能一览 / Features

- ✅ 三种操作：**跳过(`z`) / 取消收藏(`x`) / 取消收藏并跳过(`c`)**
- ✅ 快捷键**完全可自定义**（任意单键或 `Ctrl`/`Alt`/`Shift` 组合），弹窗设置、即时生效、存 `chrome.storage`
- ✅ **全屏下仍生效** —— 在 capture 阶段监听按键，绕过 Chrome 强制"快捷键必须带修饰键"的限制
- ✅ 只作用于**当前连播收藏夹**（从 URL `/list/ml<id>` 解析）
- ✅ 复用浏览器登录态，免登录
- ✅ 收藏按钮图标**实时跟随真实状态**：取消→灭、下一个→亮、取消后手动再收藏→自动亮
- ✅ 当前视频识别稳健：优先 **hook 页面 `fetch`/`XHR`** 抓取 playurl 里的 `bvid`/`avid`（抗 B站改版，不依赖 `__INITIAL_STATE__`/`player`/`pinia`）
- ✅ **110 项单元测试全过**（content 82 + net-hook 28）

## 安装 / Install

支持 **Chrome 与 Edge**（二者均支持 MV3）。

1. 获取仓库（含 `extension/` 文件夹）：`git clone https://github.com/LY201611/blbl-unfav-helper.git`，或下载 ZIP 后解压；
2. 打开扩展管理页：
   - Edge：`edge://extensions`
   - Chrome：`chrome://extensions`
3. 右上角打开「**开发人员模式**（Developer mode）」；
4. 点「**加载解压的扩展**（Load unpacked）」，选择本仓库的 `extension/` 目录；
5. 进入 B站任意收藏夹 → 点「**播放全部**」进入 `/list/ml<id>` 连播页；
6. 按 `z / x / c` 开始清理；点扩展图标可改键、查看当前收藏夹与 BV。

更详细的图文步骤见 **[INSTALL.md](./INSTALL.md)**。

## 使用 / Usage

| 快捷键（默认） | 操作 | 说明 |
|---|---|---|
| `z` | 跳过 | 不动收藏，播下一个 |
| `x` | 取消收藏 | 只取消当前，继续播 |
| `c` | 取消收藏并跳过 | 先取消再跳下一个 |

点扩展图标 → 设置里可改任意键（含组合键）。

## 工作原理 / How it works

MV3 内容脚本默认跑在「**隔离世界 (isolated world)**」，读不到页面 Vue/React 挂在 DOM 上的内部状态（`__vue__` 这类 expando 属性跨 world 不可见）。本扩展用**两个脚本分工 + DOM 桥接**解决：

- **`net-hook.js`**（`world: "MAIN"`，`document_start`）：hook 页面 `fetch`/`XHR` 抓取当前视频 `bvid`/`avid`；并在**主世界**负责把收藏按钮的 Vue 状态（`faved` prop）真正翻转、同步 `_prevClass`、强制 `$forceUpdate()`。
- **`content.js`**（isolated world，`document_idle`）：监听快捷键、调 `batch-del` 接口取消收藏、识别当前视频（优先用 net-hook 结果）、吐司提示。
- 两世界通过 **DOM 属性 + 冒泡的 DOM 事件** 桥接（`<html data-blbl-fav-sync>` + `blbl-fav-sync` 事件）。

完整架构图与术语见 **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**。

## 最难的那个 bug（也是本项目最值钱的经验）/ The hardest bug

> 收藏按钮图标不跟随真实状态：取消收藏后不灭、跳下一个不亮、取消后手动再收藏不亮。

根因横跨三层，每一层都足以让"看起来对的代码"完全失效：

1. **隔离世界读不到 `__vue__`** —— expando 属性跨 world 不可见；
2. **`_prevClass` 也是 expando** —— 只能在主世界写；
3. **跨世界桥接事件忘记 `bubbles: true`** —— `CustomEvent` 默认不冒泡，事件从 `documentElement` 派发永远到不了挂在 `document` 上的监听，主世界同步**一次都没被触发**。

完整的现象 / 根因 / 教训复盘（12 类踩坑表）见 **[docs/PITFALLS.md](./docs/PITFALLS.md)** —— 对任何做 MV3 扩展、需要"驱动页面框架内部状态"的开发者都直接可用。

## 开发 / 测试 / Dev

```bash
node tests/test_content.js    # 82 passing
node tests/test_net_hook.js   # 28 passing
```

无构建步骤（原生 JS + Manifest V3）。图标由 `extension/gen_icons.py` 生成。

## 关于 AI 开发 / About the AI development

> 本插件从需求分析到最终交付，**全部由 AI 助手完成**：
>
> - 架构设计、全部源代码（`extension/` 下所有 JS）、单元测试；
> - 真机调试中那些反反复复的坑（隔离世界、事件不冒泡、选择器命中错元素、误判非 Vue、CDP 白折腾……）也全部由 AI 定位与修复；
> - 本文档（README / INSTALL / ARCHITECTURE / PITFALLS）同样由 AI 撰写。
>
> **人类用户的角色**：提出需求、在真机（Edge 浏览器）上实测并反馈现象。所有代码决策与实现均由 AI 做出。
>
> *This entire project — design, code, tests, debugging, and documentation — was produced end-to-end by an AI assistant. The human user provided requirements and real-device testing feedback only.*

## 许可证 / License

[MIT](./LICENSE) —— 可自由使用、修改、再分发。

## 免责声明 / Disclaimer

本扩展仅用于方便你管理**自己的** B站收藏夹，调用的是 B站公开 Web 接口。请遵守 B站用户协议，勿用于刷量、滥用等违规用途。作者不对使用后果负责。

---

⭐ 如果这个扩展帮你省下了清理收藏的时间，欢迎 Star / Fork / 提 Issue！
