# 开发日志 · 2026-11-16 用户端渲染策略定稿

## 范围

应用户确认的渲染策略，更新前端规范文档；纯文档变更，无代码改动。

## 改动内容

1. **`docs/design/frontend-spec.md`**
   - 新增「页面渲染策略（Rendering Strategy）」完整章节：React Router Framework Mode + `ssr: false` + 公开路由 `prerender` 的 SSG/SPA 混合架构、页面分类与渲染模式表、品牌首页/学习首页分离、SSG 页面规范、SPA 页面规范、SEO 与多语言、静态部署路由规则（含 `__spa-fallback.html` 误用警告）、性能验收清单、SSR 升级触发条件。
   - 修订「前端工程方向」首条：路由与渲染模式由本决策锁定（原「路由按模块需要选择」表述不再适用）；数据请求与轻状态库仍按模块选择。
2. **`docs/decisions/ADR-0007-hybrid-rendering-strategy.md`**（新增）：记录决策、理由、影响与升级条件。（文件名修正：本日志初稿写为 `ADR-0007-frontend-rendering-strategy.md`，与同日另一份按用户正文落盘的 ADR 重复，已合并为单一 `ADR-0007-hybrid-rendering-strategy.md`，详见 `2026-11-16-adr-0007-hybrid-rendering.md`。）
3. **`docs/decisions/README.md`**：新增 P-017 索引行，ADR 导航补齐 0006/0007。
4. **`docs/devlog/progress.md`**：同步完成项；「未开始」中原「Task 09 前先写混合渲染 ADR」一项由 ADR-0007 提前满足（决策先行确认，实现仍在 M2.2）。

## 结论与说明

- 该决策与 AGENTS.md 的技术栈约束（React + TypeScript / FastAPI / PostgreSQL / 模块化单体）一致，不改变后端架构。
- 文档中页面路由表为组织建议，实现时必须与 `docs/design/page-structure.md` 对齐，尚未逐一核对（`apps/web` 仍是预留目录）。
- 与既有规范的衔接：SPA 规范中的「服务端事实源」「答案可见性」「严格模考服务端计时」等要求与 frontend-spec 原有章节及 P-007/P-011/P-013 一致，未发现冲突。

## 测试执行情况

- 无代码变更，未运行任何测试或静态检查（如实记录，无虚报）。
- 文档一致性为人工核对（frontend-spec 内部章节、decisions README、progress）。

## 剩余风险

- 具体路由路径（`/study/practice/*` 等）与 `page-structure.md` 的最终统一推迟到 M2.2 Task 09 实现时完成。
- React Router Framework Mode 的 prerender/SPA fallback 具体行为（含 `__spa-fallback.html` 命名）以届时实际构建产物验证为准。
