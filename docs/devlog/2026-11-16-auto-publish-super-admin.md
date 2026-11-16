# 2026-11-16 · 入库默认发布 + 管理员仅超级管理员（ADR-0010）

## 范围
按用户指示：(1) 先不做审核流程，入库即默认发布到前端；(2) 管理员角色先只做超级管理员；(3) 生成超级管理员 `admin`。本条为后端与文档部分；管理端前端登录见后续日志。

## 决策与实现（ADR-0010）
- `PUBLISH_POLICY=auto|gated`（默认 `auto`）。`python -m app.importer` 暂存成功后默认调用 `auto_publish_package`：生成 release 并发布，**跳过**答案键审核/Agent 标记/Issue/版权/媒体 verified 门槛；`--no-publish` 或 `PUBLISH_POLICY=gated` 只暂存。
- **不改写事实**：auto 不把任何答案键或 Unit 标成已验证；写入 `publication_decisions(decision='auto_published')`，备注 JSON 记录未验证答案键数、非 conversion-complete Unit 数、未验证媒体数、是否有 `rights_confirmed`。
- 保留的结构性保护：导入校验错误仍阻止暂存；公开 API 仍对非 conversion-complete Unit 返回 404；媒体接口仍要求存储文件哈希校验；答案正式提交前不下发（答案可见性红线不变）。原 gated 流程的代码与测试全部保留。
- 管理员：Alembic `0006` 把 `admin_users.role` CHECK 收窄为 `super_admin`；`require_admin()` 无角色参数；`create-admin` 去掉 `--role`。
- 文档：ADR-0010；更新 `AGENTS.md` 第三节、`content-review-policy.md` 文首、decisions README（P-020）、ADR-0009 修订标注、`.env.example`。**AGENTS.md 是用户的规则文件，此处按用户明确指示做最小修改。**

## 超级管理员账号
已在开发库创建 `admin`（super_admin）。口令随机生成，写入被 gitignore 的 `.local/admin-initial-credentials.txt`（权限 600），**未写入聊天、日志或仓库**。建议首次登录后用 `python -m app.admin_cli reset-password admin` 改密。

## 测试（真实 PG）
- 新增 `test_auto_publish.py`（5 例，含参数化）：auto 发布且不改写审核状态并记录未验证项、幂等、gated 仍拒绝未验证、导入 CLI 默认发布、`--no-publish` / `PUBLISH_POLICY=gated` 只暂存。先写后见失败再实现。
- `test_admin_auth.py` 改为单角色（角色矩阵测试替换为 super_admin + 401 测试）。
- 后端全量 127 passed, 2 skipped（skip 为缺本地 Canonical Archive.zip，环境性）。
- 迁移 0006：开发库升级；测试库 downgrade→upgrade 往返通过。

## 风险（用户已决定承担，见 ADR-0010）
- 未校验的答案会展示给学生并判题；N2 实测单次 Agent 作答也会错。
- 版权/使用许可不再是发布门槛。
- 仅本机开发库行为变化；部署/推送/合并 main 仍需另行授权。
- 已发布的 N2 r4 不受影响；N1/N3/N4/N5 仍未导入发布（需运行导入命令）。
