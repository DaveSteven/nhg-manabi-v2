# 2026-11-17 换用 MINAO 标志与 favicon

## 范围
学生端与管理端的站点图标、顶栏/登录页品牌标志替换为已确认的 MINAO 开环加圆点图形（素材来自 `minao-favicon-v2`）。仅视觉资源，无需求/架构变化，无 ADR。

## 改动
- `apps/web/public/` 新增 favicon.ico/svg、16/32 PNG、apple-touch-icon、android-chrome 192/512、透明单色标志；`root.tsx` links 声明 icon/apple-touch-icon。
- 学生端顶栏与认证页 `.brand-mark`：由「日」字方块改为 `/favicon.svg` 图片（30px，圆角 8px）。文字「JLPT GO 2.0」未改动。
- 管理端：替换 `public/images/favicon*`、新增 `favicon.ico`，`index.html` 精简为 ico+svg；`Logo` 组件与侧栏 team 图标改用 MINAO 图。
- 未生成 PWA manifest（项目尚无）；android-chrome 图仅随素材放入 public。

## 测试
- apps/web：`tsc --noEmit` 通过；vitest 272 passed；`pnpm build`（含产物检查）通过，产物含图标文件。
- apps/admin：`tsc -p tsconfig.app.json --noEmit` 通过；vitest 31 passed。
- 未做：真实浏览器视觉核对、深色模式对比、管理端 build。

## 风险
- 品牌文字仍为「JLPT GO」，如需改为 MINAO 文案需另行确认。

## 追加：品牌文字换为 MINAO + 重建镜像
- 学生端/管理端所有「JLPT GO」文案（顶栏、认证页、页面 title、首页/SEO 描述、管理端）改为「MINAO」，保留 2.0 角标；`check-build.mjs` 的 h1 断言同步。TopNav 测试内自带的 h1 夹具未动。
- `docker compose build --pull` 重建 api/web 镜像并 `up -d`：web 已重新创建，api 因后端代码无变化沿用原容器。
- 实测：`localhost:8080` title 为「MINAO · …」、`/favicon.svg` 200；`localhost:8081` title「MINAO 管理端」。web vitest 272、admin 31 通过，web build 通过。
- 未做：浏览器视觉核对；`AGENTS.md`/docs 中的项目名「JLPT GO 2.0」未改。
