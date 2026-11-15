# 代码规范 · v2 开发约束

## 总原则

- 优先可读性、领域边界、测试可重复性，不提前“企业级架构”化。一次任务围绕一个可验收用户能力形成纵向切片。
- 遵守 `AGENTS.md` 和受影响模块规范；需求有冲突先记录，不在编码过程中擅自另起产品方案。
- 不能直接修改 1.0 仓库、数据库或脚本；不能提交 `.env`、token、真实用户/未授权题库二进制。

## Python / FastAPI

- Python ≥3.11，使用类型标注和明确的 Pydantic 请求/响应 DTO；路由处理尽量薄，业务规则在 service/domain 层。
- SQLAlchemy 2.0、参数化语句、显式事务；所有 DB schema 变化通过 Alembic；不在运行时补表补列。
- API 响应**禁止**不恰当地序列化 ORM 模型，特别是 `release_answer_keys`、管理员审核信息、用户隐私。
- 对 `submit_unit`/`finish_session`/`publish_release` 实现幂等，冲突返回明确错误；写入后历史不可被普通 UPDATE 覆盖。
- 对未被发布许可的 Unit 不能使用公开练习查询暴露。

## React / TypeScript

- TypeScript 严格类型检查（建议），业务 schema 与 API DTO 分层；数据请求状态与 UI 本地状态分开。
- UI 不根据旧版 `question_type=23` 数值或上游 objectId 决定显示逻辑；依赖 Canonical 语义 `unit.kind`、`question_type_id`。
- 富文本组件只支持受控 RichText；键盘和触控目标符合设计规范；默认不滥用全局样式覆盖。
- 学生界面与管理员权限入口分开；共享组件不共享未经授权的数据。

## Git / 迁移 / Review

- 以 `nhg-manabi-v2` 为根，不涉及 `nhg-manabi`；提交需包含对应测试和文档修改。
- 不修改已在环境应用过的 Alembic 历史 revision；新增迁移，验证升级与必要的回滚路径。
- 迁移/批量导入前确认数据库连接串属于 v2 dev；先检查备份、git diff、环境变量，不对生产执行未授权动作。
- 接入其他 Agent 先读 `AGENTS.md`，按本任务涉及的子模块选文档。

## 建议验证命令（按实际工程依赖完善）

```bash
# 当前已经提供的后端基础检查（无需数据库）
cd backend
pytest -q
alembic upgrade head --sql > /tmp/nhg-v2-schema.sql

# 真正的 PG 迁移必须在本地启动容器并配置环境之后执行
alembic upgrade head
```

前端尚未初始化 `package.json`，不能假装存在 `npm test`；待建立后再固定 npm/pnpm 工具链、lint、typecheck、test 命令。
