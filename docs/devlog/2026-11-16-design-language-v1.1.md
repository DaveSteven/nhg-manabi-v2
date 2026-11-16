# Devlog · 2026-11-16 视觉设计语言 v1.1 文档更新

## 范围

纯文档任务：按用户提供的完整稿件，将 `docs/design/design-system.md` 从「Design System v2 草案」更新为「视觉设计语言 v1.1」（用户端适用）。用户随后补充了基准 `:root` Token 清单，一并写入文档 §13.1。无代码改动。

## 主要内容变化

- **顶部导航**：由「活动项细线/字重强调」改为「左侧品牌 + 居中胶囊导航（560–600px、56px 高）+ 右侧用户控制」；导航 Active 为浅樱底色，明确不使用底部选中线；**页面级 Tab 仍保持扁平下划线**（与 AGENTS.md 既有约束一致）。
- **色彩 Token 更名/调值**：`canvas/paper` → `bg/surface`；新增 `--color-text-secondary`(#706B70)、`--color-text-muted`(#88838A)、`--color-surface-subtle`(#F4F1ED)；`primary-strong #93354F` → `primary-hover #A53C5B`；`primary-soft #FBE3EA` → `#F6E8EC`；`border #E6E3E0` → `#E8E3DF`。
- **新增章节**：设计理念/关键词/明确避免清单、首页布局语言（`/study` 定位、顶部信息区、装饰元素边界）、卡片设计（专项/继续练习/历年试卷）、圆角/阴影/动效体系、响应式分档、无障碍要求、品牌页与学习页差异、Figma 交付清单、设计验收标准。
- **§13.1 基准 Token 清单**：用户提供的 Brand/Neutral/Radius/Layout/Shadow/Motion Token 原样收录；语义色（success `#2F7D4F`、danger `#C73E3A`、warning `#B98A1E`）为文档 §2.3 必需但用户清单未含，标注「沿用现有实现起始值」保留；间距/字号/音频 dock 组件级变量说明保留。

## 同步修订

- `docs/decisions/README.md` P-003 备注更新：记录 v1.1 胶囊导航决定与 §13.1 Token 清单指引（视觉方向未变，不新增 ADR）。

## 与实现的差距（已知，未在本次处理）

- `apps/web/app/styles/tokens.scss` 仍使用旧 Token 名（`--color-canvas`、`--color-paper`、`--color-muted`、`--color-primary-strong`）与部分旧值（`primary-soft #FBE3EA`、`border #E6E3E0`、`radius-sm 8px`、`--content-max: 1180px`）。Token 重命名会波及 `global.scss`/`_practice.scss`/`_catalog.scss`，属代码任务，待用户确认后单独执行。
- 现行顶导航实现为通栏式（非胶囊容器），页面级 Tab 为下划线——前者需按 v1.1 重做，后者与 v1.1 一致。
- 本次为文档更新，未替换旧版中两条记录、仅声明去向：深色主题色板仍在 `decisions/README.md`「尚未定稿」；动物头像资产备注（独立设计任务提供）未随 v1.1 稿件带入，如仍有效需用户确认后另行记录。

## 测试与检查

- 本次为纯文档变更，无代码测试可运行。已执行 `git diff --check`（结果见提交记录）；未运行任何前端/后端测试（无对应代码改动，如实声明）。

## 剩余风险

- 文档与前端 Token 命名暂时不一致，遵循 v1.1 实现新组件前需先完成 Token 对齐。
- 历年试卷三列、导航 560–600px 等量化值为建议值，待真实页面截图验收后修订。
- 工作区另有用户放置的未跟踪文件 `docs/design/JLPT GO 2.0 首页.png`（首页视觉稿），未包含在本次提交中，去留由用户决定。
