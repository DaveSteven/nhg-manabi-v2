# 2026-11-17 · 专项练习首版闭环

## 范围
按 `docs/development/topic-practice-next.md` 阶段 1–4：题型目录、服务端智能抽样、配置页与入口、作答/恢复/结果/再练一组。无 Schema 变更，无架构决策变化（不需要 ADR）；严格模拟、错题本、统计不在范围。

## 改动
- 后端：`app/topic_sampling.py`（纯函数抽样策略）、`app/api/topic_practice.py`（`GET /api/topic-practice/types?level=`、`POST /api/topic-practice/sessions`）；`practice._create_session_tx` 增加 `config_extra`，专项会话仍是普通 `practice` 会话（单活跃、`replace_active` 原子替换、每个 Unit 绑定自己的 release、草稿/提交/反馈门控全部复用）。会话 `config.topic` 记录等级/题型/数量。
- 候选池：当前发布 release + `conversion_status='complete'` + 等级匹配 + 单一 `question_type_id`；完整 Unit 不拆分、同次不重复；数量超限 422 `count_exceeds_available`（带可用数）、无候选 422 `no_candidates`。
- 抽样：软配额 25% 复习 / 75% 新题，互相补足；复习权重 = 0.2 + 2×平滑最近答错率 + 0.7×久未练习 + 0.5/(1+练习次数)，加权无放回抽样。历史仅来自正式提交（practice + quick_practice），草稿不计，skip 不覆盖最近有效正误，按 (exam_id, unit_id) 跨 release 归并。每次请求现算，未建缓存。
- 前端：`/study/practice` 配置页（学科 Tab → 题型卡片含真实「共 N 篇/组/题 · 未练习 M」→ 数量预设/输入 + 超限提示 → 反馈方式 → 开始）；顶栏「专项」启用；首页四科卡片改为链接并预选学科、去掉「暂未开放」；冲突复用 `ActiveSessionConflictDialog`（继续旧练习 / 原子替换）；练习页与结果页对专项会话使用「专项练习 ›」面包屑、返回专项练习；结果页「再练一组」按相同配置重新抽题；`PracticeSession.config` DTO 增加可选 `topic`。
- 文档：`topic-practice-next.md` 追加实现记录，`README.md`、`AGENTS.md` 当前状态、`page-structure.md` 路由同步。

## 测试（实际执行）
- 后端 `pytest`（真实 PG 测试库）：195 passed、2 skipped（新增抽样纯函数 9 项、API 7 项：目录计数与等级过滤、鉴权与无答案泄漏、整组固定 release、超限/无候选/非法数量、冲突 409 与原子替换保留已提交答案、草稿不计历史/全未答提交算已练/跨账号隔离、quick 提交计入历史且两种模式互不占名额）。
- 前端 `vitest`：27 文件 / 237 passed（新增配置页 6 项、topicModel 3 项、结果页 2 项，更新 TopNav/StudyHome）；`tsc --noEmit`、`npm run build` 通过。
- 真实开发库只读冒烟：N2 返回 21 个题型及真实数量；创建 5 组汉字读音会话得到跨卷 Unit；测试会话已清理。
- 容器 `docker compose build migrate web && up -d`：`/study/practice` 200，未登录 `/api/topic-practice/types` 401。

## 未执行 / 剩余风险
- 未做真实浏览器走查（登录后配置页、多组作答、刷新恢复、结果与再练一组）、Firefox/Safari、深色模式、窄屏；`.topic-*` 样式未目检。
- 抽样参数未经真实数据调优；未做同题型邻近重复规避、`user_question_progress` 缓存、「只复习最近仍错」入口；历史查询每次扫描该用户该等级提交记录，数据量大后需评估索引/缓存。
- 专项会话练习页标题仍为「练习 · 组 N」，未展示 Unit 所属年份/试卷；读解部分题型 `is_provisional`，页面仅提示名称可能调整。
- 未推送、未部署、未合并 main。
