# dsh-homeostasis-memory

[English](README-EN.md)

## 简介

给 DeepSeek Harness 用的记忆插件。它把记忆分成五层，每层只有一个写入者，同一件事不会存在两个地方、互相冲突。分层的做法来自 hermes 风格记忆系统，本地存储交给 mnemon，重点优化的是热记忆：让分数决定一条记忆的去留，`MEMORY.md` 不需要人工清理。

| 层 | 文件 | 写入者 | 到达模型的形式 | 生效时间 |
|---|---|---|---|---|
| AI 画像 | `$DSH_HOME/SOUL.md` | `soul` 工具（需要审批） | 提示词段落 `memory:soul`，序号 1 | 下一次模型请求 |
| 用户画像 | `$DSH_HOME/memory/USER.md` | `memory` 工具 / 评审 | 冻结的 `memory:snapshot`，序号 10150 | 下个会话 |
| 热记忆 | `$DSH_HOME/memory/MEMORY.md` | `memory` 工具 / 评审 | 同一个冻结快照 | 下个会话 |
| 技能 | `$DSH_HOME/skills/<name>/SKILL.md` | `skill_manage` 工具 / 评审 | Harness 技能目录 + `skill` 工具 | 下次目录刷新 |
| 记忆空间 | `$DSH_HOME/memory/spaces/` | 评审归档 / 设置页「立即归档」 | 按需 `memory_recall`、`memory_related` | 立即 |
| 历史原文 | 会话日志 | 只读 | 按需 `session_grep` | 立即 |

热记忆放结论，记忆空间放已经冷下来的结论，skill 放流程，历史原文用 `session_grep` 按需取回。一条事实只属于其中一层。

**热记忆靠分数保持干净。** 新条目从 5 分起。每个会话任务结束时，主模型发起一次评审，在评审里对本次真正引用的热记忆打分：引用过的 +1，未引用的 -1；分数降到 0 分及以下的条目，先归档进记忆空间，确认写入成功后才从 `MEMORY.md` 移出。归档整体失败时不写 `MEMORY.md`，所有条目原样留在原处、分数不变，一条都不会丢。

**记忆空间可以随时关掉召回。** 关掉之后 `memory_recall` 和 `memory_related` 不再注入任何内容，上下文不会被旧历史污染；需要时再打开。

`soul`、`user`、`memory` 三个文件是纯文本通用格式，可以直接从其他记忆项目导入；已经在用 mnemon 的，现有记忆空间也能直接接进来。长期记忆用插件自带的 `mnemon` 二进制，装完插件就能用，不需要另外装后端。

## 热记忆分数

`MEMORY.md` 的每条记忆都带分数。文件里以 `[N] ` 前缀保存，但模型快照、工具参数和设置页都会剥离这个前缀，分数永远不会混进记忆正文。

- 任何写入方新增的条目都从 **5 分**开始。
- `MEMORY.md` **没有字符上限**，生命周期完全由分数管理。
- 标准收尾评审会重新打分：主模型列出本次实际使用过的条目，这些 +1，其余全部 -1；分数 **≤ 0** 的条目**先归档进长期记忆空间，归档确认成功之后才从 `MEMORY.md` 移除**。
- 归档失败（后端不可用、回执对不上、超时）时**不写 `MEMORY.md`**，条目原样保留，回执里带 `error` 与 `retained`。
- 归档拒绝的条目（为空，或超过 `longTerm.entryMaxChars`，默认 8000 字符）不归档也不删除，分数保持本次评出的值（仍然 ≤ 0）留在原处，下次归档继续重试，日志记为 `too-long`。
- `USER.md` 没有分数，保留自己的字符预算。闲置被动评审和同步评审都不打分。
- 编辑正文（设置页、评审、`memory` 工具）都不会改动分数。

`USER.md` 保持纯 `§` 分隔格式。旧版本写入的 `MEMORY.md` 条目没有分数前缀，读取时按 5 分处理，不需要迁移脚本。

## 长期记忆

冷记忆归档进「记忆空间」：一个具名、可独立启停的长期证据库。设计照搬 dsh-mnemon（记忆空间、`strict-v1` 召回分级、先归档后删除的提交顺序），但**不依赖、也不读写 dsh-mnemon 的任何数据**。

- 记忆后端是插件自带的 `vendor/mnemon/mnemon.exe`（Mnemon 0.2.8，Apache-2.0），装插件即可用，不需要另外安装任何东西。
- 数据根固定为 `$DSH_HOME/memory/spaces`；指向 dsh-mnemon 的 `~/.mnemon` 会被拒绝并回退默认值。
- 召回分档：分数 `< 0.25` 丢弃，`< 0.6` 记为中等（最多 4 条），其余为高相关（全部保留），无分数最多 2 条，单次上限 6 条。
- 每轮预算：一次初始召回 + 一次改述召回 + 一次图遍历；重复查询直接重放已采纳证据，不再打后端。

| 分支 | 命令 | 说明 |
|---|---|---|
| 归档 | 临时 draft JSON → `mnemon import --no-diff` | 逐条核对回执（`action`、`id`、`content`）后才动 `MEMORY.md` |
| 召回 | `mnemon --readonly recall <q> --limit n` | 每轮最多两次查询 |
| 图遍历 | `mnemon --readonly related <id> --depth n [--edge t]` | id 必须来自本轮召回；每轮最多一次 |
| 浏览 | `mnemon --readonly recall "" --basic` | 页面的空间内容列表 |
| 检索 | `mnemon --readonly search <q>` | 页面上的关键词检索 |

## 工具

| 工具 | 动作 | 说明 |
|---|---|---|
| `memory` | `add` / `patch` / `remove` / 原子 `operations` | 两个库；`§` 分隔；`MEMORY.md` 新条目默认 5 分；只有 `USER.md` 有字符预算 |
| `soul` | `read` / `append` / `patch` / `remove` | 每次写入都需要审批和 `expected_revision` |
| `skill_manage` | `read` / `create` / `patch` / `write_file` / `remove_file` | 不删除技能、扁平目录、强制先读后写 |
| `session_grep` | 原文检索 | 只查相同 `cwd`，排除当前会话，新会话优先 |
| `review_memory` | `used_memory` 列表 | 仅标准策略：先给 `MEMORY.md` 打分并归档，再请求本轮结束后的收尾评审 |
| `memory_recall` | `query` / `limit` / `spaceIds` | 召回长期记忆；召回关闭时不存在 |
| `memory_related` | `id` / `spaceId` / `depth` / `edge` | 图遍历；id 必须来自本轮召回，每轮一次；召回关闭时不存在 |

每种失败都返回可执行的错误码：`invalid`、`too-large`、`scan-blocked`、`approval-denied`、`revision-conflict`、`not-found`、`ambiguous`、`over-budget`、`read-before-write`、`unavailable-in-review`、`io-error`、`cli-missing`、`cli-timeout`、`cli-failed`、`invalid-json`、`output-too-large`、`space-missing`、`space-create-failed`、`registry-invalid`、`archive-rejected`、`not-admitted`、`budget-exhausted`、`too-long`、`data-dir-conflict`。

## 设置页

插件在 **设置 → 记忆** 下提供一页，共七个选项卡：

| 选项卡 | 显示 | 可修改 |
|---|---|---|
| 状态 | AI 画像字节数与修订号、两个库的条目数、`MEMORY.md` 平均分、技能数、最近评审 | — |
| AI 画像 | 完整 `SOUL.md` 和实时字节计数 | 编辑全文，二次确认后写入 |
| 记忆 | `USER.md` 带用量条；`MEMORY.md` 按分数排序的条目列表，每行有可编辑分数 | 增、改、删单条；直接修改 `MEMORY.md` 分数 |
| 技能 | 名称、描述、字符数、附件数、修改时间 | —（创建仍走 `skill_manage`） |
| 评审 | 策略、模型、两个开关、被动规则、输出上限、日志路径、最近 3 条记录 | 模型、总开关、被动开关 |
| 长期记忆 | 后端路径与版本、数据目录、目标空间、空间卡片的条目数与分类分布、空间内容与图邻居、归档日志 | 召回开关、空间启停、新建空间、立即归档 |
| 审批 | 存活会话的审批策略 | 对存活会话设置 `ask` / `never` |

召回开关关闭后，`memory_recall` / `memory_related` 两个工具、每轮提醒和协议段落里的召回指引同时消失，模型看不到长期记忆的存在；归档不受影响。

`MEMORY.md` 条目按分数从高到低显示，同分保持文件原顺序。这个排序只影响显示：文件和模型快照都不会重排；保存分数后列表按新分数重新定位，但不会改动任何条目正文。分数输入框位于 **编辑** 和 **删除** 之间，失焦或回车即保存。

评审行为是设置页唯一能改的部分。`cordis.patch.yml` 里的行配置只是默认值；页面保存后以 `$DSH_HOME/memory/review-settings.json` 为准，不需要改 YAML 或重载 profile，改动对下一次评审生效。删掉这个文件就回到 YAML 的值。

评审有两种策略，由评审模型隐式选择：

- **标准策略**：评审模型跟随主模型。插件把完整对话 fork 成一次性子会话，让它继承主模型当时的上下文。两个触发条件：
  - `review_memory` 工具：用户结束会话（或要求总结/评审）时调用。调用时先按 `used_memory` 给 `MEMORY.md` 打分、删除 ≤0 分的条目，再把评审推迟到本轮结束，确保它看到收尾消息；
  - 被动规则：距上次评审至少 `review.intervalTurns` 个用户轮，且闲置至少 `review.idleMinutes` 分钟。这条路径不打分。页面上的被动开关只控制这条规则。

  新的用户消息会中止正在运行的评审：用户的任务永远优先。
- **同步策略**：固定使用另一个模型。每个主会话有一个常驻评审代理，主会话每完成一轮就把这一轮内容交给它（去掉主模型的 reasoning，不截断内容）。它自己维护历史并自行压缩，单次请求不需要携带整个会话。它不打分。没有收尾评审，也没有闲置触发；页面开关控制这套策略是否启用。

页面有两个开关：总开关 `启用评审` 关闭所有评审；`启用被动评审` 只在评审模型跟随主模型时出现，只控制闲置规则。日志区显示最近三条记录，收尾评审的记录包含打分摘要。日志文件本身只保留最近 `review.logMaxEntries` 条记录（默认 5 条）；旧版本留下的大日志会在插件激活时自动裁剪。

模型选择器提供 `同主模型`（标准策略）或一个固定的 `llm` 路由（同步评审）。固定的路由如果正好等于会话当前路由，仍按标准策略处理。

记忆按条目编辑，而不是整篇编辑，因为 `§` 是结构单位：Host 按条目寻址，agent 的 `memory` 工具用唯一条目片段 patch/remove，分数与正文分开保存。整篇文本框可能悄悄删掉一个分隔符，把两条事实并成一条，所以条目列表从不自己重建分隔符——每次写入都由 Host 从条目数组重新拼接。

AI 画像没有这种结构，所以仍按整篇编辑。

页面数据来自 Host 端点 `GET /dsh-homeostasis-memory/api/state`；写入发到 `/dsh-homeostasis-memory/api/persona` 和 `/memory/{add,replace,remove,score}`。这些 handler 调用与工具相同的模块，所以扫描、`USER.md` 预算、锁和原子写入的行为完全一致。唯一有意的差异：页面写入跳过 `ctx.approval`，因为点击和页面上的二次确认本身就是人工审批，而审批请求无法在回合之外发起。

被手工改成没有分隔符、单条超过整库上限的 `USER.md` 会阻塞所有写入（包括本页面），直到手工修好；页面会显示原因和备份路径。`MEMORY.md` 没有预算，所以没有这类漂移拦截。

页面语言按以下顺序决定：页头的 中文 / EN 开关（记在 `localStorage`）、`ui.locale`、应用语言、`document.lang`、浏览器语言。

路由通过 `ctx.inject(['webServer'], …)` 注册，而不是直接读上下文：插件行可能先于挂载 `webServer` 的行激活，直接读会让页面冷启动后永久 404。提示词段落和工具的注册也出于同样原因等待服务就绪。

安装或修改包之后，刷新一次页面，让浏览器加载新的客户端模块。如果页面仍不出现，重启桌面应用——被替换的包需要新的模块代际。

## 数据布局

```
$DSH_HOME/
├─ SOUL.md                  AI 画像（首次运行从 assets/default-SOUL.md 播种）
├─ memory/
│  ├─ USER.md               用户是谁；§ 分隔纯文本，1375 字符预算
│  ├─ MEMORY.md             § 分隔条目，每条为 `[分数] 正文`，无字符上限
│  ├─ review-log.jsonl      每次评审或投递一行；只保留最近 5 条
│  ├─ review-state.json     同步评审：会话、最后投递 seq、路由
│  ├─ long-term-settings.json   设置页保存的长期记忆设置
│  ├─ cold-archive-log.jsonl    归档日志；只保留最近 3 条
│  └─ spaces/                   记忆空间根（mnemon 的 --data-dir）
│     └─ data/
│        ├─ .dsh-homeostasis-memory-bodies.json   空间注册表
│        └─ cold-archive/mnemon.db    冷记忆归档空间
└─ skills/
   └─ <name>/SKILL.md       + references/ templates/ scripts/ assets/
```

所有写入都是临时文件 + rename，并带进程内按文件锁。被手工改成单条超过整库上限的 `USER.md` 会先备份到 `<file>.bak.<timestamp>`，然后拒绝覆盖。

## 配置

包内的 `cordis.patch.yml` 携带默认值。要改配置，在 profile 自己的 `cordis.patch.yml` 里加覆盖——注意 patch 会 **整体替换** `config` 对象，需要保留的字段必须一并写出：

```yaml
- id: memory
  config:
    review:
      enabled: false
    hotMemory:
      userLimitChars: 2000
      writeApproval: false
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `persona.path` | `$DSH_HOME/SOUL.md` | AI 画像文件 |
| `persona.maxBytes` | 4096 | 字节硬上限，不截断 |
| `persona.requireApproval` | true | 每次画像写入都要审批 |
| `persona.seedScaffold` | true | 文件不存在时写入脚手架 |
| `hotMemory.userLimitChars` | 1375 | `USER.md` 上限（Unicode 码点） |
| `hotMemory.writeApproval` | false | 前台写入是否走内联审批 |
| `skills.root` | `$DSH_HOME/skills` | 技能根目录 |
| `skills.descriptionMaxChars` | 200 | 描述上限 |
| `skills.bodyMaxChars` | 10000 | 单文件上限 |
| `skills.dedupeThreshold` | 0.5 | 描述相似度警告阈值 |
| `sessionGrep.maxSessions` | 40 | 扫描的最近会话数 |
| `sessionGrep.maxHits` | 10 | 返回匹配数 |
| `sessionGrep.snippetChars` | 400 | 摘要长度 |
| `sessionGrep.timeoutMs` | 3000 | 扫描时间预算 |
| `review.enabled` | true | 所有评审的总开关 |
| `review.passive` | true | 被动闲置规则（仅标准策略） |
| `review.intervalTurns` | 10 | 被动规则：距上次评审的用户轮数 |
| `review.idleMinutes` | 5 | 被动规则：闲置多少分钟后运行 |
| `review.maxPerSession` | 50 | 标准策略单会话上限 |
| `review.maxInputChars` | 60000 | 标准策略输入警告阈值 |
| `review.maxTokens` | 8192 | 评审输出预算 |
| `review.logPath` | `$DSH_HOME/memory/review-log.jsonl` | 评审日志 |
| `review.logMaxEntries` | 5 | 评审日志保留的最近记录数 |
| `review.statePath` | `$DSH_HOME/memory/review-state.json` | 同步评审记录 |
| `review.model.mode` | inherit | `inherit` = 标准策略；`fixed` = 同步评审 |
| `review.model.provider` / `.model` | — | `fixed` 时使用 |
| `protocol.enabled` | true | 注册 `memory:protocol` |
| `longTerm.enabled` | true | 长期记忆总开关；false = 回到 0 分直接丢弃 |
| `longTerm.recall` | true | 召回开关（页面可改）；false = 两个工具与提示同时消失 |
| `longTerm.targetSpace` | `cold-archive` | 冷记忆归档目标空间 |
| `longTerm.createTargetSpace` | true | 目标空间不存在时自动创建 |
| `longTerm.cliPath` | 空 | 空 = 先用自带的 `vendor/mnemon`，再按 PATH 查找 |
| `longTerm.dataDir` | 空 | 空 = `$DSH_HOME/memory/spaces`；指向 `~/.mnemon` 会被拒绝 |
| `longTerm.timeoutMs` | 15000 | 单次后端调用超时 |
| `longTerm.entryMaxChars` | 8000 | 可归档条目的字符上限 |
| `longTerm.logMaxEntries` | 3 | 归档日志保留条数（页面与文件同步） |
| `longTerm.recallQuality.limit` | 6 | 单次召回上限 |
| `longTerm.recallQuality.lowScoreThreshold` | 0.25 | 低于此分数丢弃 |
| `longTerm.recallQuality.highScoreThreshold` | 0.6 | 达到此分数为高相关 |
| `longTerm.recallQuality.candidateMultiplier` | 3 | 候选扩量倍数（上限 50） |
| `longTerm.recallQuality.maxMediumResults` | 4 | 中等相关最多保留条数 |
| `longTerm.recallQuality.maxUnknownResults` | 2 | 无分数最多保留条数 |
| `ui.locale` | `auto` | 页面语言：`auto`、`zh`、`en` |

配置改动在 profile 重载后生效，没有热重载。未知字段会被忽略：插件在代码里归一化配置，没有声明 schema，写错字段不会报错。例外是长期记忆的召回开关与目标空间：设置页保存后写进 `long-term-settings.json`，即时生效。

## 已知限制

以下都是有意为之或实测结果，不是疏漏。

- **单进程。** 按文件锁只在进程内有效；两个 DSH 进程共享同一个 `$DSH_HOME` 不受支持（PRD FR-8）。
- **Shell 写入绕过守卫。** `write` 和 `edit` 对 `SOUL.md`、`USER.md`、`MEMORY.md` 会被拒绝，但 shell 重定向无法拦截。
- **技能没有守卫。** 只有 AI 画像和热记忆有 `write`/`edit` 守卫（PRD FR-1.4）。
- **长期记忆依赖自带后端。** `vendor/mnemon/mnemon.exe` 是 win32-x64 二进制；其他平台需要在 `longTerm.cliPath` 指定对应平台的 Mnemon。后端缺失时归档失败、条目保留在 `MEMORY.md`，其余功能不受影响。
- **长期记忆与 dsh-mnemon 完全隔离。** 两者数据根不同，互不读取、互不写入；`longTerm.dataDir` 指向 dsh-mnemon 的根会被拒绝。
- **评审子会话继承父代理的工具集。** Harness 的 subagent 启动没有 `toolFilter`，所以两种策略都通过作用域内的 `tools.restrict` 加逐工具调用检查来收窄评审会话。限制以 `memory-review-` 会话 id 前缀为键，插件重载后仍然有效。
- **评审子会话没有长期记忆工具。** `memory_recall` / `memory_related` 对评审会话直接拒绝，评审只维护 `MEMORY.md` 与技能。
- **会话按创建时间排序。** `SessionHeader` 没有 updated-at 字段。
- **委派会话被跳过。** `session_grep` 不扫 fork 子会话，避免父会话历史在结果里重复。
- **评审不记录 token 用量。** subagent 结果没有 usage 对象，相关字段留空而不是编造。
- **新的用户消息会取消标准评审。** 这是有意的：评审是维护工作，绝不能耽误用户的任务。
- **同步评审不发送 reasoning。** 交给评审的主模型思考内容会被丢弃，只投递用户文本、助手文本、工具调用和工具结果。
- **同步评审从启用它的那一轮开始。** 从固定模型切回 `inherit` 再切回去会新建评审代理，旧的被销毁。

## 许可证

MIT，见 [LICENSE](LICENSE)。

内置的 `vendor/mnemon/mnemon.exe` 为 Apache-2.0，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
