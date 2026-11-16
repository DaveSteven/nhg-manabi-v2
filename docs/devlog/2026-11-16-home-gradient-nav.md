# devlog · 2026-11-16 · 首页樱花装饰移除，改为固定渐变背景 + 导航去底色

## 范围

用户两条后续决定（同日，接 `2026-11-16-study-home-v1-1.md`）：

1. 樱花装饰图去掉，body 换成用户提供的 CSS：三段椭圆径向渐变（右上 #EEDCF6 / 顶部中央 #FFDFE6 / 左上 #FEEFE8）叠在 `#FDF6F6` 底色上，`background-attachment: fixed`。
2. 「导航的背景颜色去掉」：移除 sticky 头部的半透明暖白底 + backdrop blur（该底色与 fixed 渐变叠加产生明显横向接缝）。胶囊导航本体的白色底保留（v1.1 §3 胶囊设计）；头部 `pointer-events:none`（子元素恢复）避免透明区挡点击。

## 改动

- `apps/web/app/styles/global.scss`：body 背景按用户 CSS 原样替换（注释注明 2026-11-16 用户确认值）；`.site-header` 去背景/blur，改 pointer-events 穿透。
- `apps/web/app/features/catalog/StudyHome.tsx`：删除装饰 `<img>` 与 webp import。
- `apps/web/app/styles/_catalog.scss`：删除 `.home-decor` 全部规则与 `.study-home > :not(.home-decor)` 层级修正。
- 删除 `apps/web/app/assets/home-blossom.webp`（git rm）。

## 测试（真实结果）

- `pnpm test`：16 文件 / 125 用例全部通过。
- `pnpm typecheck`：通过。
- `pnpm build` + 产物检查：通过。
- `git diff --check`：干净。
- 真实 Chrome 截图走查 `/study`（1440）：渐变正常、导航区无背景无接缝、胶囊白底正常。

## 风险 / 遗留

- `background-attachment: fixed` 在 iOS Safari 不生效（iOS 会按 scroll 绘制或忽略），移动端表现为渐变随页面滚动而非固定——不影响可用性，未做兼容处理，待真机走查确认。
- sticky 头部现在无底色，长页面（试卷目录、练习页）滚动时内容会从品牌与胶囊后面穿过，可能产生视觉重叠；胶囊本体有白底不受影响，品牌文字会与滚动内容叠字。若走查不可接受，后续可改为头部离屏即固定/取消 sticky，或恢复局部模糊底。
- 本次是视觉方向的再次变更（樱花图→渐变），均为用户逐条明确决定；不涉及需求/架构，无 ADR。
