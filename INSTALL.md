# 安装与使用示例 / Installation Guide

> 支持 **Chrome** 与 **Edge**（均为 Manifest V3）。本扩展未上架应用商店，采用「加载解压的扩展」方式安装。

## 一、获取扩展文件 / Get the files

```bash
git clone https://github.com/LY201611/blbl-unfav-helper.git
# 扩展代码在 clone 后的  release/extension/  目录（本仓库根即 release 内容时，直接用 extension/）
```

或直接下载仓库 ZIP 并解压，取其中的 `extension/` 文件夹。

## 二、加载扩展 / Load unpacked

### Edge
1. 地址栏打开 `edge://extensions`
2. 打开左下角（或右上角）的 **「开发人员模式」(Developer mode)** 开关
3. 点 **「加载解压的扩展」(Load unpacked)**
4. 选择仓库里的 `extension/` 目录

### Chrome
1. 地址栏打开 `chrome://extensions`
2. 打开右上角 **「开发者模式」(Developer mode)** 开关
3. 点 **「加载已解压的扩展程序」(Load unpacked)**
4. 选择仓库里的 `extension/` 目录

> 若加载报红，确认 `extension/` 内**没有**以 `_` 开头的文件（Chrome/Edge 保留名），本仓库已规避。

## 三、开始使用 / Start using

1. 打开 B站，进入任意收藏夹，点 **「播放全部」**，进入 `/list/ml<id>` 连播页；
2. 按默认快捷键：
   - `z` 跳过
   - `x` 取消收藏（继续播）
   - `c` 取消收藏并跳过
3. 点工具栏扩展图标，可在弹窗里**改键**、查看当前收藏夹与当前 BV。

## 四、权限说明 / Permissions

| 权限 | 用途 |
|---|---|
| `tabs` / `scripting` | 向 B站标签页注入/通信，读取当前播放页 |
| `storage` | 保存你自定义的快捷键 |
| `host: *.bilibili.com` | 仅在 B站页面运行 |

不申请任何远程服务器、不上传任何数据。

## 五、常见问题 / FAQ

**Q：为什么不上架商店？**
A：上架需开发者账号与审核，且 MV3 商店版对 `world: "MAIN"` 调试类行为更敏感。加载解压版功能完全一致，适合自用与开源协作。

**Q：快捷键没反应？**
A：确认处于收藏夹连播页（`/list/ml<id>`）；确认扩展已启用；全屏下也应生效（capture 阶段监听）。改键后无需重启，刷新页面即可。

**Q：取消收藏后图标没变？**
A：这是本项目最难修的 bug，已在 [docs/PITFALLS.md](./docs/PITFALLS.md) 完整复盘。当前稳定版已解决：取消→灭、下一个→亮、取消后手动再收藏→自动亮。若仍异常，按 `F12` 在控制台执行 `window.__blblFavDiag()` 看诊断。

**Q：支持手机 / 火狐吗？**
A：当前仅桌面 Chrome/Edge（MV3）。Firefox 的 MV3 对 `world: "MAIN"` 支持口径不同，未验证。
