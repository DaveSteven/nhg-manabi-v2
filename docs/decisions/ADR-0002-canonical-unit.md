# ADR-0002：统一 Unit 及来源解耦

- 状态：已采用的设计方向（发布合规及具体实现仍需验收）
- 日期：2026-11-15

## 决定

Raw 只读→ETL→Canonical Draft→校验→Release；任何 Question 恰属一个 Unit；单题亦为 Unit。Unit 是完整抽题和反馈边界，Question 是评分边界；source ID 仅留 provenance。

## 理由

减少来源耦合、维护成本和历史记录污染，同时保持小团队可实现的复杂度。

## 影响

更改本决策必须同步更新 `docs/decisions/README.md`、对应业务规范、数据库/接口测试，迁移已发布内容需要单独评估。
