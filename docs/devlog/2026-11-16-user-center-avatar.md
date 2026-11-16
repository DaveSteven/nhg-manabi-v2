# devlog · 2026-11-16 · 用户中心与头像（ADR-0013）

## 范围
参考 v1 做用户中心：顶栏右上角只显示头像，头像素材沿用 v1，默认纯色头像，可编辑头像和昵称。

## 改动
**后端**：Alembic `0008_user_avatar`（`users.avatar` 可空，长度 CHECK）；`student_auth` 增加 `AVATAR_IDS` 白名单与 `UNSET` 哨兵（区分"未传"与"重置"）；`/api/me`、登录响应返回 `avatar`；`PATCH /api/me` 支持 `avatar`。
**前端**：12 张头像入 `app/assets/avatars`；`features/account/`（`avatars.ts`、`UserAvatar`、`AccountMenu`、`EditProfileDialog`、`AccountPage`）；路由 `/study/account`；`HeaderControls` 已登录只显示头像菜单；备考等级选择器移入用户中心；`_account.scss`；清理 `_auth.scss` 中不再使用的顶栏样式。`UserProfile` DTO 增加 `avatar`；旧 localStorage 缓存的资料没有该字段，按默认头像处理。
**文档**：ADR-0013、`frontend-spec.md` 路由表。

## 测试（真实结果）
- 后端：新增 5 例（默认 null、设置/保持/重置、与昵称同存、非法 id 字段级 400 且不改任何字段、无会话 401）。全量 **162 passed, 2 skipped**。
- 迁移：测试库 0008 downgrade → 0007 → upgrade 均成功；Docker `migrate` 已把开发库升到 0008。
- 前端：新增 `account.test.tsx` 9 例，重写 HeaderControls 5 例。typecheck 通过；vitest **19 文件 / 152 passed**；`pnpm build` 与产物检查通过。
- 容器内真实浏览器（桌面 + 375px）：旧缓存资料（无 avatar）→ 顶栏只显示纯色头像"D" → 菜单（用户中心/退出登录）→ 用户中心 → 编辑资料 → 选柴犬 + 昵称改"小柴" → 保存，顶栏与页面即时更新；`/api/me` 与数据库均为 `小柴 / shiba-inu`；12 张图均加载（`naturalWidth=256`）；点击遮罩关闭弹窗。

## 过程中发现
- `fieldErrorFrom` 在真实流程中取不到 `message`（`normalizeErrorBody` 把 `message` 从 details 里拆走了），现有注册页只是碰巧由兜底路径显示了同样文案。编辑弹窗改用 `ApiError.status===400` 的 `message`，未改动旧函数；它在真实场景下基本恒为 null，建议单独清理。

## 未做 / 风险
- 退出登录后再次登录看到的头像、账户菜单键盘上下键导航、Firefox/Safari 未测。
- 窄屏下头像被挤到导航下一行（沿用原顶栏网格行为），未专门设计。
- 用户中心没有统计/收藏/改密码/改邮箱；头像素材来自 v1，未核实原始出处。
- 测试学生 `docker-e2e@example.test` 现为 `小柴 / shiba-inu`。

## 续：两栏布局与头像直达（同日，用户追加指示）
- 用户中心改为参考 v1 的左右两栏：左身份卡、右分组卡（备考目标 / 账号），窄屏单列。
- 顶栏头像改为直接链接到 `/study/account`，删除账户菜单（`AccountMenu`）；`signOut` 抽到 `features/account/signOut.ts`；退出登录仅在用户中心。
- 测试：typecheck 通过；vitest **19 文件 / 151 passed**（菜单测试替换为头像链接/导航测试，邮箱现在出现两处，断言放宽为 getAllByText）；`pnpm build` 与产物检查通过。web 容器重建后桌面与 375px 浏览器截图确认：点头像直达、两栏、窄屏单列。
- 未做：右栏仍只有两组真实设置（v1 的学习数据/收藏需要 M3 数据模型）；`docs` 里 ADR-0013 已同步修订。

## 续：顶栏头像去底、放大（同日）
- 顶栏头像：图片头像不再有描边与底色（`.user-avatar-img` 去 border/background/裁切），尺寸 40→52px（按钮 56px），悬停轻微放大。纯色默认头像仍保留其颜色（那就是它的头像本体）。用户中心内的头像样式未改。
- 测试：typecheck 通过；vitest 19 文件 / 151 passed；web 容器重建后桌面截图确认（柴犬无圆环无底色）。未专门测 375px 下的头像尺寸，也未新增针对该样式的自动化测试（样式改动无断言）。

## 续：首页按备考等级筛选（同日，用户反馈）
- 问题：首页「历年试卷」入口一直显示全部等级的最新 3 套，没有用备考等级；登录后也看不到当前等级（等级选择器已移入用户中心）。
- 修复：`StudyHome` 用 `useLevel()`（登录读资料，访客读本地偏好）过滤首页试卷入口；标题旁显示等级标签（链接到用户中心）；该等级无试卷时给出说明而不是回退显示其他等级。继续练习卡片仍用完整目录匹配，不受影响。
- 测试：新增 3 例（登录按等级过滤+标签、等级无试卷提示、无等级显示全部且无标签）；typecheck 通过；vitest 19 文件 / 154 passed（stderr 仍有既知 ECONNREFUSED 噪声）；build 通过。容器内真实浏览器：测试学生（N5）首页标签「N5」，3 张卡全为 N5。
- 遗留：等级只在首页入口标题旁与用户中心可见，顶栏不再显示；「查看全部」仍进入试卷列表（由偏好种入同一等级筛选）。

## 续：等级选择器放回顶栏（同日，用户指示）
- 已登录顶栏右侧 = 备考等级选择器 + 头像（头像仍直达用户中心）；用户中心内的等级选择保留。首页标题旁的等级标签移除（顶栏已显示）。访客仍是 登录/注册。
- 修改 ADR-0013 第 1、2 条：顶栏为「等级 + 头像」，不再是只有头像。
- 过程事故：移除标签时我用 `index()` 匹配到文件里第一个 `section-hint`，把 `StudyHome.tsx` 里一段内容复制了一份，导致 2 个测试失败；已 `git checkout` 恢复该文件并用唯一匹配重做，未提交过错误版本。
- 测试：typecheck 通过；vitest 19 文件 / 155 passed（新增顶栏改等级同步资料 1 例，调整顶栏/首页断言）；build 通过。容器内浏览器：顶栏显示「N5」+头像；改为 N4 后首页立即只显示 N4 的 3 套，数据库 `current_level=N4`（随后已把测试学生改回 N5）。

## 续：用户中心头像去边框与底色（同日）
- 图片头像的「无边框、无底色、不裁切」（`.user-avatar-img`）从仅顶栏改为全局，用户中心身份卡与编辑弹窗预览同样生效；纯色默认头像不变。容器内核对计算样式：border 0、background 透明、overflow visible。
- 注意：头像图片素材本身自带一个浅粉圆底（画布采样 (128,4) 处不透明），所以大尺寸下仍能看到粉色圆；这是素材内容，不是 CSS。如需完全透明背景，要对 12 张素材做抠图处理，未做。
- 测试：vitest 19 文件 / 155 passed（样式改动无新增断言）；build 通过。
