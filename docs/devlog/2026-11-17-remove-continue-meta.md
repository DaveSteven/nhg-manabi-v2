# 2026-11-17 · 首页继续练习卡片移除 continue-meta

## 范围
首页「继续上次练习」卡片去掉 `continue-meta` 行（"已提交 X / Y 组 · 从上次的位置继续"）。纯前端展示调整，无 API/Schema/ADR 变化。

## 改动
- `StudyHome.tsx`：删除该 `<p>` 及仅为其服务的 `submitted` 变量。
- `_catalog.scss`：删除 `.continue-meta` 规则。
- `StudyHome.test.tsx`：删除对「已提交 1 / 2 组」文案的断言。

## 测试（实际执行）
- `tsc --noEmit`：通过。
- `vitest run`：24 文件 / 231 passed。
- `npm run build`（含 check-build）：通过。
- `docker compose build web && up -d web`：见提交说明；未做真实浏览器目检，Firefox/Safari/深色模式未测。
