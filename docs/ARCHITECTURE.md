# 架构说明 / Architecture

> 一句话：**改页面框架状态的一律放主世界（MAIN）；快捷键 / 接口 / 业务逻辑放隔离世界（isolated）；两者用 DOM 属性 + 冒泡事件桥接。**

## 为什么需要两套脚本 / Why two scripts

Manifest V3 的内容脚本默认运行在 **isolated world**，与页面主世界（页面自己的 JS）隔离：

| 可跨 world 共享 | 不可跨 world（expando） |
|---|---|
| 标准 DOM 属性/方法：`className`、`getAttribute/setAttribute`、`addEventListener`、DOM 事件 | 页面框架挂在元素上的 JS 扩展属性，如 Vue 的 `__vue__`、`_prevClass`、React 的 `__reactFiber$*` |

因此：**要读/写页面框架（Vue/React）内部状态，必须在 `world: "MAIN"` 的脚本里做**；隔离世界读它们恒为 `undefined`。

## 分工 / Split of responsibilities

```
content.js  (isolated world, document_idle)
  ├─ 监听快捷键 z/x/c（capture 阶段，全屏生效）
  ├─ 调 batch-del 接口取消收藏（resources=avid:2, csrf=bili_jct）
  ├─ 识别当前视频（优先用 net-hook 抓到的 bvid/avid）
  ├─ 吐司提示 / 诊断
  └─ 写 <html data-blbl-fav-sync>  ──冒泡事件──▶  net-hook.js

net-hook.js  (MAIN world, document_start)
  ├─ hook 页面 fetch/XHR，抓取当前视频 bvid/avid → <html data-blbl-cur>
  └─ 监听 blbl-fav-sync 事件：
       读 data-blbl-fav-sync → syncFavUI()
       置 faved prop + 父层 data.faved
       调 $forceUpdate()
       切 on 类 + 同步 _prevClass（两者都是主世界 expando）
```

## 桥接要点 / Bridge rules

1. **共享 DOM 通信**：跨世界只走 DOM 属性（`data-blbl-*`）和 DOM 事件。
2. **事件必须 `bubbles: true`**：`new CustomEvent("x", { bubbles: true })`，否则从 `documentElement` 派发到不了 `document` 上的监听。本项目在 `document` 与 `documentElement` **双监听**兜底。
3. **主世界写主世界的东西**：`__vue__`、`_prevClass` 这类 expando 只能在主世界读写，隔离世界的写入静默无效。

## 当前视频识别 / Current-video detection

B站部分连播页不暴露 `__INITIAL_STATE__` / `player` / `pinia`，DOM 也无 `data-aid`。因此：

- **首选 net-hook**：播放器播/切视频必请求带 `bvid`/`avid` 的接口（如 playurl），hook 页面 `fetch`/`XHR` 抓取，不依赖页面全局/DOM，抗改版；
- **兜底**：页面全局 / DOM 上的 `aid`/`bvid` / `data-aid`；
- 失败时在吐司 / 控制台打印诊断（含 `net`、`hasIS`、`hasPlayer`、`dataAid`），便于定位。

## 目录 / Files

```
extension/
├── manifest.json      MV3；content_scripts: net-hook[MAIN,start] + content[idle]
├── net-hook.js        MAIN world：抓当前视频 + 收藏按钮状态同步
├── content.js         isolated world：快捷键 / 取消收藏 / 识别 / 桥接
├── background.js      Service Worker：popup 请求转发
├── popup.html/js      弹窗：按钮后备 + 快捷键设置
└── icons/             B站粉底白星图标（gen_icons.py 生成）
```
