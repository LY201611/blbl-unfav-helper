# 踩坑复盘 / Hard-Won Lessons (MV3 isolated vs main world)

> 本项目开发中最值钱的部分，不是功能本身，而是"驱动页面框架内部状态"时踩的坑。
> 这些坑对任何做 **MV3 扩展 + 需要读写页面 Vue/React 内部状态** 的开发者都直接可用。
> 结论先说：**最致命的两个坑是「隔离世界 / 主世界」和「跨世界事件不冒泡」**，其余多数是"没先看真实 DOM 就盲猜"的衍生问题。

## 一句话概览 / Summary

| # | 坑 / Pitfall | 后果 / Symptom | 根因一句话 / Root cause |
|---|---|---|---|
| 1 | 隔离世界看不到 `__vue__` | 所有"驱动 Vue"尝试全部落空 | MV3 内容脚本默认隔离世界，`__vue__` 是 expando，跨 world 不可见 |
| 2 | `_prevClass` 也是 expando | 在隔离世界同步它毫无效果 | 同上，扩展属性只能在主世界读写 |
| 3 | 桥接事件不冒泡 | 主世界同步一次都没被触发 | `new CustomEvent()` 默认 `bubbles:false` |
| 4 | 选择器命中错误元素 | 一直给"页面顶部收藏入口链接"加/删类 | 宽泛选择器 + 取第一个 |
| 5 | 误判"不是 Vue" | 白绕两轮、差点放弃 | 诊断结果没结合执行环境(world)解读 |
| 6 | 只改 class 不同步框架内部状态 | 图标不亮/不灭 | Vue2 重渲是跟 `_prevClass` 比对 |
| 7 | 状态源头没翻转 | 手动收藏仍是"true→true"不重渲 | 只改了子组件 prop，没改真正源头 |
| 8 | 盲猜类名/属性名 | 反复试错、多轮不收敛 | 没先拿真实 DOM 就动手 |
| 9 | 参数笔误 `favored`/`favorited` | 编译过、运行崩 | 靠单测才逮住 |
| 10 | 接口 412 风控 | `.json()` 抛错刷屏 | 对可能风控的响应缺保护 |
| 11 | CDP 远程调试白折腾 | 浪费一轮 | Edge 启动器 compat relaunch 导致端口不绑定 |
| 12 | 过度设计（快照/恢复） | 复杂度虚高 | 没先搞清状态的真实表示（就是 `on` 一个类） |

---

## A. 环境类：隔离世界 vs 主世界（最致命）/ Isolated vs main world

**现象 / Symptom**
- 在 F12（页面主世界）能读到 `document.querySelector('.video-fav').__vue__`；
- 但扩展的 `content.js` 里读它**永远是 `undefined`**，于是 `diagVueFav` 报 `hasInstance:false`，所有"驱动 Vue 状态"的代码全部静默失效。

**根因 / Root cause**
MV3 内容脚本默认运行在「隔离世界 (isolated world)」，它的 JS 世界与页面主世界是隔离的：
- **标准 DOM 属性**（`className`、`getAttribute`/`setAttribute`、`addEventListener`）→ 两世界共享，可正常读写；
- **JS 扩展属性 (expando)**（页面脚本挂在 DOM 元素上的，如 Vue 的 `__vue__`、`_prevClass`）→ **跨 world 不可见**。

**教训 / Lessons**
- 要读/写页面框架（Vue/React）挂在元素上的状态，必须在 `world: "MAIN"` 的脚本里做（本项目即 `net-hook.js`）。
- 跨世界通信只能走**共享的 DOM**：属性（如 `<html data-blbl-cur>`、`data-blbl-fav-sync`）与 **DOM 事件**。
- 诊断脚本在 F12 跑（主世界）与在 content.js 跑（隔离世界）**看到的结果可能完全不同**，解读诊断时要先确认"它跑在哪个 world"。

---

## B. 定位类：选择器命中了错误元素 / Wrong element matched

**现象 / Symptom**
取消收藏成功，但收藏按钮纹丝不动；且控制台**没有**任何"未找到按钮"告警（因为确实"找到"了东西）。

**根因 / Root cause**
`favButtonCandidates()` 用了宽泛选择器集合（含 `[title*="收藏"]`、`[class*="favorite"]`），然后 `getFavButton()` 取**第一个**结果。真实命中的是**页面右上角的 `favorite-entry`「收藏」入口链接**（跳收藏夹的），而真正要操作的是**视频工具条的 `.video-fav`**。于是一直在给错误元素加/删类。

（早期某版"能灭"是因为当时遍历了全部候选、顺带扫到了 `.video-fav`；后来改成只取第一个，就把它漏了——这也是一个"改动引入回归"的教训。）

**教训 / Lessons**
- **宽泛选择器 + 取第一个 = 危险**。定位 UI 元素要**精确到特征**（本项目最终用 `.video-toolbar-left-item.video-fav` → `.video-fav` → `[title="收藏（E）"]` 逐级兜底）。
- "`found=true`" 不等于"找对了元素"。要能验证**操作的确实是那个可见元素**。

---

## C. 框架类：手改框架管理的 DOM，必须同步它的内部状态 / Sync framework state

**现象 / Symptom**
直接把 `.video-fav` 的 `on` 类删掉，按钮变暗 ✓；但之后**手动收藏，按钮不亮**。

**根因 / Root cause**
两层原因叠加：
1. **Vue2 重渲时的 class diff 是拿"新算出的 class"跟元素上的 `_prevClass` 比对**，不是跟真实 `className` 比。只改 `className` 而 `_prevClass` 停在旧值 → 重渲时误判"没变化"→ 跳过更新。
2. 更根本：**框架内部"是否已收藏"的标记一直是 `true`，从没被翻成 `false`**。手动收藏对它而言是 `true → true`，**压根不触发重渲**（所以同步 `_prevClass` 也无从谈起）。

真实链条（F12 实测确认）：
```
VideoToolBar.data.faved  ──下传──▶  VideoFav.props.faved  ──▶  on 类
收藏数 = videoData.stat.favorite + (faved?1:0) - (favedWhenEnter?1:0)
```

**教训 / Lessons**
- 手改框架管理的 DOM 时，**状态与 DOM 要一起改**，且要改到**真正的源头**（不是只改最外层子组件）。
- 改完对该层调 **`$forceUpdate()`** 强制重渲更稳妥。
- 避开 `favedWhenEnter`、`favSignal`、计数这类"看起来像但其实不该动"的字段（会影响收藏数计算）。

---

## D. 桥接类：跨世界事件必须显式冒泡 / Events must bubble

**现象 / Symptom**
F12 手动调 `window.__blblSyncFavUI(false/true)` **能**控制按钮亮灭（说明函数本身没问题）；但按快捷键 `x` 后，`props.faved`/`data.faved` **仍是 true**（说明同步根本没被调用）。

**根因 / Root cause**
```js
document.documentElement.dispatchEvent(new CustomEvent("blbl-fav-sync"));
// ↑ CustomEvent 默认 bubbles:false
```
监听器挂在 `document` 上——事件从 `documentElement` 派发且不冒泡，**永远到不了 `document`**。桥接一次都没通。

**教训 / Lessons**
- 跨 world 用 `CustomEvent` 桥接，**务必显式 `{ bubbles: true }`**，或直接在监听所在节点上派发。
- 修复后已加**双监听**（`document` + `documentElement`）兜底，并写了 `bubbles=true` 的断言防回归。
- 教训延伸：**要留可观测的验证点**（本项目靠 `window.__blblFavDiag()` 直接读出 `faved` 值，才迅速判断出"没被调用"而不是"调用失败"）。

---

## E. 方法类：先诊断再动手，别盲猜 / Diagnose before guessing

**反面案例 / Anti-pattern**
连续几轮靠**猜**类名（`on`/`active`/`faved`…）和选择器（`.bpx-player-favorite`…），每轮都不中、反复试错。

**正面案例 / Positive pattern**
- 当前视频识别：先让用户贴诊断 → 发现页面不暴露 `__INITIAL_STATE__/player/pinia` 且无 `data-aid` → 据此设计 **net-hook 抓 playurl**，**一次成功**。
- 收藏按钮：先贴 `outerHTML` 才看清真实按钮是 `.video-fav`；先贴 `favInfoSrc`+props 才确认状态标记是 `faved`。

**教训 / Lessons**
- **遇到"改了没反应"，第一反应应该是"拿到它真实的样子"，而不是换一个猜法再试。**
- 优先用 **F12 控制台贴探查脚本**（在主世界，能看到全部真实信息）——比折腾 CDP 远程调试省事得多（见下条）。

---

## F. 其他零散坑 / Misc

| 坑 | 说明 | 教训 |
|---|---|---|
| 误判"不是 Vue" | `diagVueFav` 的祖先链全 `vue:false`，据此判定"是自定义组件栈、不是 Vue"，白绕两轮。真因是隔离世界看不到 `__vue__` | 诊断结论要结合执行环境解读，别只看表面数值 |
| 参数笔误 | 函数参数 `favored`，函数体内写成 `favorited`——`node --check` 能过，运行时 `ReferenceError` 才崩 | 靠单测当场逮住；**语法检查 ≠ 逻辑正确** |
| 接口 412 风控 | `fav/resource/list` 返回 HTML，`.json()` 抛 `SyntaxError` 刷屏 | 对可能风控/非 JSON 的响应加 `try/catch` + `code!==0` 即停 |
| CDP 调试白折腾 | 重启 Edge 带 `--remote-debugging-port=9222`，进程确实带 flag，但该浏览器进程 0 个监听端口（Edge 启动器 compat relaunch 所致），连不上 | 同类调试**优先 F12 控制台**，别先折腾调试端口 |
| 过度设计 | 早期用"className 快照/恢复"做灭→亮，后来发现状态就是 `on` 一个类，快照纯属多余 | 先搞清状态的真实表示，再决定机制复杂度 |

---

## 最终正确架构 / Final architecture

> **改页面框架状态的一律放主世界**（`net-hook.js`，`world:"MAIN"`）；
> **快捷键/接口/业务逻辑放隔离世界**（`content.js`）；
> 两者通过 **DOM 属性 + 冒泡的 DOM 事件** 桥接。

```
content.js(隔离世界)                       net-hook.js(主世界)
  快捷键 z/x/c
  batch-del 取消收藏
  写 data-blbl-fav-sync  ──冒泡事件──▶   读属性 → syncFavUI()
  并切 on 类(仅视觉)                        置 faved prop + 父层 data.faved
                                           调 $forceUpdate()
                                           切 on 类 + 同步 _prevClass
```

## 可复用排查手法 / Reusable debugging playbook

1. **F12 控制台（主世界）贴探查脚本**，看真实 DOM / props / 组件链 —— 这是本项目最高效的手段。
2. 改完要能**观测**：本项目留了 `window.__blblSyncFavUI(f)` 与 `window.__blblFavDiag()` 两个主世界入口。
3. "found=true" 不等于"找对了"；"没报错"不等于"生效了"。**要有能读出真实状态值的诊断**。
4. 每次改动后跑单测（`tests/test_content.js`、`tests/test_net_hook.js`）——笔误和回归都靠它兜住。
