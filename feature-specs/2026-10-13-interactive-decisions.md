# 对话内选答与共同决定续接

来源：thread_mv645ot2dp9vz5uw；用户授权 message:0001791876293513-000018-756e3ea1。
责任：task:work:0001791876389359-000019-c174b617，砚砚独立开发；用户 message:0001791877252113-000035-51211952 明确不再联系月野兔（额度不足）。
关联：F096（选择控件）、F306（原生运行时交互）、F264（当前工作投递）。

tips_exempt: 问题卡片在作答处直接显示键盘操作提示；该能力由猫在需要共同决定时发起，无独立设置入口。

## 已接受的结果

用户在当前对话里用上下键、回车、鼠标或触屏直接回答结构化问题，回答后自动续接原任务，不用重复交代。共同决定只保留一个对人入口；明确依赖答案的工作等待，无关调查和帮助用户决定的讨论继续；答案先进入共同上下文，再恢复相关猫。

用户已接受默认边界：未答不视为同意、不自动过期；暂不决定保留等待；取消只取消本项；支持自定义回答；普通聊天不当答案；修改决定保留历史，已执行效果不能假装撤销；断线、刷新、重启如实呈现与恢复。原生通道可原轮回传，其余通道必须保留原任务上下文自动续接，普通 next_work 排队本身不算交付。

## 基线与未知

- F096 SelectInteraction 无列表方向键导航；当前提交以普通用户消息发送，未携带问题所属猫与原执行绑定。
- Codex 原生 blocking question 已经有 RuntimeInteractionService 和持久记录；异步 question 经 codex-async-question 转 F096，仍走普通消息。
- 退役的 cat_cafe_request_user_input 保持零副作用；不重启 300 秒长等待 MCP。
- 尚未取得用户具体失败调用的原始事件；必须用可区分的结构化 provider fixture、发送路径与完整浏览器旅程验证，不把源码候选当线上根因。
- 共同决定的依赖声明、调度等待与回答恢复由砚砚实现；月野兔未完成调度调查，其早前建议只作设计输入。

## 状态契约

- 问题身份精确绑定用户、thread、议题、提问者与当前工作；共同问题以明确议题引用合并，不按自然语言相似度猜。
- 等待、暂缓、已答、取消、运行通道失效分开。问题及回答持久化 TTL=0；执行通道失效不能删除问题，也不把旧卡转成新任务。
- 一次答复的持久事实先于相关工作恢复；重复提交、网络重试与多窗口只能承认一个版本。已提交不等于已读、已续跑。
- 明确依赖的交接在问题未决时不得开始；已运行工作在安全边界保留进度，收到决定后重新检查共同前提。
- 回答变更形成新版本；过时请求拒绝，不自动重复已经执行的动作。恢复必须使用原工作身份与可追溯结果。
- 权限审批与业务选答保持原归属；选项控件不产生额外授权。

Architecture cell: thread-chat-surface, identity-session, dispatch。
Map delta: extend existing question and dispatch boundaries; no separate approval store.

实现接缝：在既有 RuntimeInteractionStore 中保存 conversation question 与 CAS 版本、答案历史、续接 outbox；原生 provider waiter 保持原所有权。
问题发布 outbox 同时为真实提问者登记有原消息因果引用的 `handed_cvo` 回执；复用现有串行停止门，不假报任务完成、也不创建超时定时器。回答后原步骤通过 producer return 续接。
新非阻塞 `cat_cafe_conversation_question` 立即登记指定工作，等待期间不创建 runnable queue entry。回答持久化后，先发布共享事实，再经 PersistedQueueDelivery 交回原工作。
同一续接使用固定 idempotency key；答案修改不新建第二份执行。QueueProcessor 预启动与调用 provider 前重读 canonical question，补问未答则仅退回该 carrier；有效答案注入原任务 prompt。
Codex 结构化 async question 在 invocation 内按真实 owner/原消息接入同一服务；普通编号说明不猜测。F096 引导和一般动作继续用其原有行为，新任务提问不再用普通 send 控件伪装等待。
卡片展示持久答复、历史、暂缓/取消及真实续接回执；安排执行不写成已读取，只有原续接调用 read 后记录 consumedVersion。

## 工作单元

1. RED→GREEN：F096 与原生问题列表的键盘/焦点、自由输入和 IME 保护；保留鼠标的选择→确认。
2. 问题生产、持久状态、回答 API 与可信路由；覆盖真实异步选项入口与猫主动提问入口。
3. 共同决定合并、明确依赖等待、答案共同上下文与原任务恢复；验证无关工作仍可推进。
4. 在真实 ThreadChatSurface 中验证桌面/窄屏、刷新、暂不决定、取消、重复提交、断线恢复。独立审查后按 merge gate 交付可测试环境。

## 验证

前端：`env -u NODE_ENV pnpm --filter @cat-cafe/web exec vitest run <affected tests>`。
服务：使用 api 的 `scripts/with-test-home.sh` 包裹 `node --import tsx --test <affected tests>`，隔离测试存储。
格式化：`pnpm biome format --write <changed files>`；验证：`pnpm biome check <changed files>`。
浏览器：既有 `packages/web/test/browser/` runner 的真实聊天宿主旅程；所有未合入验证只在本工位与隔离端口，不使用生产 3003/3004。

验收必须观察完整提问→选择→提交→消费→继续链路；必须观察共同决定未答时依赖交接不启动，回答一次后相关猫获得同一个版本。检查通过只证明对应范围；未验证项保留未完成。

## 作者验证记录（2026-10-13）

完整旅程：真实聊天组件 → 键盘/鼠标 → 实际 HTTP 回调 → 真实队列调度 → 可控模型入口已走通；真实模型端到端 **未走通**，隔离应用返回 `Not logged in · Please run /login`。不把模型替身当真实模型。

- RED→GREEN：F096 / 原生问题方向键、共同问题待答不调度、持久化后续接、停止门交接、补问不挡独立工作、旧执行失效不删除问题。
- 后端：`scripts/with-test-home.sh node --import tsx --test test/conversation-question-*.test.ts`：13/13；原生运行时与新增问题定向合跑：54/54（加入队列与 MCP 合约后再分别验证）。
- 队列既有回归：`scripts/with-test-home.sh node --test test/invocation-queue.test.js`：149/149。
- 隔离 Redis：经 `test:redis -- node --import tsx --test ...` 运行 26/26；新增测试独占临时 Redis 实际重启，验证 TTL=-1、CAS 单赢家、恢复 outbox 和答案历史。
- 前端：4 个受影响测试文件 13/13，覆盖键盘、自由回答、原生提交与 IME。浏览器真实 ChatContainer 跑过暂缓→刷新→键盘提交→原步骤开始→刷新→改为自定义答案→窄屏取消，无重复启动；截图在 `.cat-cafe/test-evidence/interactive-decisions/`（本工位生成）。
- API build、MCP build、API/Web typecheck、MCP canonical registry/bootstrap/protected-base 11 项通过；capability tips、skill references、skill surfaces 通过。
- 五轴风险：行为=队列与提问续接；数据=用户答案永久存储/CAS/重启；安全=可信 owner 回调、精确卡片绑定；契约=新增 MCP 和 conversation question 分支；不可逆=无生产数据迁移、无对生产存储写入。
- Design 对照：沿用原消息卡片和暖纸主题；焦点局部接管，输入框方向键不被劫持；没有把安排续接写成已消费。
- Architecture ownership：沿用 runtime-interaction store、消息共享上下文、dispatch Queue；不新增平行审批/调度存储。旧阻塞 MCP 保持退役。
- 根目录无媒体工件；实现工位 `/Users/yuki/Documents/AINest/cat-cafe-interactive-decisions`；隔离实际应用 web 5112 / API 3112 / Redis 6388。

扩大检查的已定位限制（保留失败，不计为通过）：

1. 默认 `test:redis` 会再进入 `pnpm test` 的 `with-test-home.sh`，把租用端口改回 6398，出现连接失败；相关脚本在本分支无修改。已中止这次无效总跑，改为同一隔离 runner 直接运行受影响测试命令，保留原日志 `/tmp/cat-cafe-question-redis-suite.log`。
2. `test:runtime-interaction` 全组 214 pass / 12 fail / 2 skipped；12 个 managed-account 失败要求 codex-cli 0.159.0，本机为 0.144.6，admission 代码未修改。新增问题/原生交互的定向 54 项全部通过。
3. macOS LaunchAgent 对 Documents 下工位入口返回 EPERM；本轮用前台受控会话启动隔离应用，不能承诺跨回合托管。没有修改系统权限或生产启动配置。
4. 隔离模型未登录：已向用户请求在隔离实例设置中完成登录；真实模型提问→回答→继续仍是交付前待验证项。

当前不声明用户验收完成，不关闭原 Task。独立审查和真实模型验证完成后再更新本节。
