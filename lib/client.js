/**
 * dsh-homeostasis-memory — Client half: the Memory settings page.
 *
 * Registers one page into `settings.section` and renders it from the Host
 * endpoint this plugin owns. No build step: DSH loads this file through its
 * `dsh.client` declaration. React comes from the browser module table.
 *
 * Every string that reaches the user goes through the small dictionary below,
 * selected by the Client locale service, so the page follows the app language.
 */

window.__ModuleLoader__.load({
  id: 'dsh-homeostasis-memory',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const API = '/dsh-homeostasis-memory/api'
    const SLOT = 'settings.section'
    const PAGE_ID = 'dsh-homeostasis-memory'

    const TEXT = {
      zh: {
        title: '记忆系统',
        subtitle: 'AI 画像、记忆文件、技能与评审',
        refresh: '刷新',
        retry: '重试',
        loading: '读取中…',
        unavailable: '无法读取记忆数据',
        common: {
          edit: '编辑',
          save: '保存',
          cancel: '取消',
          confirm: '确认后写入磁盘，下一次模型请求生效。',
          confirmWrite: '确认写入',
        },
        tabs: { status: '状态', persona: 'AI 画像', hot: '记忆', skills: '技能', review: '评审', longTerm: '记忆空间', approval: '审批' },
        status: {
          persona: 'AI 画像',
          user: '用户画像',
          memory: '热记忆',
          skills: '技能',
          review: '最近评审',
          bytes: '字节',
          revision: '修订',
          entries: '条',
          none: '还没有条目',
          noReview: '还没有评审记录',
          skillsUnit: '个技能',
          next: '下个会话或压缩后可见',
          avgScore: '平均分',
        },
        persona: {
          edit: '编辑',
          save: '保存',
          confirm: '确认写入',
          cancel: '取消',
          saved: '已保存，下一次模型请求生效',
          hint: '纯文本。上限 {max} 字节，超出会被拒绝而不是截断。',
          chars: '{bytes} / {max} 字节',
        },
        hot: {
          add: '添加条目',
          placeholder: '一条事实，短一点',
          save: '保存',
          cancel: '取消',
          edit: '编辑',
          remove: '删除',
          confirmRemove: '确认删除',
          added: '已添加，下个会话或压缩后可见',
          updated: '已更新，下个会话或压缩后可见',
          removed: '已删除，下个会话或压缩后可见',
          usage: '{used} / {limit} 字符',
          score: '分数',
          scoreSaved: '分数已保存，下个会话或压缩后生效',
          memoryNote: 'MEMORY.md 没有字符上限；分数由评审维护，编辑正文不会改动分数。',
          drift: '这个文件看起来被手工改过（单条超过整库上限），写入已被拒绝并生成了备份。需要手工把它改回 § 分隔的条目。',
          unreadable: '文件存在但读不出，写入已禁用。',
        },
        skills: {
          name: '名称',
          description: '描述',
          size: '字符',
          files: '附件',
          modified: '修改时间',
          none: '还没有技能。让 agent 用 skill_manage 创建，或等评审自动沉淀。',
        },
        review: {
          toggle: '启用评审',
          enabledHint: '评审按下面的策略运行',
          disabledAll: '已关闭，不会触发任何评审',
          passiveToggle: '启用被动评审',
          passiveHint: '距上次评审满 {n} 个用户轮、且闲置 {m} 分钟后自动评审一次',
          passiveOff: '已关闭：只在会话收尾或用户要求时评审',
          strategy: '当前策略',
          strategyStandard: '标准策略',
          strategyStandardHint: '评审模型跟随主模型：fork 完整上下文。会话收尾、用户要求总结或评审时主动触发；也可以按闲置规则被动触发。',
          strategySync: '同步评审',
          strategySyncHint: '评审模型不是主模型：每轮结束后把这一轮内容交给评审模型，它自己维护上下文。没有收尾评审，也没有闲置触发。',
          masterOn: '同步评审已开启，每轮结束都会评审一次',
          masterOff: '已关闭，不会进行同步评审',
          model: '评审模型',
          modelInherit: '同主模型',
          modelInheritHint: '使用当前会话的模型，前缀缓存可以复用。',
          modelFixed: '指定模型',
          modelFixedHint: '固定用另一个模型评审。它会逐轮增量评审，避免每次重算完整上下文。',
          loadingModels: '读取模型列表…',
          noModels: '拿不到模型列表（llm 服务未就绪）。',
          chooseModel: '— 请选择 —',
          saved: '已保存，下一次评审生效',
          interval: '被动间隔',
          turns: '每 {n} 个用户轮',
          idle: '闲置',
          minutes: '{n} 分钟',
          maxPerSession: '单会话上限',
          maxTokens: '输出上限',
          log: '评审日志',
          keep: '日志保留',
          settingsFile: '设置文件',
          none: '还没有评审记录',
          result: '结果',
          actions: '动作',
          duration: '耗时',
          triggerClosing: '收尾',
          triggerIdle: '闲置',
          triggerTurn: '逐轮',
        },
        approval: {
          intro: '审批策略（ask / never）和沙箱模式是捆绑在「权限预设」里的。下面只改审批这一项、不动沙箱，所以会话会被标成「自定义」；新会话仍按权限预设启动。',
          toggleHint: 'ask = 需要审批时弹窗询问；never = 需要审批的动作直接拒绝。',
          current: '当前存活会话',
          policy: '审批策略',
          unset: '未显式设置（跟随预设）',
          setAsk: '设为 ask（询问）',
          setNever: '设为 never（直接拒绝）',
          applied: '已应用到的会话数',
          empty: '当前没有存活会话。',
          unavailable: '审批或 agents 服务不可用。',
          presetHint: '要连沙箱一起恢复默认，用输入框的权限控件或 /permission workspace-write。',
        },
        longTerm: {
          title: '长期记忆',
          disabled: '长期记忆已关闭（`longTerm.enabled: false`）。评审会按旧方式直接在 0 分丢弃条目，不会归档。',
          cli: '记忆后端',
          cliMissing: '未找到可用的记忆后端，长期记忆不可用；冷记忆会保留在 MEMORY.md 中不被删除。',
          cliBundled: '插件自带',
          cliVersion: '版本 {version}',
          dataDir: '数据目录',
          targetSpace: '归档目标空间',
          spaces: '记忆空间',
          spacesUnit: '{n} 个空间，{active} 个已启用',
          archivedTotal: '已归档',
          archivedUnit: '{n} 条',
          lastArchive: '最近一次归档',
          noArchive: '还没有归档记录',
          recall: '召回策略',
          recallOn: '开启召回',
          recallOff: '关闭召回',
          recallHint: '关闭后 memory_recall / memory_related 两个工具与相关提示同时消失，模型不再主动检索长期记忆。归档不受影响。',
          recallOnNote: '已开启：模型可以检索长期记忆',
          recallOffNote: '已关闭：模型看不到长期记忆',
          quality: '召回分级',
          qualityHint: '分数 < {low} 丢弃，< {high} 记为中等（最多 {medium} 条），其余为高相关（全部保留），无分数最多 {unknown} 条；单次上限 {limit} 条。',
          spaceName: '名称',
          spaceDesc: '用途说明',
          spaceActive: '启用',
          spaceInactive: '已停用',
          spaceEntries: '{n} 条',
          spaceHealthy: '健康',
          spaceBroken: '异常',
          spaceNoStats: '没有统计',
          spaceRelated: '支持图遍历',
          spaceNoRelated: '不支持图遍历',
          spaceDelete: '删除',
          spaceDeleteHint: '删除这个空间和它保存的全部记忆',
          spaceDeleteConfirm: '确认删除空间「{name}」（{id}）？其中的 {n} 条记忆会一并删除，无法恢复。',
          spaceDeleted: '已删除空间 {id}',
          browse: '内容',
          browseHint: '留空则列出全部条目；输入关键词按词匹配。',
          search: '检索',
          searching: '检索中…',
          noEntries: '这个空间还没有条目',
          selectSpace: '选择上面的空间查看内容',
          related: '相关',
          relatedTitle: '相关记忆',
          noRelated: '没有相关记忆',
          loadingRelated: '读取中…',
          log: '归档日志',
          logTime: '时间',
          logTrigger: '触发',
          logResult: '结果',
          logCount: '条数',
          logTarget: '目标空间',
          logSummary: '摘要',
          logEmpty: '还没有归档记录',
          triggerReview: '评审',
          triggerManual: '手动',
          ok: '成功',
          failed: '失败',
          archiveNow: '立即归档',
          archiveNowHint: '把当前 MEMORY.md 中分数 ≤0 的 {n} 条记忆归档并从 MEMORY.md 移除。',
          archiveNowEmpty: '当前没有分数 ≤0 的条目',
          archiveNowConfirm: '确认归档这 {n} 条记忆？归档成功后会从 MEMORY.md 移除，失败则原样保留。',
          archiving: '归档中…',
          archived: '已归档 {n} 条到 {space}',
          retainedNote: '另有 {n} 条未归档，已保留在 MEMORY.md（超长或为空）',
          retry: '重试',
          refresh: '刷新',
          newSpace: '新建空间',
          newSpaceName: '空间名称',
          newSpaceDesc: '用途说明（写给模型看，说明什么时候该来这里找）',
          create: '创建',
          creating: '创建中…',
          created: '已创建空间 {id}',
          toggleFailed: '切换失败',
        },
      },
      en: {
        title: 'Memory system',
        subtitle: 'AI persona, memory files, skills, and review',
        refresh: 'Refresh',
        retry: 'Retry',
        loading: 'Loading…',
        unavailable: 'Memory data is unavailable',
        common: {
          edit: 'Edit',
          save: 'Save',
          cancel: 'Cancel',
          confirm: 'Write to disk; takes effect on the next model request.',
          confirmWrite: 'Confirm write',
        },
        tabs: { status: 'Status', persona: 'AI persona', hot: 'Memory', skills: 'Skills', review: 'Review', longTerm: 'Memory spaces', approval: 'Approval' },
        status: {
          persona: 'AI persona',
          user: 'User profile',
          memory: 'Hot memory',
          skills: 'Skills',
          review: 'Last review',
          bytes: 'bytes',
          revision: 'revision',
          entries: 'entries',
          none: 'No entries yet',
          noReview: 'No review yet',
          skillsUnit: 'skills',
          next: 'visible next session or after a compaction',
          avgScore: 'Average score',
        },
        persona: {
          edit: 'Edit',
          save: 'Save',
          confirm: 'Confirm write',
          cancel: 'Cancel',
          saved: 'Saved — takes effect on the next model request',
          hint: 'Plain text. The {max}-byte ceiling refuses oversized saves instead of truncating.',
          chars: '{bytes} / {max} bytes',
        },
        hot: {
          add: 'Add entry',
          placeholder: 'One short fact',
          save: 'Save',
          cancel: 'Cancel',
          edit: 'Edit',
          remove: 'Delete',
          confirmRemove: 'Confirm delete',
          added: 'Added — visible next session or after a compaction',
          updated: 'Updated — visible next session or after a compaction',
          removed: 'Removed — visible next session or after a compaction',
          usage: '{used} / {limit} chars',
          score: 'Score',
          scoreSaved: 'Score saved — visible next session or after a compaction',
          memoryNote: 'MEMORY.md has no character limit; the review maintains its scores, and editing content never changes a score.',
          drift: 'This file looks hand-edited (one entry exceeds the whole budget); writes are refused and a backup was written. Restore the "§"-separated entries by hand.',
          unreadable: 'The file exists but cannot be read, so writes are disabled.',
        },
        skills: {
          name: 'Name',
          description: 'Description',
          size: 'Chars',
          files: 'Files',
          modified: 'Modified',
          none: 'No skills yet. Let the agent create one with skill_manage, or wait for a review pass.',
        },
        review: {
          toggle: 'Enable the memory review',
          enabledHint: 'Reviews follow the strategy below',
          disabledAll: 'Off — no review runs at all',
          passiveToggle: 'Enable the passive review',
          passiveHint: 'Runs once after {n} user turns without a review and {m} idle minutes',
          passiveOff: 'Off — only an explicit closing or review request runs one',
          strategy: 'Strategy',
          strategyStandard: 'Standard',
          strategyStandardHint: 'The review model follows the main model and forks the whole conversation. It runs when the session closes, when the user asks for a summary or review, and on the passive rule.',
          strategySync: 'Synchronous',
          strategySyncHint: 'The review model is a different model: every completed turn is handed to a persistent review agent that maintains its own context. No closing review and no idle trigger.',
          masterOn: 'Synchronous review is on: every completed turn is reviewed',
          masterOff: 'Off — no synchronous review runs',
          model: 'Review model',
          modelInherit: 'Same as the main model',
          modelInheritHint: 'Uses the session model, so the prefix cache is reused.',
          modelFixed: 'Pinned model',
          modelFixedHint: 'A different model reviews each turn incrementally instead of re-reading the whole context.',
          loadingModels: 'Loading models…',
          noModels: 'No model catalog available (the llm service is not ready).',
          chooseModel: '— choose —',
          saved: 'Saved — applies to the next review',
          interval: 'Passive rule',
          turns: 'every {n} user turns',
          idle: 'idle',
          minutes: '{n} min',
          maxPerSession: 'Per session',
          maxTokens: 'Output budget',
          log: 'Review log',
          keep: 'Log kept',
          settingsFile: 'Settings file',
          none: 'No review recorded yet',
          result: 'Result',
          actions: 'Actions',
          duration: 'Took',
          triggerClosing: 'closing',
          triggerIdle: 'idle',
          triggerTurn: 'turn',
        },
        approval: {
          intro: 'The approval policy (ask / never) is bundled with the sandbox mode inside a permission preset. These buttons change only the approval knob, never the sandbox, so a session becomes "custom"; new sessions still start on the preset.',
          toggleHint: 'ask = prompt before an action that needs approval; never = reject such actions outright.',
          current: 'Live sessions',
          policy: 'Policy',
          unset: 'not set (follows the preset)',
          setAsk: 'Set ask',
          setNever: 'Set never',
          applied: 'Sessions updated',
          empty: 'No live sessions.',
          unavailable: 'The approval or agents service is unavailable.',
          presetHint: 'To restore sandbox and approval together, use the composer permission control or /permission workspace-write.',
        },
        longTerm: {
          title: 'Long-term memory',
          disabled: 'Long-term memory is off (`longTerm.enabled: false`). Reviews drop zero-score entries the old way instead of archiving them.',
          cli: 'Memory backend',
          cliMissing: 'No usable memory backend was found, so long-term memory is unavailable; dead entries stay in MEMORY.md instead of being deleted.',
          cliBundled: 'bundled',
          cliVersion: 'version {version}',
          dataDir: 'Data directory',
          targetSpace: 'Archive target',
          spaces: 'Memory spaces',
          spacesUnit: '{n} spaces, {active} enabled',
          archivedTotal: 'Archived',
          archivedUnit: '{n} entries',
          lastArchive: 'Last archive',
          noArchive: 'No archive recorded yet',
          recall: 'Recall policy',
          recallOn: 'Recall on',
          recallOff: 'Recall off',
          recallHint: 'Switching recall off withdraws memory_recall / memory_related and their prompt lines together; the model no longer searches long-term memory. Archiving is unaffected.',
          recallOnNote: 'On — the model may search long-term memory',
          recallOffNote: 'Off — the model cannot see long-term memory',
          quality: 'Recall grading',
          qualityHint: 'Below {low} is dropped, below {high} counts as medium (at most {medium}), the rest is high (all kept), unscored at most {unknown}; one query admits at most {limit}.',
          spaceName: 'Name',
          spaceDesc: 'Purpose',
          spaceActive: 'Enabled',
          spaceInactive: 'Disabled',
          spaceEntries: '{n} entries',
          spaceHealthy: 'Healthy',
          spaceBroken: 'Unavailable',
          spaceNoStats: 'No statistics',
          spaceRelated: 'graph traversal',
          spaceNoRelated: 'no traversal',
          spaceDelete: 'Delete',
          spaceDeleteHint: 'Delete this space and every memory it holds',
          spaceDeleteConfirm: 'Delete the space "{name}" ({id})? Its {n} memories are deleted with it, and this cannot be undone.',
          spaceDeleted: 'Deleted space {id}',
          browse: 'Contents',
          browseHint: 'Leave blank to list every entry; a keyword filters by token match.',
          search: 'Search',
          searching: 'Searching…',
          noEntries: 'This space has no entries yet',
          selectSpace: 'Pick a space above to read it',
          related: 'Related',
          relatedTitle: 'Related memories',
          noRelated: 'No related memories',
          loadingRelated: 'Loading…',
          log: 'Archive log',
          logTime: 'Time',
          logTrigger: 'Trigger',
          logResult: 'Result',
          logCount: 'Entries',
          logTarget: 'Target',
          logSummary: 'Summary',
          logEmpty: 'No archive recorded yet',
          triggerReview: 'review',
          triggerManual: 'manual',
          ok: 'ok',
          failed: 'failed',
          archiveNow: 'Archive now',
          archiveNowHint: 'Archive the {n} MEMORY.md entries scored at or below zero, then remove them from MEMORY.md.',
          archiveNowEmpty: 'No entry is at or below zero',
          archiveNowConfirm: 'Archive these {n} entries? They leave MEMORY.md once the archive confirms them, and stay in place if it fails.',
          archiving: 'Archiving…',
          archived: 'Archived {n} entries into {space}',
          retainedNote: '{n} more stayed in MEMORY.md (too long or empty)',
          retry: 'Retry',
          refresh: 'Refresh',
          newSpace: 'New space',
          newSpaceName: 'Space name',
          newSpaceDesc: 'Purpose, written for the model: when should it look here?',
          create: 'Create',
          creating: 'Creating…',
          created: 'Created space {id}',
          toggleFailed: 'Could not switch the space',
        },
      },
    }

    /** Inline styles, built from the host theme tokens only. */
    const S = {
      root: { display: 'flex', flexDirection: 'column', gap: '16px', color: 'var(--dsw-alias-label-primary)' },
      header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' },
      title: { margin: 0, fontSize: '15px', fontWeight: 600, lineHeight: 1.4 },
      subtitle: { margin: '2px 0 0', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
      tabs: { display: 'flex', gap: '2px', borderBottom: '1px solid var(--dsw-alias-border-l1)', flexWrap: 'wrap' },
      tab: {
        appearance: 'none',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '13px',
        padding: '8px 10px',
        cursor: 'pointer',
        borderBottom: '2px solid transparent',
        marginBottom: '-1px',
        borderRadius: '6px 6px 0 0',
      },
      tabActive: {
        color: 'var(--dsw-alias-label-primary)',
        borderBottom: '2px solid var(--dsw-alias-state-business-primary)',
        fontWeight: 600,
      },
      button: {
        appearance: 'none',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '12px',
        padding: '4px 10px',
        borderRadius: '6px',
        cursor: 'pointer',
        lineHeight: 1.6,
      },
      buttonPrimary: {
        border: '1px solid var(--dsw-alias-state-business-primary)',
        color: 'var(--dsw-alias-state-business-primary)',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      buttonDanger: { border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' },
      buttonDisabled: { opacity: 0.5, cursor: 'not-allowed' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' },
      card: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '10px',
        background: 'var(--dsw-alias-bg-layer-2)',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        minWidth: 0,
      },
      cardHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' },
      cardTitle: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' },
      metric: { fontSize: '18px', fontWeight: 600, letterSpacing: '-0.01em' },
      hint: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', wordBreak: 'break-all' },
      barTrack: {
        height: '6px',
        borderRadius: '999px',
        background: 'var(--dsw-alias-interactive-bg-hover)',
        overflow: 'hidden',
      },
      barFill: { height: '100%', borderRadius: '999px', background: 'var(--dsw-alias-state-business-primary)' },
      barFillWarn: { height: '100%', borderRadius: '999px', background: 'var(--dsw-alias-state-error-primary)' },
      two: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px', alignItems: 'start' },
      list: { display: 'flex', flexDirection: 'column', gap: '6px', margin: 0, padding: 0, listStyle: 'none' },
      entry: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        fontSize: '12px',
        lineHeight: 1.6,
      },
      entryText: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      entryActions: { display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' },
      scoreWrap: { display: 'flex', alignItems: 'center', gap: '4px' },
      scoreLabel: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
      scoreInput: {
        width: '58px',
        boxSizing: 'border-box',
        fontFamily: 'inherit',
        fontSize: '12px',
        lineHeight: 1.6,
        padding: '3px 6px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-module-platform)',
        color: 'var(--dsw-alias-label-primary)',
      },
      textInput: {
        width: '100%',
        boxSizing: 'border-box',
        fontFamily: 'inherit',
        fontSize: '12px',
        lineHeight: 1.6,
        padding: '8px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-module-platform)',
        color: 'var(--dsw-alias-label-primary)',
      },
      textarea: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: '120px',
        resize: 'vertical',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '12px',
        lineHeight: 1.6,
        padding: '8px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-module-platform)',
        color: 'var(--dsw-alias-label-primary)',
      },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: '60px',
        resize: 'vertical',
        fontFamily: 'inherit',
        fontSize: '12px',
        lineHeight: 1.6,
        padding: '8px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-module-platform)',
        color: 'var(--dsw-alias-label-primary)',
      },
      row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      banner: {
        fontSize: '12px',
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        lineHeight: 1.6,
      },
      bannerError: { borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' },
      bannerOk: { color: 'var(--dsw-alias-state-business-primary)' },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
      th: {
        textAlign: 'left',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-tertiary)',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        padding: '6px 8px',
      },
      td: { borderBottom: '1px solid var(--dsw-alias-border-l1)', padding: '8px', verticalAlign: 'top', lineHeight: 1.6 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '11px' },
      empty: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '12px 0' },
      kv: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', fontSize: '12px', alignItems: 'baseline' },
      key: { color: 'var(--dsw-alias-label-tertiary)' },
      badge: {
        display: 'inline-block',
        fontSize: '11px',
        padding: '1px 6px',
        borderRadius: '999px',
        border: '1px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-secondary)',
      },
    }

    /**
     * Fill `{name}` placeholders.
     * @param {string} template message template.
     * @param {Record<string, unknown>} values replacement values.
     * @returns {string} message.
     */
    function fmt(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) =>
        values[key] === undefined ? match : String(values[key]),
      )
    }

    /**
     * Read the current locale id. The locale service is asked first, but its
     * snapshot has used more than one field name across versions, so the
     * document language and then the browser language are the fallback chain.
     * @param {any} ctx client context.
     * @returns {string} lowercase locale id, or `''` when nothing is known.
     */
    function localeId(ctx) {
      const candidates = []
      try {
        const snapshot = ctx.locale?.getLocale?.() ?? ctx.locale?.getSnapshot?.() ?? {}
        candidates.push(
          snapshot.id,
          snapshot.locale,
          snapshot.language,
          snapshot.lang,
          snapshot.current,
          snapshot.value,
        )
      } catch {
        /* fall through to the document */
      }
      try {
        candidates.push(document?.documentElement?.lang)
      } catch {
        /* not in a document */
      }
      try {
        candidates.push(navigator?.language)
      } catch {
        /* no navigator */
      }
      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim().toLowerCase()
      }
      return ''
    }

    const LANGUAGE_KEY = 'dsh-homeostasis-memory:language'
    /** Key an older release stored the same choice under. */
    const LEGACY_LANGUAGE_KEY = 'dsh-memory:language'

    /**
     * A language the person picked in this page, if any.
     * @returns {'' | 'zh' | 'en'} stored choice.
     */
    function readStoredLang() {
      try {
        const value = window.localStorage.getItem(LANGUAGE_KEY)
        if (value === 'zh' || value === 'en') return value
        const legacy = window.localStorage.getItem(LEGACY_LANGUAGE_KEY)
        return legacy === 'zh' || legacy === 'en' ? legacy : ''
      } catch {
        return ''
      }
    }

    /**
     * Remember a language choice for this browser profile.
     * @param {'zh' | 'en'} value chosen language.
     * @returns {void}
     */
    function storeLang(value) {
      try {
        window.localStorage.setItem(LANGUAGE_KEY, value)
      } catch {
        /* private mode: the choice lasts for this mount only */
      }
    }

    /**
     * The language this page should render in: an explicit configuration wins,
     * otherwise the surrounding app or browser decides.
     * @param {any} ctx client context.
     * @param {string | undefined} configured `auto` | `zh` | `en` from the Host.
     * @returns {'zh' | 'en'} language key.
     */
    function languageOf(ctx, configured) {
      if (configured === 'zh' || configured === 'en') return configured
      return localeId(ctx).startsWith('zh') ? 'zh' : 'en'
    }

    /**
     * Relative time for a timestamp.
     * @param {number} time epoch milliseconds.
     * @param {string} lang language key.
     * @returns {string} display text.
     */
    function ago(time, lang) {
      if (!Number.isFinite(time) || time <= 0) return '—'
      const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
      const zh = lang === 'zh'
      if (seconds < 60) return zh ? '刚刚' : 'just now'
      const minutes = Math.round(seconds / 60)
      if (minutes < 60) return zh ? `${minutes} 分钟前` : `${minutes} min ago`
      const hours = Math.round(minutes / 60)
      if (hours < 24) return zh ? `${hours} 小时前` : `${hours} h ago`
      const days = Math.round(hours / 24)
      return zh ? `${days} 天前` : `${days} d ago`
    }

    /**
     * POST one action and surface its failure message.
     * @param {string} path endpoint path.
     * @param {Record<string, unknown>} payload request body.
     * @returns {Promise<object>} parsed response.
     */
    async function post(path, payload) {
      const response = await fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      const data = await response.json().catch(() => ({ ok: false, error: 'invalid response' }))
      if (!data || (data.success !== true && data.ok !== true)) {
        const message = data?.message ?? data?.error ?? `request failed (${response.status})`
        throw new Error(String(message))
      }
      return data
    }

    /** @returns {object} element styles merged with a base. */
    function merge(base, extra) {
      return extra === undefined ? base : { ...base, ...extra }
    }

    /** Byte size of the text, matching the persona's ceiling. */
    function bytesOf(value) {
      return new TextEncoder().encode(String(value)).length
    }

    /**
     * Mean score of the scored entries, for the status card.
     * @param {Array<{score?: number | null}>} entries hot-memory entries.
     * @returns {string} one decimal place, or an em dash when none are scored.
     */
    function averageScore(entries) {
      const scored = (Array.isArray(entries) ? entries : []).filter((entry) => typeof entry?.score === 'number')
      if (scored.length === 0) return '—'
      const total = scored.reduce((sum, entry) => sum + entry.score, 0)
      return (total / scored.length).toFixed(1)
    }

    /**
     * Entries in the order the memory page shows them: score descending, ties in
     * file order. Display only; the file is never reordered.
     * @param {Array<{score?: number | null}>} entries hot-memory entries.
     * @returns {Array<object>} sorted copy.
     */
    function byScore(entries) {
      return [...(Array.isArray(entries) ? entries : [])].sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    }

    function Bar({ used, limit }) {
      const ratio = limit > 0 ? Math.min(1, used / limit) : 0
      const fill = ratio >= 0.9 ? S.barFillWarn : S.barFill
      return h(
        'div',
        { style: S.barTrack, role: 'progressbar', 'aria-valuenow': used, 'aria-valuemax': limit },
        h('div', { style: merge(fill, { width: `${Math.round(ratio * 100)}%` }) }),
      )
    }

    function Card({ title, hint, children }) {
      return h(
        'div',
        { style: S.card },
        h('div', { style: S.cardHead }, h('span', { style: S.cardTitle }, title)),
        children,
        hint === undefined ? null : h('div', { style: S.hint }, hint),
      )
    }

    function Banner({ tone, children }) {
      const base = merge(S.banner, tone === 'error' ? S.bannerError : S.bannerOk)
      return h('div', { style: base, role: tone === 'error' ? 'alert' : 'status' }, children)
    }

    // ── Status ────────────────────────────────────────────────────────────
    function StatusTab({ state, t }) {
      const p = state.persona
      const u = state.hot.user
      const m = state.hot.memory
      const last = state.review.recent[0]

      return h(
        'div',
        { style: S.root },
        h(
          'div',
          { style: S.grid },
          h(
            Card,
            { title: t.status.persona, hint: p.path },
            h('div', { style: S.metric }, `${p.bytes} / ${p.maxBytes}`, h('span', { style: merge(S.hint, { fontSize: '11px' }) }, ` ${t.status.bytes}`)),
            h(Bar, { used: p.bytes, limit: p.maxBytes }),
            h('div', { style: S.hint }, `${t.status.revision} ${p.revision}`),
          ),
          h(
            Card,
            { title: t.status.user, hint: u.path },
            h('div', { style: S.metric }, `${u.used} / ${u.limit}`),
            h(Bar, { used: u.used, limit: u.limit }),
            h('div', { style: S.hint }, `${u.entries.length} ${t.status.entries}`),
          ),
          h(
            Card,
            { title: t.status.memory, hint: m.path },
            h('div', { style: S.metric }, `${m.entries.length}`, h('span', { style: merge(S.hint, { fontSize: '11px' }) }, ` ${t.status.entries}`)),
            h('div', { style: S.hint }, `${t.status.avgScore} ${averageScore(m.entries)}`),
          ),
        ),
        h(
          'div',
          { style: S.grid },
          h(Card, { title: t.status.skills }, h('div', { style: S.metric }, `${state.skills.length}`), h('div', { style: S.hint }, t.status.skillsUnit)),
          h(
            Card,
            { title: t.status.review },
            last === undefined
              ? h('div', { style: S.hint }, t.status.noReview)
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                  h('div', { style: S.metric }, String(last.result ?? '—')),
                  h('div', { style: S.hint }, `${ago(Date.parse(last.ts), t === TEXT.zh ? 'zh' : 'en')} · ${last.durationMs ?? 0} ms`),
                  Array.isArray(last.actions) && last.actions.length > 0
                    ? h('div', { style: S.hint }, last.actions.join(', '))
                    : null,
                ),
          ),
        ),
        h('div', { style: S.hint }, state.home),
      )
    }

    // ── Persona editor ────────────────────────────────────────────────────
    /**
     * The persona document. It is edited whole because the file itself is the
     * unit: plain text, no entry structure, a byte ceiling, and a second
     * confirmation before the write.
     */
    function FullTextEditor({ title, path, text, limit, measure, hint, notice, onSave, onDone, t, minHeight, locked, lockedText }) {
      const [draft, setDraft] = useState(text)
      const [editing, setEditing] = useState(false)
      const [confirming, setConfirming] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [done, setDone] = useState(null)

      useEffect(() => {
        // A refresh must not clobber an in-progress edit.
        if (!editing) {
          setDraft(text)
          setConfirming(false)
        }
      }, [text])

      const size = measure(draft)
      const dirty = draft !== text
      const over = size > limit

      const save = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          await onSave(draft)
          setDone(notice)
          setEditing(false)
          setConfirming(false)
          if (typeof onDone === 'function') onDone()
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setBusy(false)
        }
      }, [draft, notice, onDone, onSave])

      return h(
        'div',
        { style: S.card },
        h(
          'div',
          { style: S.cardHead },
          h('span', { style: S.cardTitle }, title),
          h(
            'span',
            { style: merge(S.hint, over ? { color: 'var(--dsw-alias-state-error-primary)' } : undefined) },
            `${size} / ${limit}`,
          ),
        ),
        h(
          'div',
          { style: S.row },
          h('code', { style: merge(S.hint, { flex: '1 1 180px' }) }, path),
          locked
            ? null
            : editing
              ? h(
                  React.Fragment,
                  null,
                  h('button', {
                    style: merge(S.button, dirty && !over ? S.buttonPrimary : S.buttonDisabled),
                    disabled: !dirty || busy || over,
                    onClick: () => setConfirming(true),
                  }, t.common.save),
                  h('button', {
                    style: S.button,
                    disabled: busy,
                    onClick: () => {
                      setDraft(text)
                      setEditing(false)
                      setConfirming(false)
                      setError(null)
                    },
                  }, t.common.cancel),
                )
              : h('button', {
                  style: S.button,
                  onClick: () => {
                    setEditing(true)
                    setDone(null)
                  },
                }, t.common.edit),
        ),
        locked ? h(Banner, { tone: 'error' }, lockedText ?? t.hot.unreadable) : null,
        error === null ? null : h(Banner, { tone: 'error' }, error),
        done === null ? null : h(Banner, { tone: 'ok' }, done),
        confirming
          ? h(
              'div',
              {
                style: merge(S.row, {
                  justifyContent: 'space-between',
                  border: '1px solid var(--dsw-alias-border-l2)',
                  borderRadius: '8px',
                  padding: '8px 10px',
                }),
              },
              h('span', { style: { fontSize: '12px' } }, t.common.confirm),
              h(
                'div',
                { style: S.row },
                h('button', {
                  style: merge(S.button, S.buttonPrimary),
                  disabled: busy,
                  onClick: () => void save(),
                }, t.common.confirmWrite),
                h('button', { style: S.button, disabled: busy, onClick: () => setConfirming(false) }, t.common.cancel),
              ),
            )
          : null,
        h('textarea', {
          style: merge(S.textarea, { minHeight }),
          value: draft,
          spellCheck: false,
          readOnly: !editing || locked,
          onChange: (event) => setDraft(event.target.value),
        }),
        h('div', { style: S.hint }, hint),
      )
    }

    // ── Persona ───────────────────────────────────────────────────────────
    function PersonaTab({ state, t, onSaved }) {
      return h(FullTextEditor, {
        title: t.status.persona,
        path: state.persona.path,
        text: state.persona.text,
        limit: state.persona.maxBytes,
        measure: bytesOf,
        hint: fmt(t.persona.hint, { max: state.persona.maxBytes }),
        notice: t.persona.saved,
        onSave: (value) => post('/persona', { text: value }),
        onDone: onSaved,
        t,
        minHeight: '340px',
        locked: state.persona.readable === false,
      })
    }

    // ── Memory stores ─────────────────────────────────────────────────────
    /**
     * One entry. Entries are the unit the Host addresses (`§`-separated), so the
     * page edits exactly one at a time and never has to rebuild the separators.
     */
    function Entry({ text, score, t, onReplace, onRemove, onScore, busy }) {
      const [mode, setMode] = useState('view')
      const [draft, setDraft] = useState(text)
      const [scoreDraft, setScoreDraft] = useState(String(score ?? 5))
      const [error, setError] = useState(null)

      useEffect(() => {
        setDraft(text)
        setMode('view')
      }, [text])

      useEffect(() => {
        setScoreDraft(String(score ?? 5))
      }, [score])

      const run = async (action) => {
        setError(null)
        try {
          await action()
          setMode('view')
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        }
      }

      /**
       * Save the score typed in this row. Content edits never call this, so a
       * rewritten entry keeps its score.
       */
      const commitScore = async () => {
        if (typeof onScore !== 'function' || typeof score !== 'number') return
        const raw = String(scoreDraft).trim()
        const parsed = Number(raw)
        if (raw === '' || !Number.isInteger(parsed)) {
          setScoreDraft(String(score))
          return
        }
        if (parsed === score) {
          setScoreDraft(String(score))
          return
        }
        setError(null)
        try {
          await onScore(text, parsed)
        } catch (failure) {
          setError(String(failure?.message ?? failure))
          setScoreDraft(String(score))
        }
      }

      const scored = typeof score === 'number' && typeof onScore === 'function'

      return h(
        'li',
        { style: S.entry },
        mode === 'edit'
          ? h('textarea', {
              style: S.input,
              value: draft,
              spellCheck: false,
              onChange: (event) => setDraft(event.target.value),
            })
          : h('div', { style: S.entryText }, text),
        error === null
          ? null
          : h('div', { style: merge(S.hint, { color: 'var(--dsw-alias-state-error-primary)' }) }, error),
        h(
          'div',
          { style: S.entryActions },
          mode === 'edit'
            ? h(
                React.Fragment,
                null,
                h('button', {
                  style: merge(S.button, S.buttonPrimary),
                  disabled: busy || draft.trim() === '',
                  onClick: () => void run(() => onReplace(text, draft)),
                }, t.hot.save),
                h('button', {
                  style: S.button,
                  onClick: () => {
                    setDraft(text)
                    setMode('view')
                    setError(null)
                  },
                }, t.hot.cancel),
              )
            : mode === 'confirm'
              ? h(
                  React.Fragment,
                  null,
                  h('button', {
                    style: merge(S.button, S.buttonDanger),
                    disabled: busy,
                    onClick: () => void run(() => onRemove(text)),
                  }, t.hot.confirmRemove),
                  h('button', { style: S.button, onClick: () => setMode('view') }, t.hot.cancel),
                )
              : h(
                  React.Fragment,
                  null,
                  h('button', { style: S.button, onClick: () => setMode('edit') }, t.hot.edit),
                  scored
                    ? h(
                        'label',
                        { style: S.scoreWrap, title: t.hot.score },
                        h('span', { style: S.scoreLabel }, t.hot.score),
                        h('input', {
                          type: 'number',
                          step: 1,
                          inputMode: 'numeric',
                          'aria-label': t.hot.score,
                          style: S.scoreInput,
                          value: scoreDraft,
                          disabled: busy,
                          onChange: (event) => setScoreDraft(event.target.value),
                          onBlur: () => void commitScore(),
                          onKeyDown: (event) => {
                            if (event.key === 'Enter') event.currentTarget.blur()
                          },
                        }),
                      )
                    : null,
                  h('button', {
                    style: merge(S.button, S.buttonDanger),
                    onClick: () => setMode('confirm'),
                  }, t.hot.remove),
                ),
        ),
      )
    }

    function StorePanel({ title, store, t, busy, actions, scored }) {
      const [draft, setDraft] = useState('')
      const [error, setError] = useState(null)

      const add = async () => {
        setError(null)
        try {
          await actions.add(draft)
          setDraft('')
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        }
      }

      const limited = typeof store.limit === 'number'
      const entries = scored ? byScore(store.entries) : store.entries

      return h(
        'div',
        { style: S.card },
        h(
          'div',
          { style: S.cardHead },
          h('span', { style: S.cardTitle }, title),
          h(
            'span',
            { style: S.hint },
            limited
              ? fmt(t.hot.usage, { used: store.used, limit: store.limit })
              : `${store.entries.length} ${t.status.entries} · ${t.status.avgScore} ${averageScore(store.entries)}`,
          ),
        ),
        limited ? h(Bar, { used: store.used, limit: store.limit }) : null,
        store.readable === false ? h(Banner, { tone: 'error' }, t.hot.unreadable) : null,
        store.drift === null || store.drift === undefined
          ? null
          : h(Banner, { tone: 'error' }, t.hot.drift),
        entries.length === 0
          ? h('div', { style: S.empty }, t.status.none)
          : h(
              'ul',
              { style: S.list },
              entries.map((entry, index) =>
                h(Entry, {
                  key: `${index}-${entry.text.slice(0, 24)}`,
                  text: entry.text,
                  score: entry.score,
                  t,
                  busy,
                  onReplace: (oldText, newText) => actions.replace(oldText, newText),
                  onRemove: (oldText) => actions.remove(oldText),
                  onScore: actions.score,
                }),
              ),
            ),
        scored ? h('div', { style: S.hint }, t.hot.memoryNote) : null,
        error === null ? null : h(Banner, { tone: 'error' }, error),
        h('textarea', {
          style: S.input,
          value: draft,
          placeholder: t.hot.placeholder,
          spellCheck: false,
          disabled: store.readable === false,
          onChange: (event) => setDraft(event.target.value),
        }),
        h(
          'div',
          { style: S.entryActions },
          h('button', {
            style: merge(S.button, S.buttonPrimary),
            disabled: busy || draft.trim() === '' || store.readable === false,
            onClick: () => void add(),
          }, t.hot.add),
        ),
        h('div', { style: S.hint }, store.path),
      )
    }

    function HotTab({ state, t, onChanged }) {
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState(null)
      const [error, setError] = useState(null)

      const wrap = useCallback(
        async (path, payload, message) => {
          setBusy(true)
          setError(null)
          try {
            await post(path, payload)
            setNotice(message)
            onChanged()
          } catch (failure) {
            setError(String(failure?.message ?? failure))
            throw failure
          } finally {
            setBusy(false)
          }
        },
        [onChanged],
      )

      const actionsFor = (target) => ({
        add: (content) => wrap('/memory/add', { target, content }, t.hot.added),
        replace: (oldText, newText) => wrap('/memory/replace', { target, oldText, newText }, t.hot.updated),
        remove: (oldText) => wrap('/memory/remove', { target, oldText }, t.hot.removed),
        ...(target === 'memory'
          ? { score: (text, value) => wrap('/memory/score', { target, text, score: value }, t.hot.scoreSaved) }
          : {}),
      })

      return h(
        'div',
        { style: S.root },
        error === null ? null : h(Banner, { tone: 'error' }, error),
        notice === null ? null : h(Banner, { tone: 'ok' }, notice),
        h('div', { style: S.hint }, t.status.next),
        h(
          'div',
          { style: S.two },
          h(StorePanel, { title: t.status.user, store: state.hot.user, t, busy, actions: actionsFor('user') }),
          h(StorePanel, {
            title: t.status.memory,
            store: state.hot.memory,
            t,
            busy,
            scored: true,
            actions: actionsFor('memory'),
          }),
        ),
      )
    }

    // ── Skills ────────────────────────────────────────────────────────────
    function SkillsTab({ state, t, lang }) {
      if (state.skills.length === 0) return h('div', { style: S.empty }, t.skills.none)
      return h(
        'table',
        { style: S.table },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', { style: S.th }, t.skills.name),
            h('th', { style: S.th }, t.skills.description),
            h('th', { style: S.th }, t.skills.size),
            h('th', { style: S.th }, t.skills.files),
            h('th', { style: S.th }, t.skills.modified),
          ),
        ),
        h(
          'tbody',
          null,
          state.skills.map((skill) =>
            h(
              'tr',
              { key: skill.name },
              h('td', { style: S.td }, h('code', { style: S.mono }, skill.name)),
              h('td', { style: S.td }, skill.description === '' ? '—' : skill.description),
              h('td', { style: merge(S.td, S.mono) }, String(skill.chars)),
              h('td', { style: merge(S.td, S.mono) }, String(skill.supportFiles)),
              h('td', { style: merge(S.td, S.hint) }, ago(skill.mtimeMs, lang)),
            ),
          ),
        ),
      )
    }

    // ── Review ────────────────────────────────────────────────────────────
    /** One radio row: a title, an optional explanation, and the input itself. */
    function Choice({ name, checked, onSelect, title, hint, disabled }) {
      return h(
        'label',
        {
          style: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            padding: '8px 10px',
            border: `1px solid ${checked ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l1)'}`,
            borderRadius: '8px',
            cursor: disabled === true ? 'not-allowed' : 'pointer',
            opacity: disabled === true ? 0.6 : 1,
          },
        },
        h('input', {
          type: 'radio',
          name,
          checked,
          disabled: disabled === true,
          onChange: onSelect,
          style: { marginTop: '3px' },
        }),
        h(
          'span',
          { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 } },
          h('span', { style: { fontSize: '12px', fontWeight: 600 } }, title),
          hint === undefined ? null : h('span', { style: S.hint }, hint),
        ),
      )
    }

    function ReviewTab({ state, t, lang, onSaved }) {
      const saved = state.review.settings
      const c = state.review.config
      const [draft, setDraft] = useState(saved)
      const [models, setModels] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)

      useEffect(() => {
        setDraft(saved)
      }, [saved])

      // The catalog is only needed once the fixed-model option is chosen.
      useEffect(() => {
        if (draft.model.mode !== 'fixed' || models !== null) return undefined
        let live = true
        void (async () => {
          try {
            const response = await fetch(`${API}/review-models`)
            const data = await response.json().catch(() => null)
            if (live) setModels(Array.isArray(data?.models) ? data.models : [])
          } catch {
            if (live) setModels([])
          }
        })()
        return () => {
          live = false
        }
      }, [draft.model.mode, models])

      const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

      const save = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          await post('/review-settings', draft)
          setNotice(t.review.saved)
          onSaved()
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setBusy(false)
        }
      }, [draft, onSaved, t])

      const options = models ?? []
      const current = draft.model
      const known = options.some((entry) => entry.provider === current.provider && entry.id === current.model)

      return h(
        'div',
        { style: S.root },
        error === null ? null : h(Banner, { tone: 'error' }, error),
        notice === null ? null : h(Banner, { tone: 'ok' }, notice),
        h(
          'div',
          { style: S.card },
          h(
            'label',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } },
            h('input', {
              type: 'checkbox',
              checked: draft.enabled === true,
              onChange: (event) => setDraft({ ...draft, enabled: event.target.checked }),
            }),
            h('span', { style: { fontSize: '12px', fontWeight: 600 } }, t.review.toggle),
            h(
              'span',
              { style: S.hint },
              draft.model.mode === 'fixed'
                ? (draft.enabled === true ? t.review.masterOn : t.review.masterOff)
                : (draft.enabled === true ? t.review.enabledHint : t.review.disabledAll),
            ),
          ),
          draft.model.mode === 'fixed'
            ? null
            : h(
                'label',
                { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } },
                h('input', {
                  type: 'checkbox',
                  checked: draft.passive === true,
                  disabled: draft.enabled !== true,
                  onChange: (event) => setDraft({ ...draft, passive: event.target.checked }),
                }),
                h('span', { style: { fontSize: '12px', fontWeight: 600 } }, t.review.passiveToggle),
                h(
                  'span',
                  { style: S.hint },
                  draft.enabled !== true
                    ? t.review.disabledAll
                    : draft.passive === true
                      ? fmt(t.review.passiveHint, { n: c.intervalTurns, m: c.idleMinutes })
                      : t.review.passiveOff,
                ),
              ),
          h('div', { style: S.cardTitle }, t.review.strategy),
          h('div', { style: { fontSize: '12px', fontWeight: 600 } }, draft.model.mode === 'fixed' ? t.review.strategySync : t.review.strategyStandard),
          h('div', { style: S.hint }, draft.model.mode === 'fixed' ? t.review.strategySyncHint : t.review.strategyStandardHint),
          h('div', { style: S.cardTitle }, t.review.model),
          h(Choice, {
            name: 'review-model',
            checked: draft.model.mode === 'inherit',
            onSelect: () => setDraft({ ...draft, model: { ...draft.model, mode: 'inherit' } }),
            title: t.review.modelInherit,
            hint: t.review.modelInheritHint,
          }),
          h(Choice, {
            name: 'review-model',
            checked: draft.model.mode === 'fixed',
            onSelect: () => setDraft({ ...draft, model: { ...draft.model, mode: 'fixed' } }),
            title: t.review.modelFixed,
            hint: t.review.modelFixedHint,
          }),
          draft.model.mode === 'fixed'
            ? models === null
              ? h('div', { style: S.hint }, t.review.loadingModels)
              : options.length === 0
                ? h(Banner, { tone: 'error' }, t.review.noModels)
                : h(
                    'select',
                    {
                      value: known ? `${current.provider}\u0000${current.model}` : '',
                      style: {
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        border: '1px solid var(--dsw-alias-border-l2)',
                        background: 'var(--dsw-alias-bg-module-platform)',
                        color: 'var(--dsw-alias-label-primary)',
                        fontSize: '12px',
                      },
                      onChange: (event) => {
                        const [provider, model] = event.target.value.split('\u0000')
                        setDraft({ ...draft, model: { mode: 'fixed', provider, model } })
                      },
                    },
                    h('option', { value: '' }, t.review.chooseModel),
                    options.map((entry) =>
                      h(
                        'option',
                        { key: `${entry.provider}/${entry.id}`, value: `${entry.provider}\u0000${entry.id}` },
                        `${entry.provider} / ${entry.name === entry.id ? entry.id : `${entry.name} (${entry.id})`}`,
                      ),
                    ),
                  )
            : null,
          h(
            'div',
            { style: S.entryActions },
            h('button', {
              style: merge(S.button, dirty ? S.buttonPrimary : S.buttonDisabled),
              disabled: !dirty || busy,
              onClick: () => void save(),
            }, t.common.save),
            h('button', {
              style: S.button,
              disabled: busy || !dirty,
              onClick: () => {
                setDraft(saved)
                setError(null)
                setNotice(null)
              },
            }, t.common.cancel),
          ),
        ),
        h(
          'div',
          { style: S.card },
          h(
            'div',
            { style: S.kv },
            h('span', { style: S.key }, t.review.interval),
            h(
              'span',
              null,
              draft.model.mode === 'fixed'
                ? t.review.strategySync
                : `${fmt(t.review.turns, { n: c.intervalTurns })} · ${t.review.idle} ${fmt(t.review.minutes, { n: c.idleMinutes })}`,
            ),
            h('span', { style: S.key }, t.review.maxPerSession),
            h('span', null, String(c.maxPerSession)),
            h('span', { style: S.key }, t.review.maxTokens),
            h('span', null, String(c.maxTokens)),
            h('span', { style: S.key }, t.review.log),
            h('code', { style: S.mono }, c.logPath),
            h('span', { style: S.key }, t.review.keep),
            h('span', null, `${c.logMaxEntries ?? 5} ${t.status.entries}`),
            h('span', { style: S.key }, t.review.settingsFile),
            h('code', { style: S.mono }, c.settingsPath ?? ''),
          ),
        ),
        state.review.recent.length === 0
          ? h('div', { style: S.empty }, t.review.none)
          : h(
              'ul',
              { style: S.list },
              state.review.recent.map((record, index) =>
                h(
                  'li',
                  { key: `${record.ts ?? index}-${index}`, style: S.entry },
                  h(
                    'div',
                    { style: S.row },
                    h('span', { style: S.badge }, String(record.result ?? '—')),
                    record.strategy === undefined ? null : h('span', { style: S.badge }, String(record.strategy)),
                    record.trigger === undefined
                      ? null
                      : h(
                          'span',
                          { style: S.badge },
                          record.trigger === 'closing'
                            ? t.review.triggerClosing
                            : record.trigger === 'idle'
                              ? t.review.triggerIdle
                              : record.trigger === 'turn'
                                ? t.review.triggerTurn
                                : String(record.trigger),
                        ),
                    h('span', { style: S.hint }, ago(Date.parse(record.ts), lang)),
                    record.superseded === true ? h('span', { style: S.badge }, 'superseded') : null,
                    record.error === undefined ? null : h('span', { style: merge(S.hint, { color: 'var(--dsw-alias-state-error-primary)' }) }, String(record.error)),
                  ),
                  h(
                    'div',
                    { style: S.hint },
                    `${t.review.duration} ${record.durationMs ?? 0} ms · ${record.inputChars ?? 0} chars · ${t.review.actions} ${
                      Array.isArray(record.actions) && record.actions.length > 0 ? record.actions.join(', ') : '—'
                    }`,
                  ),
                  typeof record.summary === 'string' && record.summary !== ''
                    ? h('div', { style: S.entryText }, record.summary)
                    : null,
                ),
              ),
            ),
      )
    }

    // ── Approval ──────────────────────────────────────────────────────────
    /**
     * The approval knob for live sessions. The policy is bundled with the
     * sandbox mode in a permission preset, so this page can only change one
     * half — the session becomes "custom" and new sessions keep the preset.
     */
    function ApprovalTab({ t, onChanged }) {
      const [state, setState] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)

      const load = useCallback(async () => {
        try {
          const response = await fetch(`${API}/approval`)
          const data = await response.json().catch(() => null)
          setState(data)
          if (!data || data.ok !== true) setError(String(data?.error ?? 'request failed'))
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        }
      }, [])

      useEffect(() => {
        void load()
      }, [load])

      const apply = useCallback(
        async (policy) => {
          setBusy(true)
          setError(null)
          setNotice(null)
          try {
            const data = await post('/approval-policy', { policy })
            setNotice(`${t.approval.applied}: ${data.applied ?? 0}`)
            await load()
            if (typeof onChanged === 'function') onChanged()
          } catch (failure) {
            setError(String(failure?.message ?? failure))
          } finally {
            setBusy(false)
          }
        },
        [load, onChanged, t],
      )

      const sessions = state?.sessions ?? []

      return h(
        'div',
        { style: S.root },
        error === null ? null : h(Banner, { tone: 'error' }, error),
        notice === null ? null : h(Banner, { tone: 'ok' }, notice),
        h(
          'div',
          { style: S.card },
          h('div', { style: S.cardTitle }, t.approval.policy),
          h('div', { style: S.hint }, t.approval.intro),
          h('div', { style: S.hint }, t.approval.toggleHint),
          state !== null && state.available === false ? h(Banner, { tone: 'error' }, t.approval.unavailable) : null,
          h(
            'div',
            { style: S.entryActions },
            h('button', { style: merge(S.button, S.buttonPrimary), disabled: busy, onClick: () => void apply('ask') }, t.approval.setAsk),
            h('button', { style: merge(S.button, S.buttonDanger), disabled: busy, onClick: () => void apply('never') }, t.approval.setNever),
            h('button', { style: S.button, disabled: busy, onClick: () => void load() }, t.refresh),
          ),
          h('div', { style: S.hint }, t.approval.presetHint),
        ),
        h('div', { style: S.cardTitle }, t.approval.current),
        sessions.length === 0
          ? h('div', { style: S.empty }, t.approval.empty)
          : h(
              'ul',
              { style: S.list },
              sessions.map((session) =>
                h(
                  'li',
                  { key: session.id, style: S.entry },
                  h(
                    'div',
                    { style: S.row },
                    h('code', { style: S.mono }, String(session.id).slice(0, 28)),
                    h('span', { style: S.badge }, session.policy === null ? t.approval.unset : String(session.policy)),
                  ),
                ),
              ),
            ),
      )
    }

    // ── Long-term memory ──────────────────────────────────────────────────
    /** Category colours, so a list reads as a shape before it reads as text. */
    const CATEGORY_COLOR = {
      preference: '#2ecc71',
      decision: '#9b59b6',
      fact: '#3498db',
      insight: '#f1c40f',
      context: '#f39c12',
      general: '#95a5a6',
    }
    /** Edge colours, mirroring the graph vocabulary. */
    const EDGE_COLOR = { temporal: '#aaaaaa', semantic: '#3498db', causal: '#e74c3c', entity: '#2ecc71' }

    /**
     * One space card: identity, participation, and what it holds.
     * @param {object} props component props.
     * @returns {object} rendered element.
     */
    function SpaceCard({ space, selected, onSelect, onToggle, onDelete, busy, t }) {
      const stats = space.stats
      const active = space.active === true
      return h(
        'div',
        {
          style: merge(S.entry, { cursor: 'pointer', borderColor: selected ? 'var(--dsw-alias-state-business-primary)' : undefined }),
          onClick: () => onSelect(space.id),
          role: 'button',
          tabIndex: 0,
          'aria-pressed': selected,
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onSelect(space.id)
            }
          },
        },
        h(
          'div',
          { style: S.row },
          h('strong', null, space.name),
          h('code', { style: S.mono }, space.id),
          h('span', { style: merge(S.badge, space.healthy ? undefined : S.bannerError), title: space.error ?? '' }, space.healthy ? t.longTerm.spaceHealthy : t.longTerm.spaceBroken),
          stats === null
            ? null
            : h('span', { style: S.badge }, t.longTerm.spaceEntries.replace('{n}', String(stats.totalInsights ?? 0))),
          space.providerRelated === false ? null : h('span', { style: S.badge }, t.longTerm.spaceRelated),
        ),
        space.description === '' ? null : h('div', { style: S.hint }, space.description),
        stats === null || typeof stats.byCategory !== 'object' ? null : h(
          'div',
          { style: S.row },
          Object.entries(stats.byCategory).filter(([, count]) => count > 0).map(([category, count]) =>
            h(
              'span',
              { key: category, style: merge(S.badge, { borderColor: CATEGORY_COLOR[category] ?? '#95a5a6', color: CATEGORY_COLOR[category] ?? '#95a5a6' }) },
              `${category} ${String(count)}`,
            ),
          ),
        ),
        h(
          'div',
          { style: S.entryActions, onClick: (event) => event.stopPropagation() },
          h(
            'button',
            {
              style: merge(S.button, active ? S.buttonPrimary : undefined),
              disabled: busy,
              onClick: () => onToggle(space.id, !active),
            },
            active ? t.longTerm.spaceActive : t.longTerm.spaceInactive,
          ),
          h(
            'button',
            {
              style: merge(merge(S.button, S.buttonDanger), busy ? S.buttonDisabled : undefined),
              disabled: busy,
              title: t.longTerm.spaceDeleteHint,
              onClick: () => onDelete(space),
            },
            t.longTerm.spaceDelete,
          ),
        ),
      )
    }

    /**
     * One archived memory.
     * @param {object} props component props.
     * @returns {object} rendered element.
     */
    function MemoryItem({ item, t, onRelated, related }) {
      const [expanded, setExpanded] = useState(false)
      const colour = CATEGORY_COLOR[item.category] ?? '#95a5a6'
      const lines = String(item.content ?? '').split('\n')
      const long = lines.length > 4 || [...String(item.content ?? '')].length > 240
      const shown = long && !expanded ? [...String(item.content ?? '')].slice(0, 240).join('') : item.content
      return h(
        'li',
        { style: S.entry },
        h(
          'div',
          { style: S.row },
          item.category === '' ? null : h('span', { style: merge(S.badge, { borderColor: colour, color: colour }) }, item.category),
          typeof item.importance === 'number' ? h('span', { style: S.badge }, `imp ${String(item.importance)}`) : null,
          typeof item.score === 'number' ? h('span', { style: S.badge }, item.score.toFixed(2)) : null,
          item.createdAt === null || item.createdAt === undefined ? null : h('span', { style: S.hint }, String(item.createdAt).slice(0, 10)),
        ),
        h('div', { style: S.entryText }, shown),
        h(
          'div',
          { style: S.entryActions },
          long ? h('button', { style: S.button, onClick: () => setExpanded(!expanded) }, expanded ? '−' : '…') : null,
          onRelated === undefined ? null : h('button', { style: S.button, onClick: () => onRelated(item) }, t.longTerm.related),
        ),
        related === undefined
          ? null
          : h(
              'div',
              { style: { borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: '6px' } },
              h('div', { style: S.hint }, t.longTerm.relatedTitle),
              related.loading === true
                ? h('div', { style: S.hint }, t.longTerm.loadingRelated)
                : related.error !== undefined
                  ? h('div', { style: S.hint }, related.error)
                  : related.items.length === 0
                    ? h('div', { style: S.hint }, t.longTerm.noRelated)
                    : h(
                        'ul',
                        { style: S.list },
                        related.items.map((neighbour) =>
                          h(
                            'li',
                            { key: neighbour.id, style: { fontSize: '11px', display: 'flex', gap: '6px', alignItems: 'baseline' } },
                            neighbour.viaEdgeType === null
                              ? null
                              : h(
                                  'span',
                                  { style: merge(S.badge, { borderColor: EDGE_COLOR[neighbour.viaEdgeType] ?? '#aaaaaa', color: EDGE_COLOR[neighbour.viaEdgeType] ?? '#aaaaaa' }) },
                                  neighbour.viaEdgeType,
                                ),
                            h('span', { style: S.hint }, `d${String(neighbour.depth)}`),
                            h('span', null, neighbour.content),
                          ),
                        ),
                      ),
            ),
      )
    }

    /**
     * The long-term memory tab.
     * @param {object} props component props.
     * @returns {object} rendered element.
     */
    function LongTermTab({ state, t, onChanged }) {
      const lt = state.longTerm
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState(null)
      const [error, setError] = useState(null)
      const [selected, setSelected] = useState(null)
      const [query, setQuery] = useState('')
      const [items, setItems] = useState(null)
      const [scanning, setScanning] = useState(false)
      const [related, setRelated] = useState({})
      const [draft, setDraft] = useState({ name: '', description: '' })
      const [showCreate, setShowCreate] = useState(false)

      const run = useCallback(async (path, payload, message) => {
        setBusy(true)
        setError(null)
        try {
          const data = await post(path, payload)
          if (message !== undefined) setNotice(message)
          return data
        } catch (failure) {
          setError(String(failure?.message ?? failure))
          return null
        } finally {
          setBusy(false)
        }
      }, [])

      if (lt === undefined) return h('div', { style: S.empty }, t.loading)
      if (lt.enabled !== true) return h(Banner, { tone: 'error' }, t.longTerm.disabled)

      const spaces = Array.isArray(lt.spaces) ? lt.spaces : []
      const current = spaces.find((space) => space.id === selected) ?? null
      const quality = lt.quality ?? {}
      const recallOn = lt.settings?.recall === true

      const browse = async (spaceId, keyword) => {
        setScanning(true)
        setError(null)
        try {
          const data = await post('/long-term/search', { spaceId, query: keyword ?? '', limit: 50 })
          setItems(Array.isArray(data.items) ? data.items : [])
        } catch (failure) {
          setError(String(failure?.message ?? failure))
          setItems([])
        } finally {
          setScanning(false)
        }
      }

      const select = (id) => {
        setSelected(id)
        setItems(null)
        setRelated({})
        setQuery('')
        void browse(id, '')
      }

      const loadRelated = async (item) => {
        if (current === null) return
        setRelated((previous) => ({ ...previous, [item.id]: { loading: true, items: [] } }))
        try {
          const data = await post('/long-term/related', { spaceId: current.id, id: item.id, depth: 1 })
          setRelated((previous) => ({ ...previous, [item.id]: { items: Array.isArray(data.results) ? data.results : [] } }))
        } catch (failure) {
          setRelated((previous) => ({ ...previous, [item.id]: { items: [], error: String(failure?.message ?? failure) } }))
        }
      }

      const dead = state.hot.memory.entries.filter((entry) => typeof entry.score === 'number' && entry.score <= 0)

      return h(
        'div',
        { style: S.root },
        error === null ? null : h(Banner, { tone: 'error' }, error),
        notice === null ? null : h(Banner, { tone: 'ok' }, notice),

        // Status
        h(
          Card,
          { title: t.longTerm.cli, hint: lt.dataDir },
          lt.cli?.found === true
            ? h(
                'div',
                { style: S.row },
                h('span', { style: S.badge }, t.longTerm.cliBundled),
                h('code', { style: S.mono }, lt.cli.path),
                lt.cli.version === '' ? null : h('span', { style: S.hint }, t.longTerm.cliVersion.replace('{version}', lt.cli.version)),
              )
            : h('div', { style: merge(S.banner, S.bannerError) }, t.longTerm.cliMissing),
          h(
            'div',
            { style: S.kv },
            h('span', { style: S.key }, t.longTerm.targetSpace),
            h('span', null, lt.settings?.targetSpace ?? '—'),
            h('span', { style: S.key }, t.longTerm.spaces),
            h('span', null, t.longTerm.spacesUnit.replace('{n}', String(spaces.length)).replace('{active}', String(spaces.filter((space) => space.active).length))),
            h('span', { style: S.key }, t.longTerm.archivedTotal),
            h('span', null, t.longTerm.archivedUnit.replace('{n}', String(lt.archive?.total ?? 0))),
            h('span', { style: S.key }, t.longTerm.lastArchive),
            h(
              'span',
              null,
              lt.archive?.last === null || lt.archive?.last === undefined
                ? t.longTerm.noArchive
                : `${String(lt.archive.last.ts ?? '').slice(0, 19).replace('T', ' ')} · ${lt.archive.last.ok ? t.longTerm.ok : t.longTerm.failed} · ${String(lt.archive.last.archived ?? 0)}`,
            ),
          ),
        ),

        // Recall policy
        h(
          Card,
          { title: t.longTerm.recall, hint: t.longTerm.recallHint },
          h(
            'div',
            { style: S.row },
            h(
              'button',
              {
                style: merge(S.button, recallOn ? S.buttonPrimary : undefined),
                disabled: busy,
                onClick: async () => {
                  const data = await run('/long-term/settings', { recall: true }, t.longTerm.recallOnNote)
                  if (data !== null) onChanged()
                },
              },
              t.longTerm.recallOn,
            ),
            h(
              'button',
              {
                style: merge(S.button, recallOn ? undefined : S.buttonPrimary),
                disabled: busy,
                onClick: async () => {
                  const data = await run('/long-term/settings', { recall: false }, t.longTerm.recallOffNote)
                  if (data !== null) onChanged()
                },
              },
              t.longTerm.recallOff,
            ),
            h('span', { style: S.hint }, recallOn ? t.longTerm.recallOnNote : t.longTerm.recallOffNote),
          ),
          h(
            'div',
            { style: S.hint },
            `${t.longTerm.quality}: ` + t.longTerm.qualityHint
              .replace('{low}', String(quality.lowScoreThreshold ?? 0.25))
              .replace('{high}', String(quality.highScoreThreshold ?? 0.6))
              .replace('{medium}', String(quality.maxMediumResults ?? 4))
              .replace('{unknown}', String(quality.maxUnknownResults ?? 2))
              .replace('{limit}', String(quality.limit ?? 6)),
          ),
        ),

        // Spaces
        h(
          Card,
          { title: `${t.longTerm.spaces} — ${t.longTerm.spacesUnit.replace('{n}', String(spaces.length)).replace('{active}', String(spaces.filter((space) => space.active).length))}` },
          spaces.length === 0
            ? h('div', { style: S.empty }, lt.cli?.found === true ? t.longTerm.noEntries : t.longTerm.cliMissing)
            : h(
                'div',
                null,
                spaces.map((space) =>
                  h(SpaceCard, {
                    key: space.id,
                    space: { ...space, providerRelated: space.providerRelated !== false },
                    selected: selected === space.id,
                    onSelect: select,
                    onToggle: async (id, active) => {
                      const data = await run('/long-term/space', { action: 'toggle', id, active }, undefined)
                      if (data === null) setError(t.longTerm.toggleFailed)
                      else onChanged()
                    },
                    onDelete: async (space) => {
                      const count = space.stats === null ? 0 : Number(space.stats.totalInsights ?? 0)
                      const confirmed = window.confirm(
                        t.longTerm.spaceDeleteConfirm
                          .replace('{name}', String(space.name ?? space.id))
                          .replace('{id}', String(space.id))
                          .replace('{n}', String(count)),
                      )
                      if (!confirmed) return
                      const data = await run('/long-term/space', { action: 'delete', id: space.id }, t.longTerm.spaceDeleted.replace('{id}', String(space.id)))
                      if (data === null) return
                      if (selected === space.id) {
                        setSelected(null)
                        setItems(null)
                        setRelated({})
                        setQuery('')
                      }
                      onChanged()
                    },
                    busy,
                    t,
                  }),
                ),
              ),
          h(
            'div',
            { style: S.row },
            h('button', { style: S.button, onClick: () => setShowCreate(!showCreate) }, t.longTerm.newSpace),
          ),
          showCreate
            ? h(
                'div',
                { style: merge(S.card, { background: 'transparent' }) },
                h('input', {
                  style: S.textInput,
                  placeholder: t.longTerm.newSpaceName,
                  value: draft.name,
                  onChange: (event) => setDraft({ ...draft, name: event.target.value }),
                }),
                h('textarea', {
                  style: S.input,
                  placeholder: t.longTerm.newSpaceDesc,
                  value: draft.description,
                  onChange: (event) => setDraft({ ...draft, description: event.target.value }),
                }),
                // A failed creation must not look like a dead button: the
                // reason is repeated here, beside the form that caused it.
                error === null ? null : h(Banner, { tone: 'error' }, error),
                h(
                  'div',
                  { style: S.entryActions },
                  h(
                    'button',
                    {
                      style: merge(S.button, S.buttonPrimary, busy || draft.name.trim() === '' ? S.buttonDisabled : undefined),
                      disabled: busy || draft.name.trim() === '',
                      onClick: async () => {
                        const data = await run('/long-term/space', { action: 'create', name: draft.name, description: draft.description }, undefined)
                        if (data !== null) {
                          setNotice(t.longTerm.created.replace('{id}', String(data.space?.id ?? '')))
                          setDraft({ name: '', description: '' })
                          setShowCreate(false)
                          onChanged()
                        }
                      },
                    },
                    busy ? t.longTerm.creating : t.longTerm.create,
                  ),
                ),
              )
            : null,
        ),

        // Contents
        h(
          Card,
          { title: t.longTerm.browse, hint: t.longTerm.browseHint },
          current === null
            ? h('div', { style: S.empty }, t.longTerm.selectSpace)
            : h(
                'div',
                null,
                h(
                  'div',
                  { style: S.row },
                  h('input', {
                    style: merge(S.scoreInput, { flex: '1 1 auto', width: 'auto' }),
                    placeholder: t.longTerm.search,
                    value: query,
                    onChange: (event) => setQuery(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') void browse(current.id, query)
                    },
                  }),
                  h('button', { style: S.button, disabled: scanning, onClick: () => void browse(current.id, query) }, scanning ? t.longTerm.searching : t.longTerm.search),
                ),
                items === null
                  ? h('div', { style: S.empty }, scanning ? t.longTerm.searching : t.longTerm.selectSpace)
                  : items.length === 0
                    ? h('div', { style: S.empty }, t.longTerm.noEntries)
                    : h(
                        'ul',
                        { style: S.list },
                        items.map((item) => h(MemoryItem, { key: item.id, item, t, onRelated: loadRelated, related: related[item.id] })),
                      ),
              ),
        ),

        // Archive now
        h(
          Card,
          { title: t.longTerm.archiveNow, hint: dead.length === 0 ? t.longTerm.archiveNowEmpty : t.longTerm.archiveNowHint.replace('{n}', String(dead.length)) },
          h(
            'div',
            { style: S.row },
            h(
              'button',
              {
                style: merge(S.button, S.buttonDanger),
                disabled: busy || dead.length === 0 || lt.cli?.found !== true,
                onClick: async () => {
                  const confirmed = window.confirm(t.longTerm.archiveNowConfirm.replace('{n}', String(dead.length)))
                  if (!confirmed) return
                  setBusy(true)
                  setError(null)
                  try {
                    const response = await fetch(`${API}/long-term/archive-now`, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: '{}',
                    })
                    const data = await response.json().catch(() => null)
                    if (!data) throw new Error(`archive-now → HTTP ${response.status}`)
                    if (data.ok !== true) throw new Error(String(data.message ?? data.error ?? 'archive failed'))
                    const extra = data.retained > 0 ? ` · ${t.longTerm.retainedNote.replace('{n}', String(data.retained))}` : ''
                    setNotice(`${t.longTerm.archived.replace('{n}', String(data.archived)).replace('{space}', String(data.targetSpace ?? ''))}${extra}`)
                    onChanged()
                  } catch (failure) {
                    setError(String(failure?.message ?? failure))
                  } finally {
                    setBusy(false)
                  }
                },
              },
              busy ? t.longTerm.archiving : t.longTerm.archiveNow,
            ),
          ),
        ),

        // Log
        h(
          Card,
          { title: t.longTerm.log },
          Array.isArray(lt.log) === false || lt.log.length === 0
            ? h('div', { style: S.empty }, t.longTerm.logEmpty)
            : h(
                'table',
                { style: S.table },
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    [t.longTerm.logTime, t.longTerm.logTrigger, t.longTerm.logResult, t.longTerm.logCount, t.longTerm.logTarget, t.longTerm.logSummary].map((label) =>
                      h('th', { key: label, style: S.th }, label),
                    ),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  lt.log.map((record, index) =>
                    h(
                      'tr',
                      { key: `${String(record.ts)}-${String(index)}` },
                      h('td', { style: S.td }, String(record.ts ?? '').slice(0, 19).replace('T', ' ')),
                      h('td', { style: S.td }, record.trigger === 'manual' ? t.longTerm.triggerManual : t.longTerm.triggerReview),
                      h('td', { style: merge(S.td, record.ok === true ? undefined : { color: 'var(--dsw-alias-state-error-primary)' }) }, record.ok === true ? t.longTerm.ok : t.longTerm.failed),
                      h('td', { style: S.td }, String(record.archived ?? 0)),
                      h('td', { style: S.td }, String(record.targetSpace ?? '—')),
                      h('td', { style: S.td }, record.error === null || record.error === undefined ? (Array.isArray(record.entries) ? record.entries.map((entry) => entry.text).join(' · ') : '') : String(record.error)),
                    ),
                  ),
                ),
              ),
        ),
      )
    }

    /**
     * Build the page component bound to one Client context.
     * @param {any} ctx client context.
     * @returns {Function} React component.
     */
    function makePage(ctx) {
      return function MemorySettingsPage() {
        const [tab, setTab] = useState('status')
        const [state, setState] = useState(null)
        const [error, setError] = useState(null)
        const [loading, setLoading] = useState(true)
        const [, bumpLocale] = useState(0)
        // A language picked in this page wins, then the plugin configuration,
        // then the surrounding app or browser.
        const [choice, setChoice] = useState(() => readStoredLang())
        const lang = choice !== '' ? choice : languageOf(ctx, state?.ui?.locale)
        const t = TEXT[lang] ?? TEXT.en

        const reload = useCallback(async () => {
          setLoading(true)
          try {
            const response = await fetch(`${API}/state`, { headers: { accept: 'application/json' } })
            const data = await response.json().catch(() => null)
            if (!data || data.ok !== true) throw new Error(data?.error ?? `${API}/state → HTTP ${response.status}`)
            setState(data)
            setError(null)
          } catch (failure) {
            setError(String(failure?.message ?? failure))
          } finally {
            setLoading(false)
          }
        }, [])

        useEffect(() => {
          void reload()
        }, [reload])

        useEffect(() => {
          let dispose
          try {
            dispose = ctx.locale?.subscribe?.(() => bumpLocale((value) => value + 1))
          } catch {
            dispose = undefined
          }
          return () => {
            if (typeof dispose === 'function') dispose()
          }
        }, [])

        const body =
          error !== null
            ? h(
                'div',
                { style: S.root },
                h(Banner, { tone: 'error' }, `${t.unavailable}: ${error}`),
                h('div', null, h('button', { style: S.button, onClick: () => void reload() }, t.retry)),
              )
            : state === null
              ? h('div', { style: S.empty }, t.loading)
              : tab === 'persona'
                ? h(PersonaTab, { state, t, onSaved: () => void reload() })
                : tab === 'hot'
                  ? h(HotTab, { state, t, onChanged: () => void reload() })
                  : tab === 'skills'
                    ? h(SkillsTab, { state, t, lang })
                    : tab === 'review'
                      ? h(ReviewTab, { state, t, lang, onSaved: () => void reload() })
                      : tab === 'longTerm'
                        ? h(LongTermTab, { state, t, onChanged: () => void reload() })
                        : tab === 'approval'
                          ? h(ApprovalTab, { t, onChanged: () => void reload() })
                          : h(StatusTab, { state, t })

        return h(
          'div',
          { style: S.root },
          h(
            'div',
            { style: S.header },
            h(
              'div',
              null,
              h('h3', { style: S.title }, t.title),
              h('p', { style: S.subtitle }, t.subtitle),
            ),
            h(
              'div',
              { style: S.row },
              h(
                'div',
                { style: S.row, gap: '2px' },
                ['zh', 'en'].map((key) =>
                  h(
                    'button',
                    {
                      key,
                      'aria-pressed': lang === key,
                      title: key === 'zh' ? TEXT.zh.title : TEXT.en.title,
                      style: merge(S.button, lang === key ? S.buttonPrimary : undefined),
                      onClick: () => {
                        storeLang(key)
                        setChoice(key)
                      },
                    },
                    key === 'zh' ? '中文' : 'EN',
                  ),
                ),
              ),
              h('button', { style: merge(S.button, loading ? S.buttonDisabled : undefined), disabled: loading, onClick: () => void reload() }, t.refresh),
            ),
          ),
          h(
            'div',
            { style: S.tabs, role: 'tablist' },
            ['status', 'persona', 'hot', 'skills', 'review', 'longTerm', 'approval'].map((key) =>
              h(
                'button',
                {
                  key,
                  role: 'tab',
                  'aria-selected': tab === key,
                  style: merge(S.tab, tab === key ? S.tabActive : undefined),
                  onClick: () => setTab(key),
                },
                t.tabs[key],
              ),
            ),
          ),
          body,
        )
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const Page = makePage(ctx)
        ctx.slots.inject(SLOT, () =>
          ctx.slots.register(
            {
              name: SLOT,
              id: PAGE_ID,
              order: 60,
              label: () => {
                const stored = readStoredLang()
                if (stored !== '') return stored === 'zh' ? TEXT.zh.title : TEXT.en.title
                return localeId(ctx).startsWith('zh') ? TEXT.zh.title : TEXT.en.title
              },
            },
            Page,
          ),
        )
      },
    }
  },
})
