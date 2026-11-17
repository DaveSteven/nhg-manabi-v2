# 按钮标准化实现 · 2026-11-17

## 范围
按 `docs/design/button-spec.md` 把学生端操作按钮统一为共享组件。无业务规则、架构、数据库变化，无需 ADR。

## 改动
- 新增 `components/Button.tsx`（`Button`、`ButtonLink`；variant primary/secondary/ghost/danger，size sm/md/lg，loading → aria-busy 且阻止重复触发，默认 type=button）与 `styles/_button.scss`（胶囊圆角、36/44/48px、hover/pressed/focus-visible/disabled/loading、减少动态效果、按钮 token）。
- 迁移：普通练习、统一反馈练习、提交/冲突对话框、专项配置「开始练习」、结果页（再练一组 Primary；查看答案与解析、返回专项练习/返回试卷列表为 Secondary 链接按钮）、用户中心、编辑资料、登录/注册等认证表单、顶栏登录/注册、首页继续练习。
- 删除页面各自定义的 `.primary`、`.primary-link`、`.secondary-button`、`.account-signin/signup` 及 practice 作用域按钮样式。
- 已完成练习复盘中「下一题」改 Secondary，避免与「查看结果」同为 Primary；上一题/下一题成对同宽。
- 未改：题号导航、专项题型卡片/题数 chip、Tab、选项、音频控件、行内链接（独立规范）；`.unit-start` 为已无引用的遗留样式，未删。

## 检查
- `pnpm typecheck` 通过；`pnpm test`：28 文件 246 passed（迁移前，随后新增 Button 测试 3 passed）；`pnpm build` 含产物检查通过。
- 未执行：真实浏览器视觉走查、375px/200% 缩放、键盘焦点实测、后端测试（未改后端）。

## 风险
- loading 取代部分 `disabled={isPending}`：按钮不再带 disabled 属性而用 aria-busy/aria-disabled，依赖该属性的外部测试可能受影响（现有测试全部通过）。
- 管理端沿用独立体系，未改。
