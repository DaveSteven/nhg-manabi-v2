# 项目总体进度

最后更新：2026-11-15

## 已完成

- 项目文档体系（architecture / product / design / data / development / decisions ADR-0001~0004）。
- 后端骨架：FastAPI `/health`、SQLAlchemy 32 表 metadata、Alembic 0001 初始迁移（静态 DDL）。
- Docker Compose PostgreSQL 16（容器 `nhg-manabi-v2-db`，`127.0.0.1:55432`）。
- 数据库真实落地：迁移升级/回滚/再升级验证通过；32 表、32 CHECK、46 外键、60 索引。
- **Canonical staging importer**：验包/哈希/结构校验/幂等 staging 全流程；真实五套样本（N5–N1）已 staged，计数与规范基准吻合（20 Section/83 Layer/440 Unit/498 Question/204 Asset）；重复导入幂等；失败回滚带诊断；published 表保持为空。
- **Raw → Canonical 转换落地**：`scripts/canonical_v2.py` 收编入仓；对 Raw 原始数据（data/samples/N{1..5}）按级各抽一套完成转换，产物与既有 Canonical 包字节级一致（除时间戳），content_hash 逐包相同，端到端确定性验证成立。
- **M1.5 内容清洗审计与字幕时间轴**：原始 HTML 属性全量清单（A/B/C 分类）；Canonical 残留扫描零发现；字幕时间轴覆盖率 100%（1202 cue，143 Unit 全部配对音频，基准=Unit 音频）；越界 21 / 大间隔 20 标 needs_review 固化回归；逐段播放数据兼容性测试通过；五包重转内容字节级一致（内容哈希零变化）；转换器 +0.1.1（属性审计）、验证器增强（缺失 vs 0、大间隔、时长越界）。
- 测试：48 个测试全部通过（播放兼容 2、review_sync 9、publisher/API 7、导入器 20、迁移一致性 2、Schema 编译 3、健康检查 1、真实 PG 约束 5 等在内）。

## 进行中

- 无。

## 未开始（按依赖顺序）

1. 运行真实 Agent 校验（按 contract 批量产出五套题库结果 → sync → 解锁 promote）。
2. 发布快照不可变的 DB 触发器 / restricted DB role。
3. 认证/用户体系（当前内部 API 仅共享令牌）。
4. 作答 API（Session/Unit 提交、计分、自动保存恢复）。
5. React 前端（四学科首页、专项练习、历年试卷、我的学习）。

## 已知缺口 / 风险

- 未配置 ruff/mypy 等静态检查工具。
- 发布快照表无 DB 级不可变约束，靠应用纪律；restricted role 上线前必须补。
- Layer/Section 关联等 4 处真实数据包与 canonical-schema 草案不一致（见 2026-11-15 importer 日志），文档待修订。
- 转换器 `SELECTIONS` 硬编码；转换其余约 130 套归档前需改为按 `exams.json` 选择。
- `content_reviews` 最新判定按 checked_at 排序，同秒批次顺序不确定；「latest pass 可清除早前 needs_review」是当前政策选择，如需更保守需产品确认。
