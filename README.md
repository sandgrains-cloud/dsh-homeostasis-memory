# dsh-homeostasis-memory

[中文](#中文) · [English](#english)

## 中文

给 DeepSeek Harness 用的记忆插件。它把记忆分成五层，每层只有一个写入者，同一件事不会存在两个地方、互相冲突。分层的做法来自 hermes 风格记忆系统，本地存储交给 mnemon，重点优化的是热记忆：让分数决定一条记忆的去留，`MEMORY.md` 不需要人工清理。

| 层 | 文件 |
|---|---|
| AI 画像 | `$DSH_HOME/SOUL.md` |
| 用户画像 | `$DSH_HOME/memory/USER.md` |
| 热记忆 | `$DSH_HOME/memory/MEMORY.md` |
| 技能 | `$DSH_HOME/skills/<name>/SKILL.md` |
| 记忆空间 | `$DSH_HOME/memory/spaces/` |

插件结合了两套记忆系统的优点
着重优化了 热记忆空间
引入评分机制
在每个会话任务结束后由主模型发起一次会话评审，在评审中，除了总结会话增修skill创建记忆之外，还会对本次真正引用的热记忆打分：引用过的 +1，未引用的 -1；分数降到 0 分及以下的热记忆转入记忆空间，以保持热记忆的干净整洁
会话评审的主要发动时机为：你在会话任务完结的时候，主动告诉模型说 任务完成 或者 收工之类的 明确信息。这时模型会进入评分并且主动发起子agent进行会话评审。
这是为了节约token设计的，以免反复评审浪费token。
当然，我也保留了兜底机制，在设置页面开启了10轮以上的会话时会自动发起评审，以免你忘了评审。但是自动发起的评审无法准确的对记忆进行评分。
同时如果你选择使用本地模型进行评审，插件会选择使用同步评审策略。每当结束一轮对话会立即将新增的上下文发送给子agent，他会同步评审。他会自动压缩上下文不用担心主模型窗口太大，本地模型塞不下的问题。


记忆空间可以随时关掉召回。 关掉之后 `memory_recall` 和 `memory_related` 不再注入任何内容，上下文不会被旧历史污染；需要时再打开。

`soul`、`user`、`memory` 三个文件是纯文本通用格式，可以直接从其他记忆项目导入；已经在用 mnemon 的，现有记忆空间也能直接接进来。

完整文档见 [README-CN.md](README-CN.md)。

## English

A memory plugin for the DeepSeek Harness. It splits memory into five layers, with exactly one writer per layer, so a single fact never exists in two places fighting over the same ground. The layering follows hermes-style memory systems and local storage is handed to mnemon. The part that gets the attention is hot memory: a score decides what stays in `MEMORY.md`, so the file never needs manual pruning.

| Layer | File |
|---|---|
| Persona | `$DSH_HOME/SOUL.md` |
| User profile | `$DSH_HOME/memory/USER.md` |
| Hot memory | `$DSH_HOME/memory/MEMORY.md` |
| Skills | `$DSH_HOME/skills/<name>/SKILL.md` |
| Memory spaces | `$DSH_HOME/memory/spaces/` |

The plugin combines the strengths of two memory systems.
Hot memory is where the work went.
A scoring mechanism does the job.
When a session's task ends, the main model runs a session review. Besides summarising the session, amending skills and creating memories, the review also scores the hot memories this session actually used: the ones referenced gain a point, every other one loses a point. Hot memories that fall to 0 points or below move into a memory space, which keeps hot memory clean and tidy.
The review is mainly triggered deliberately: when your session's task is done, you say something explicit like "task complete" or "收工" (wrapping up), and the model enters scoring and starts a session review as a subagent.
This is designed to save tokens, so repeated reviews do not burn them.
A fallback is there too: with the setting enabled, a session past 10 turns triggers a review automatically, so you cannot forget it — but an automatic review cannot score memories accurately.
And if you review with a local model, the plugin switches to a synchronous review strategy: as soon as a turn ends, the new context goes to the subagent, which reviews it synchronously. It compresses the context itself, so there is no worry about the main model's window being too large to fit a local model.

Recall from memory spaces can be switched off at any time. With recall off, `memory_recall` and `memory_related` inject nothing, so old history cannot pollute the context. Switch it back on when you need it.

`SOUL.md`, `USER.md` and `MEMORY.md` are plain text in a common format, so they import directly from other memory projects; if you already use mnemon, its existing memory spaces plug straight in.

Full documentation in [README-EN.md](README-EN.md).
