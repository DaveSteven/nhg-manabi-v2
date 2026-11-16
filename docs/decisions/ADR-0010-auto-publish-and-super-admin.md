# ADR-0010：入库默认发布；管理员只做超级管理员

- 状态：已采用（用户 2026-11-16 指示："先不做审核流程了，入库则默认发布到前端；管理员角色先做超级管理员"）
- 日期：2026-11-16
- 修订：ADR-0009 的三级角色（仅角色部分）；暂停执行 `content-review-policy.md` / `AGENTS.md` 中的发布门槛（默认策略）

## 决定

1. **发布策略 `PUBLISH_POLICY`**：`auto`（默认）或 `gated`。
   - `auto`：导入 CLI（`python -m app.importer`）暂存成功后，自动生成 release 并发布（`auto_publish_package`），**不检查**答案键审核状态、Agent/人工标记、Issue、`rights_confirmed`、媒体 verified。
   - `gated`（或 `--no-publish`）：只暂存；发布仍走原来的 `publish` → 审核 → `confirm-rights` → `promote` 门槛，全部代码与测试保留。
2. **不改写事实**：`auto` 不会把任何答案键或 Unit 标成"已验证"。`release_answer_keys.review_status` 保持原值；发布时写入 `publication_decisions(decision='auto_published')`，其 JSON 备注列出**未验证**的答案键数、非 conversion-complete 的 Unit 数、未验证媒体数、是否已有 `rights_confirmed`，审计上不暗示"已审核"。
3. **仍然生效的结构性保护（不属于审核流程）**：导入校验错误（结构/哈希/引用）照常阻止暂存；公开 API 仍对 `conversion_status != complete` 的 Unit 返回 404；媒体接口仍要求存储文件哈希校验；学生端在正式提交前拿不到答案/解析（答案可见性红线不变）。
4. **管理员只有 `super_admin`**：Alembic `0006` 把 `admin_users.role` 的 CHECK 收窄为 `super_admin`；`require_admin()` 无角色参数；`create-admin` 命令不再有 `--role`。三级角色待审核流程恢复时再设计。
5. 不做管理端审核流程；管理端先做登录，后续再按需加页面。

## 风险（由用户决定承担，写入此处以便追溯）

- **未经校验的答案会直接展示给学生并用于判题**：本项目 N2 的 QA 经验表明单次 Agent 作答也会出错（首轮 4 题答错）；未校验的答案键可能是错的，学生会被判错或被给出错误解析。
- **版权/使用许可不再是门槛**：`rights_confirmed` 不再阻止发布；真实历年题的使用权风险由内容所有者承担。AGENTS.md 原要求"发布前必须记录 rights_confirmed"对默认策略暂停。
- A/B 启发式切分的 Unit 因 API 仍隐藏而不会出现；如需发布，需另行决定。
- 本 ADR 只改变**本机开发库**的发布行为；**部署、推送、合并 `main` 仍须用户另行明确授权**（AGENTS.md 分支与上线流程不变）。
- 回退：设置 `PUBLISH_POLICY=gated` 即恢复原门槛；已发布内容不会被自动撤回。

## 影响

- 新增 `auto_publish_package`（`app/publisher.py`）、导入 CLI 的 `--no-publish` 与 `PUBLISH_POLICY`、Alembic `0006`；`.env.example` 增加 `PUBLISH_POLICY`。
- 同步更新：`AGENTS.md`（第三节）、`docs/data/content-review-policy.md`（文首说明）、`docs/decisions/README.md`（P-020、导航）、`ADR-0009`（修订标注）。
