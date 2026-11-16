# Devlog · M2 媒体读取前置依赖（media storage + serving）

**日期：** 2026-11-16
**范围：** Commit A（M2.2 Task 09–11 的后端前置依赖）——独立的媒体导入/同步步骤 + Release 范围公开媒体读取接口。不改现有 JSONL 元数据 importer 的行为。

## 用户确认的决策（2026-11-16）

- 采用「FastAPI 最小媒体读取接口 + 本地受控媒体存储」，作为 Task 11 听力播放的前置依赖。
- `asset_id` 保持 Canonical 稳定业务标识，不因落盘改名；存储文件名一律 SHA-256（音频与图片同一标准），支持去重；原始文件名/路径仅存内部来源映射，不向学生端暴露。
- 独立媒体导入/同步步骤，与元数据 importer 分离；不让题库元数据导入隐式访问网络或修改 Raw 文件；只从确认的本地来源（`data/samples`）复制，不自动下载远程资源。
- 落盘前校验（大小/实际 MIME/SHA-256 匹配 Canonical 记录/ffprobe 可播放性与时长），临时文件 + 原子改名；重复导入幂等；重试不得破坏已校验文件。
- 存储与发布分离：文件落盘 ≠ 审核通过；接口先校验 Release 状态与资产关联再读内部存储；不把媒体目录挂成公开静态目录。
- 字幕 cues 不随本次公开；本次只做播放/暂停、进度、加载失败与移动端播放器布局。
- 自动化测试本次做到 Mock API 集成层（详见 M2.2 计划验收约定）；E2E 属 M2.3。

## 来源核实结论

- Canonical `assets.jsonl` 元数据完整：sha256 / size_bytes / 嗅探 MIME / ffprobe 时长 / `availability`；`storage_key` 是纯派生命名（`assets/<exam>/<sha16>.<ext>`），不是实际存储位置。
- **Canonical 包目录不含资产二进制**，staging/importer 从未落盘媒体文件；也无 asset→Raw 路径的 provenance 行。
- 二进制实际存在于 Raw 样本本地：`data/samples/N*/<exam>/resources.json` 清单声明 `path/size/contentType`（N5 抽查：29 mp3 + 14 png，全部可本地读取）。asset→文件的可靠映射只能按内容寻址（对 Raw 清单逐文件重算 SHA-256 匹配），不能假设路径。

## 改动内容

1. **Alembic `0004_media_storage`**：新增 `media_storage` 映射表（asset_id 主键、`stored|unavailable` 状态、实际测得 hash/size/mime/时长、内部 `source_path` 来源、`rule_version`、`last_error` JSONB 可查询诊断）。纯增量；不写入 Release 快照。沿用 0003 先例：0001 之后的新表只定义在迁移中，不进 schema metadata。
2. **`backend/app/media_sync.py` + `python -m app.media_sync`**：从 Canonical 包 `assets.jsonl` 读资产 → 扫描 `--source-root` 的 Raw `resources.json` 清单按 SHA-256 建索引 → 逐资产校验（sha 格式、来源存在、大小、复制时二次哈希、MIME 嗅探、音频 ffprobe 可播放 + 时长（容差 2000ms，超差告警不失败））→ 临时文件 + `os.replace` 原子落盘到 `<root>/<sha[:2]>/<sha[2:4]>/<sha256>.<ext>` → upsert `media_storage`。损坏的既有落盘文件在来源完整校验后原子修复并告警；失败标记 `unavailable` + `last_error`（source_missing / size_mismatch / hash_mismatch / mime_mismatch / mime_unknown / audio_unplayable / store_unreadable）。
3. **`backend/app/api/media.py`**：`GET/HEAD /api/releases/{release_id}/assets/{asset_id}`。门槛链：release `state='published'` → 资产被该 release 经 complete Unit 关联（materials / question media / option media / exam media 四条路径，前三条要求关联 Unit `conversion_status='complete'`）→ `media_assets.availability <> 'corrupt'` 且 `media_storage.state='stored'` 且 `stored_sha256 == sha256` → 文件存在。所有拒绝统一 404（`release not published` / `asset unavailable`），不泄露存在性。支持 RFC 9110 单段 Range（206 + `Content-Range`、416 + `bytes */size`、畸形 Range 忽略回 200 全量）、精确 `Content-Length`、`Accept-Ranges: bytes`、内容寻址不可变缓存头。路径解析以 SHA 正则 + resolve 包含校验防目录穿越。历史（非当前指针）published release 照常可读（P-013）。
4. **`main.py`** 挂载 media router；`.env.example` 新增 `MEDIA_STORAGE_DIR=data/v2-media`；`.gitignore` 增加 `data/v2-media/`。
5. **文档**：`docs/development/M2.2-frontend-implementation.md` §6 重写媒体策略为已落地契约，§8 契约表新增媒体行。

## 实际执行的测试与结果

`source .env; DATABASE_URL=<dev>_test pytest`（隔离测试库，alembic upgrade head 自动含 0004）：

- 新增 `tests/test_media_sync.py`（9 passed）：happy path（音频/图片落盘、映射字段、分片路径）、重复导入幂等（不重写已存文件）、来源缺失、大小不符、MIME 不符、非法 sha、ID3 魔数但 ffprobe 不可解码、落盘损坏自动修复、失败后重试恢复且不破坏已校验文件。
- 新增 `tests/test_media_api.py`（9 passed）：200 全量 GET（Content-Type/Length/Accept-Ranges/Cache-Control）、HEAD、Range 206 三种形式（`100-199` / `-50` / `100-`）与 416、畸形 Range 回 200、draft release 404、未关联资产 404、缺 storage 行 404、storage 与注册表哈希不符 404、磁盘文件缺失 404、未知 release/asset 404、**非当前指针的历史 published release 仍 200**。
- 全量回归：**103 passed, 2 skipped**（= 旧 85 passed + 新增 18 passed；2 个 skip 是 `test_playback_compatibility.py`：本次运行时本地已无 `data/samples/Archive.zip`（progress 记录 M1.5 时该文件存在，应为本地环境变化），与本次改动无关，如实记录）。
- 迁移验证：测试库 `upgrade → downgrade -1 → upgrade` 通过；开发库 `alembic upgrade head` 已应用（无数据，纯建表）。

## 未执行 / 留待后续

- **真实浏览器播放/拖动冒烟**：待 Commit 3 音频播放器 + 前端页面落地后进行（真实 API 全栈 Range 行为已被 TestClient 覆盖，但浏览器 Audio 元素行为未验证）。
- **真实样本（N1–N5）媒体同步**：机制已就绪，但会向开发库写入 media_assets/media_storage 行；按约定不自动执行，待你确认后跑 `python -m app.media_sync data/normalized_v2/JLPTGO-N5-2018-07-r1 --source-root data/samples/N5` 等逐包命令。
- 生产部署形态（Nginx/对象存储替身、媒体目录运维）不在本次范围；前端资源定位契约（`release_id + asset_id`）已稳定。
- 真实样本 Long-mp3（27MB 整卷音频）的 Range 性能未做压测。

## 剩余风险

- `media_storage` 与 `media_assets` 是松耦合（无外键，asset_id 文本键）；由接口的哈希一致性校验兜底。
- 媒体同步与 publisher 都可能写 `media_assets` 之外的同名资产场景未合并（本次 sync 完全不写 `media_assets`，无双写冲突）。
- N4 的 4 个确证字幕越界（open blocking）与本次无关，仍阻止 N4 发布。
