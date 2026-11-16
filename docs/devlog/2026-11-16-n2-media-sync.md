# 2026-11-16 · N2 2018-12 媒体同步（真实样本）

## 范围
对 `JLPTGO-N2-2018-12-r1` 执行独立媒体同步步骤，把 Raw 样本中的媒体按 SHA-256 内容寻址落盘到受控目录并写入 `media_storage` 映射。**不涉及发布**：未写 published 表、未触碰 release 快照、未记录 `rights_confirmed`，开发库无任何 current release。

## 执行
```
python -m app.media_sync data/normalized_v2/JLPTGO-N2-2018-12-r1 \
  --source-root data/samples/N2 --storage-dir data/v2-media
```
- 来源只读（`data/samples/N2`，2.1G，gitignored）；目标 `data/v2-media`（78M，已被 `.gitignore` 的 `data/v2-media*/` 忽略，工作区干净）。
- 结果：`assets_total=37, stored=37, unavailable=0, issues=[], warnings=[]`（35 个 mp3 + 2 个 png）。
- 重跑一次：仍 `stored=37, unavailable=0`（幂等）。

## 独立核对（只读）
- `media_storage` 37 行全为 `stored`；MIME 仅 `audio/mpeg`、`image/png`。
- 逐文件重算 SHA-256：与 `media_assets.sha256`、`media_storage.stored_sha256` 三者一致，文件存在、大小一致；不一致/缺失 0。
- 音频 ffprobe 实测时长与声明时长最大差 9 ms。
- `exam_current_releases` 仍为 0 行。

## 未执行 / 未覆盖
- 未运行后端 pytest（本次未改代码）；媒体 API 端到端（Range 206 等）未对真实 N2 文件复测，因无 published release，API 对 draft 仍应 404（未实测）。
- 未听音频：文件可解码、时长吻合，不代表内容正确；听力 30 题仍无人校验答案。
- 本轮不涉及 N1/N3/N4/N5 媒体；其来源根目录各自同步。
- `data/v2-media` 仅存本机；部署时需另行同步，未设计备份。

## 剩余发布门槛（N2）
听力 30 题校验；4 道 `needs_review` 人工确认（8 条阻断 Issue）；`rights_confirmed`；之后才可 promote。
