# 2026-11-18 模考回顾取消自动滚动

## 范围
用户要求：回顾页导航只负责内容切换，页面滚动由用户控制。仅前端。

## 改动
- `MockResults.tsx`：移除切换时的 `scrollIntoView`。
- `SharedMaterialLayout` 新增 `pageScroll`（默认 true，专项/练习页行为不变）；`ReviewQuestion` 透传，模考回顾传 `false`，故文章填空切题也不再把页面滚到 Slot（面板内部 `scrollTop=0` 保留）。
- `.mock-review-area` 预留 `min-height: 520px`，减轻长短解析/加载态切换时下方内容跳动。
- 新增测试：切科目/筛选不调用 `scrollIntoView`/`scrollTo`。

## 说明
目前没有外部深链进入指定题目的入口，所以"首次进入定位"沿用现有行为：首次渲染按记忆状态或首个错题选中，但不滚动；日后加深链时再单独加首次定位。

## 测试
`tsc --noEmit` 通过；`vitest run` 344 passed；容器已重建。未做真实浏览器目检（布局跳动程度、cloze 题观感）。
