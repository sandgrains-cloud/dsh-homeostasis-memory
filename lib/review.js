/**
 * Layer 6 — the background memory review.
 *
 * Two strategies, chosen implicitly by the review model:
 *
 * - **standard** (the review model is the main model): a `fork` child inherits
 *   the whole conversation and reviews it once. It is started by the closing
 *   tool (the user ended the session or asked for a review) or by the passive
 *   rule (≥ N turns since the last review and ≥ M idle minutes). The closing
 *   tool first re-scores `MEMORY.md` from the entries the main model reports as
 *   used, deletes entries at or below zero, and only then queues the review. A
 *   new user message aborts a running review, so the user's task always wins.
 * - **sync** (a different model is fixed): one persistent review agent per main
 *   session receives the main conversation one completed turn at a time. It
 *   keeps its own history and compacts it on its own, so no single request has
 *   to carry the whole session.
 *
 * Both strategies log to the same JSONL review log.
 *
 * @module dsh-homeostasis-memory/review
 */

import { appendBoundedLine, readTextFile, writeTextAtomic, withFileLock } from './store.js'
import { STANDARD_REVIEW_PROMPT, SYNC_REVIEW_PROMPT, SYNC_REVIEW_REMINDER } from './review-prompt.js'

/** Prefix of every session id this module owns. */
export const REVIEW_ID_PREFIX = 'memory-review-'

/**
 * Whether a session id belongs to a review session.
 * @param {string | undefined} id candidate session id.
 * @returns {boolean} true for this module's children.
 */
export function isReviewSessionId(id) {
  return typeof id === 'string' && id.startsWith(REVIEW_ID_PREFIX)
}

/** Largest single delivery to a sync reviewer; a longer turn is split, never truncated. */
const SYNC_DELIVERY_CHUNK_CHARS = 200_000

/**
 * Split rendered text on paragraph boundaries without dropping a character.
 * @param {string} text rendered transcript.
 * @param {number} limit chunk budget in characters.
 * @returns {string[]} chunks in order.
 */
function splitForDelivery(text, limit) {
  if (text.length <= limit) return [text]
  const chunks = []
  let rest = text
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit)
    if (cut < limit / 2) cut = rest.lastIndexOf('\n', limit)
    if (cut < limit / 2) cut = limit
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest !== '') chunks.push(rest)
  return chunks
}

/**
 * @typedef {object} ReviewBook
 * @property {number} userTurns direct user messages seen so far.
 * @property {number} lastReviewedTurn user-turn count at the last standard review.
 * @property {number} reviews completed or attempted reviews.
 * @property {object | undefined} active the in-flight standard review.
 * @property {boolean} pendingClosing the closing tool asked for a review.
 * @property {object | undefined} pendingScore scoring summary for the queued closing review.
 * @property {NodeJS.Timeout | undefined} idleTimer the armed passive trigger.
 * @property {string} strategy last resolved strategy.
 * @property {number | undefined} syncLastSeq last session seq delivered to the reviewer.
 * @property {boolean} syncFirstMessage the reviewer still needs its standing instructions.
 * @property {{agent: any, handle: any, reviewerId: string} | undefined} sync the persistent reviewer.
 * @property {Promise<void> | undefined} syncChain serializes sync deliveries.
 */

/**
 * @param {object} options dependencies.
 * @param {object} options.ctx plugin context.
 * @param {object} options.config review configuration.
 * @param {object} options.reviewSettings effective review settings store.
 * @param {(agentId: string | undefined) => boolean} options.isReviewAgent membership test for review children.
 * @param {(usedTexts: unknown) => Promise<object>} options.scoreMemories closing-review scoring step.
 * @param {(message: string, error?: unknown) => void} options.warn logger.
 * @param {(name: string) => any} options.service optional-service resolver.
 * @returns {object} review controller.
 */
export function createReview({ ctx, config, reviewSettings, isReviewAgent, scoreMemories, warn, service }) {
  /** @type {Map<string, ReviewBook>} main session id → bookkeeping. */
  const books = new Map()
  /** @type {Set<NodeJS.Timeout>} pending passive timers. */
  const timers = new Set()
  /** @type {Set<() => void>} registered listeners. */
  const disposers = []
  let disposed = false

  /** @type {{sessions: Record<string, any>} | undefined} persisted reviewer bookkeeping. */
  let reviewState

  /**
   * A session the user is talking to directly, never a delegated child.
   * @param {any} session session handle.
   * @returns {boolean} whether the session is a root conversation.
   */
  function isMainSession(session) {
    const header = session?.header
    if (!header) return false
    if (header.origin === 'subagent') return false
    if (header.parentSession) return false
    return true
  }

  /**
   * Count direct user messages in a session log.
   * @param {any} session session handle.
   * @returns {number} count of user-authored messages.
   */
  function countUserMessages(session) {
    try {
      const events = session?.ownEvents?.() ?? []
      let count = 0
      for (const event of events) {
        if (event?.type === 'user/message' && event?.data?.source?.kind === 'user') count += 1
      }
      return count
    } catch {
      return 0
    }
  }

  /**
   * Read the route the session's last request used.
   * @param {any} session session handle.
   * @returns {{provider: string, model: string} | undefined} the route.
   */
  function routeOf(session) {
    try {
      const events = session?.snapshotEvents?.() ?? []
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        if (event?.type === 'request/context') {
          const data = event.data
          if (typeof data?.provider === 'string' && typeof data?.model === 'string') {
            return { provider: data.provider, model: data.model }
          }
        }
        if (event?.type === 'request/header') {
          const config = event.data?.header?.config
          if (typeof config?.provider === 'string' && typeof config?.model === 'string') {
            return { provider: config.provider, model: config.model }
          }
        }
      }
    } catch {
      /* an unreadable log means "no opinion" */
    }
    return undefined
  }

  /**
   * Approximate the inherited input size, used only for the over-budget warning.
   * @param {any} agent parent agent.
   * @returns {number} text characters in the parent's log.
   */
  function measureInput(agent) {
    try {
      const events = agent?.session?.ownEvents?.() ?? []
      let total = 0
      for (const event of events) {
        const content = event?.data?.message?.content
        if (!Array.isArray(content)) continue
        for (const block of content) {
          if (block?.type === 'text') total += String(block.text ?? '').length
        }
      }
      return total
    } catch {
      return 0
    }
  }

  /**
   * Read the effective review settings.
   *
   * A broken settings file must not silently change behaviour, so a read
   * failure falls back to the static defaults and warns.
   * @returns {Promise<any>} effective settings.
   */
  async function readEffective() {
    try {
      return await reviewSettings.read()
    } catch (error) {
      warn('review settings could not be read; using the static defaults', error)
      return reviewSettings.fallback()
    }
  }

  /**
   * Resolve the strategy for one agent.
   * @param {any} agent main agent.
   * @param {any} settings effective review settings.
   * @returns {'standard' | 'sync'} the strategy.
   */
  function strategyOf(agent, settings) {
    if (settings?.model?.mode !== 'fixed') return 'standard'
    const route = routeOf(agent?.session)
    if (route === undefined) return 'sync'
    return route.provider === settings.model.provider && route.model === settings.model.model ? 'standard' : 'sync'
  }

  /**
   * Whether the closing tool should be offered to this agent right now.
   * @param {any} agent candidate agent.
   * @returns {Promise<boolean>} true for a main session using the standard strategy.
   */
  async function canOfferClosing(agent) {
    if (disposed || agent === undefined || !isMainSession(agent.session)) return false
    if (isReviewAgent(agent.id)) return false
    const settings = await readEffective()
    if (settings.enabled !== true) return false
    return strategyOf(agent, settings) === 'standard'
  }

  /**
   * Resolve the `agentOptions` to hand a review child.
   * @param {any} settings effective review settings.
   * @returns {{maxTokens: number, provider?: string, model?: string}} options.
   */
  function childOptions(settings) {
    const options = { maxTokens: config.maxTokens }
    const selected = settings?.model
    if (selected?.mode === 'fixed' && selected.provider !== '' && selected.model !== '') {
      options.provider = selected.provider
      options.model = selected.model
    }
    return options
  }

  /**
   * Turn one tool execution into a short action label.
   * @param {{name?: string, arguments?: any}} execution tool execution input.
   * @returns {string | undefined} label such as `memory:add`.
   */
  function describeAction(execution) {
    const name = String(execution?.name ?? '')
    const args = execution?.arguments
    if (name === 'memory') {
      const action = typeof args?.action === 'string' ? args.action : Array.isArray(args?.operations) ? 'batch' : '?'
      return `memory:${action}`
    }
    if (name === 'skill_manage') {
      const action = typeof args?.action === 'string' ? args.action : '?'
      return `skill:${action}`
    }
    return undefined
  }

  /**
   * Find the book whose standard review owns a child session.
   * @param {string | undefined} childId child session id.
   * @returns {{book: ReviewBook, active: any} | undefined} owner.
   */
  function ownerOfChild(childId) {
    if (childId === undefined) return undefined
    for (const book of books.values()) {
      if (book.active?.childId === childId) return { book, active: book.active }
    }
    return undefined
  }

  /**
   * Append one review record, keeping only the newest `config.logMaxEntries`
   * lines. Logging failures never reach the main turn.
   * @param {object} record record fields.
   * @returns {void}
   */
  function writeLog(record) {
    try {
      void appendBoundedLine(config.logPath, JSON.stringify(record), config.logMaxEntries).catch((error) => {
        warn('review log append failed', error)
      })
    } catch (error) {
      warn('review log append failed', error)
    }
  }

  /**
   * Drop old records from a log left behind by a previous version. Runs once per
   * activation, under the same lock the append uses.
   * @returns {Promise<void>} resolves once the file is within the limit.
   */
  async function trimLog() {
    const limit = Number.isFinite(config.logMaxEntries)
      ? Math.max(1, Math.trunc(config.logMaxEntries))
      : 5
    await withFileLock(config.logPath, async () => {
      const result = await readTextFile(config.logPath)
      if (!result.exists) return
      if (!result.readable) {
        warn(`review log is unreadable at ${config.logPath}; old records were not trimmed`)
        return
      }
      const lines = result.text.split('\n').filter((line) => line.trim() !== '')
      if (lines.length <= limit) return
      await writeTextAtomic(config.logPath, `${lines.slice(-limit).join('\n')}\n`)
    })
  }

  // ── persisted reviewer bookkeeping ──────────────────────────────────────
  /**
   * Load the reviewer state once.
   * @returns {Promise<{sessions: Record<string, any>}>} state.
   */
  async function ensureState() {
    if (reviewState !== undefined) return reviewState
    const result = await readTextFile(config.statePath)
    let parsed = {}
    if (result.exists && result.readable && result.text.trim() !== '') {
      try {
        const value = JSON.parse(result.text)
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          if (value.sessions !== null && typeof value.sessions === 'object' && !Array.isArray(value.sessions)) {
            parsed = value.sessions
          }
        }
      } catch (error) {
        warn('review state file is not valid JSON; starting empty', error)
      }
    }
    reviewState = { sessions: parsed }
    return reviewState
  }

  /**
   * Persist the reviewer state atomically.
   * @returns {Promise<void>} resolves once written.
   */
  async function saveState() {
    if (reviewState === undefined) return
    const entries = Object.entries(reviewState.sessions)
      .sort((a, b) => Number(b[1]?.updatedAt ?? 0) - Number(a[1]?.updatedAt ?? 0))
      .slice(0, 100)
    reviewState.sessions = Object.fromEntries(entries)
    const text = `${JSON.stringify({ version: 1, sessions: reviewState.sessions }, null, 2)}\n`
    await withFileLock(config.statePath, () => writeTextAtomic(config.statePath, text))
  }

  // ── standard strategy ──────────────────────────────────────────────────
  /**
   * Write the single terminal record for one standard review.
   * @param {ReviewBook} book owning book.
   * @param {any} active in-flight review.
   * @param {object} fields terminal fields.
   * @returns {void}
   */
  function finish(book, active, fields) {
    if (active.logged) return
    active.logged = true
    const inputChars = active.inputChars
    writeLog({
      ts: new Date().toISOString(),
      sessionId: active.sessionId,
      strategy: 'standard',
      trigger: active.trigger,
      triggerTurn: active.triggerTurn,
      provider: active.provider,
      model: active.model,
      durationMs: Date.now() - active.startedAt,
      inputChars,
      maxTokens: config.maxTokens,
      overBudget: typeof inputChars === 'number' && inputChars > config.maxInputChars,
      actions: active.actions.slice(0, 50),
      superseded: active.superseded === true,
      ...(active.scoring === undefined ? {} : { scoring: active.scoring }),
      ...fields,
    })
    if (book) book.active = undefined
  }

  /**
   * Abort the in-flight standard review for one session.
   * @param {string} sessionId main session id.
   * @param {string} reason why it is being superseded.
   * @returns {void}
   */
  function supersede(sessionId, reason) {
    const book = books.get(sessionId)
    const active = book?.active
    if (!book || !active || active.superseded) return
    active.superseded = true
    try {
      active.controller?.abort()
    } catch (error) {
      warn('review abort failed', error)
    }
    try {
      void active.activation?.dispose?.()?.catch?.(() => {})
    } catch {
      /* dispose is best effort */
    }
    finish(book, active, { result: 'superseded', reason })
  }

  /**
   * Start one standard (fork) review.
   * @param {any} agent parent agent.
   * @param {ReviewBook} book parent bookkeeping.
   * @param {'closing' | 'idle'} trigger why it runs.
   * @returns {Promise<void>} resolves when the review settles.
   */
  async function startStandard(agent, book, trigger) {
    const subagents = service('subagents')
    if (!subagents) {
      warn('review skipped: the subagents service is not mounted')
      return
    }

    const settings = await readEffective()
    const options = childOptions(settings)
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const childId = `${REVIEW_ID_PREFIX}${suffix}`
    const controller = new AbortController()
    const inputChars = measureInput(agent)
    const scoring = book.pendingScore
    book.pendingScore = undefined

    /** @type {any} */
    const active = {
      childId,
      controller,
      actions: [],
      startedAt: Date.now(),
      sessionId: agent.id,
      trigger,
      triggerTurn: book.userTurns,
      inputChars,
      provider: options.provider ?? 'inherit',
      model: options.model ?? 'inherit',
      superseded: false,
      logged: false,
      scoring,
    }
    book.active = active
    book.lastReviewedTurn = book.userTurns
    book.reviews += 1

    if (inputChars > config.maxInputChars) {
      warn(`review input is ${inputChars} characters, over the ${config.maxInputChars} warning threshold`)
    }

    try {
      const activation = await subagents.startActivation({
        provider: 'fork',
        childId,
        label: 'Memory review',
        delivery: 'caller',
        request: {
          prompt: [{ type: 'text', text: STANDARD_REVIEW_PROMPT }],
          parent: agent,
          agentOptions: options,
          maxDepth: 1,
        },
        signal: controller.signal,
      })
      active.activation = activation

      const result = await activation.result
      if (active.superseded) {
        finish(book, active, { result: 'superseded' })
        return
      }

      const output = Array.isArray(result?.output)
        ? result.output
            .filter((block) => block?.type === 'text')
            .map((block) => String(block.text ?? ''))
            .join('\n')
            .trim()
        : ''
      const nothing = /^nothing\s+to\s+save\.?$/i.test(output)
      finish(book, active, {
        result: nothing ? 'nothing-to-save' : active.actions.length > 0 ? 'acted' : 'no-action',
        stopReason: result?.stopReason ?? 'unknown',
        summary: output.length <= 400 ? output : `${output.slice(0, 400)}…`,
        ...(typeof result?.diagnostic === 'string' && result.diagnostic !== '' ? { diagnostic: result.diagnostic } : {}),
      })
    } catch (error) {
      if (active.superseded) {
        finish(book, active, { result: 'superseded' })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      warn(`memory review failed: ${message}`, error)
      finish(book, active, { result: 'error', error: message })
    } finally {
      if (book.active === active) book.active = undefined
      if (!active.logged) finish(book, active, { result: 'error', error: 'review ended without a record' })
    }
  }

  /**
   * Arm (or re-arm) the passive idle trigger for one session.
   * @param {string} sessionId main session id.
   * @returns {void}
   */
  function armIdle(sessionId) {
    clearIdle(sessionId)
    const minutes = Math.max(1, config.idleMinutes)
    const timer = setTimeout(() => {
      timers.delete(timer)
      const book = books.get(sessionId)
      if (book) book.idleTimer = undefined
      if (disposed) return
      void fireIdle(sessionId)
    }, minutes * 60_000)
    timers.add(timer)
    const book = books.get(sessionId)
    if (book) book.idleTimer = timer
  }

  /**
   * Cancel the passive idle trigger for one session.
   * @param {string} sessionId main session id.
   * @returns {void}
   */
  function clearIdle(sessionId) {
    const book = books.get(sessionId)
    const timer = book?.idleTimer
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(timer)
      book.idleTimer = undefined
    }
  }

  /**
   * Run the passive check and start a review when it still holds.
   * @param {string} sessionId main session id.
   * @returns {Promise<void>} resolves when handled.
   */
  async function fireIdle(sessionId) {
    const book = books.get(sessionId)
    if (book === undefined || book.active !== undefined) return
    if (book.userTurns - book.lastReviewedTurn < Math.max(1, config.intervalTurns)) return
    const settings = await readEffective()
    if (settings?.enabled !== true || settings?.passive !== true) return
    const agent = service('agents')?.get?.(sessionId)
    if (!agent) return
    if (strategyOf(agent, settings) !== 'standard') return
    book.pendingClosing = false
    book.pendingScore = undefined
    await startStandard(agent, book, 'idle')
  }

  /**
   * Decide what one completed turn triggers.
   * @param {any} session session handle.
   * @param {any} event the committed `turn/end` event.
   * @returns {void}
   */
  function onTurnEnd(session, event) {
    if (disposed) return
    if (event?.data?.reason?.kind !== 'completed') return
    const book = books.get(session.id)
    if (!book) return

    void readEffective().then((settings) => {
      if (disposed) return
      const agent = service('agents')?.get?.(session.id)
      if (!agent) return
      const strategy = strategyOf(agent, settings)
      book.strategy = strategy
      if (strategy === 'sync') {
        clearIdle(session.id)
        book.pendingClosing = false
        if (settings.enabled !== true) return
        void deliverSync(agent, book, settings)
        return
      }

      // standard strategy
      if (settings.enabled !== true) {
        clearIdle(session.id)
        book.pendingClosing = false
        book.pendingScore = undefined
        return
      }
      if (book.pendingClosing) {
        book.pendingClosing = false
        if (book.active !== undefined) {
          writeLog({
            ts: new Date().toISOString(),
            sessionId: session.id,
            strategy: 'standard',
            trigger: 'closing',
            triggerTurn: book.userTurns,
            result: 'busy',
          })
          return
        }
        void startStandard(agent, book, 'closing')
        return
      }
      if (settings.passive !== true) return
      if (book.active !== undefined) return
      if (book.reviews >= config.maxPerSession) return
      if (book.userTurns - book.lastReviewedTurn < Math.max(1, config.intervalTurns)) return
      armIdle(session.id)
    }).catch((error) => {
      warn('review scheduling failed', error)
    })
  }

  // ── sync strategy ──────────────────────────────────────────────────────
  /**
   * Render one text block from a message content array.
   * @param {unknown} content content blocks.
   * @returns {string} joined text.
   */
  function textOf(content) {
    if (!Array.isArray(content)) return ''
    return content
      .map((block) => {
        if (block?.type === 'text') return String(block.text ?? '')
        if (block?.type === 'image') return '[图片]'
        return ''
      })
      .filter((text) => text.trim() !== '')
      .join('\n')
  }

  /**
   * Render a range of session events as reviewable text.
   *
   * Reasoning is deliberately omitted: it is the main model's internal process
   * and not something a memory or skill entry should be derived from. Nothing is
   * truncated — a long tool result is passed through in full.
   * @param {readonly any[]} events session events.
   * @returns {string} rendered transcript.
   */
  function renderEvents(events) {
    const parts = []
    for (const event of events) {
      switch (event?.type) {
        case 'turn/start': {
          const turn = event?.data?.turn
          if (typeof turn === 'number') parts.push(`== 主会话第 ${turn} 轮 ==`)
          break
        }
        case 'user/message': {
          const kind = event?.data?.source?.kind
          if (kind !== 'user' && kind !== 'compact-checkpoint') break
          const text = textOf(event?.data?.content)
          if (text === '') break
          parts.push(`${kind === 'compact-checkpoint' ? '[会话压缩摘要]' : '[用户]'} ${text}`)
          break
        }
        case 'assistant/message': {
          const content = event?.data?.message?.content
          if (!Array.isArray(content)) break
          for (const block of content) {
            if (block?.type === 'text' && String(block.text ?? '').trim() !== '') {
              parts.push(`[模型] ${block.text}`)
            } else if (block?.type === 'tool-call') {
              parts.push(`[工具调用] ${String(block.name ?? '')}\n${String(block.arguments ?? '')}`)
            }
          }
          break
        }
        case 'tool/result': {
          const text = textOf(event?.data?.message?.content)
          const failed = event?.data?.message?.isError === true || event?.data?.error !== undefined
          parts.push(`[工具结果${failed ? '（失败）' : ''}] ${text}`)
          break
        }
        default:
          break
      }
    }
    return parts.join('\n\n')
  }

  /**
   * Build the durable user message handed to the review agent.
   * @param {string} text rendered content.
   * @param {string} mainSessionId main session id.
   * @returns {object} user message.
   */
  function reviewMessage(text, mainSessionId) {
    return {
      role: 'user',
      id: `${REVIEW_ID_PREFIX}msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      source: { kind: 'agent-message', form: 'relay', senderSessionId: mainSessionId },
      content: [{ type: 'text', text }],
    }
  }

  /**
   * The seq where the session's latest turn begins. A newly created reviewer
   * starts from the current turn: a session that switches strategies mid-flight
   * would otherwise force one enormous first prefill, and the earlier turns are
   * already reflected in what the user asked for at the switch point.
   * @param {any} session main session.
   * @returns {number} start seq of the newest turn.
   */
  function currentTurnStart(session) {
    try {
      const events = session?.snapshotEvents?.() ?? []
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index]?.type === 'turn/start') return index
      }
    } catch {
      /* fall back to the whole log */
    }
    return 0
  }

  /**
   * Make sure one main session has a live review agent.
   * @param {any} agent main agent.
   * @param {ReviewBook} book its bookkeeping.
   * @param {any} settings effective settings.
   * @returns {Promise<any | undefined>} the review agent.
   */
  async function ensureReviewer(agent, book, settings) {
    const agents = service('agents')
    if (!agents) {
      warn('sync review skipped: the agents service is not mounted')
      return undefined
    }
    const route = { provider: settings.model.provider, model: settings.model.model }
    const header = agent.session?.header ?? {}
    const presets = service('agentPresets')
    const presetId = presets?.composedPreset?.(agent.ctx)
      ?? (typeof header.agentPreset === 'string' && header.agentPreset !== '' ? header.agentPreset : 'standard')

    /**
     * Compose the review session exactly like any other child: mount the
     * session's agent preset (which brings compaction, the tool-result pruner,
     * and the preset prompt sections) and then narrow its tools.
     * @param {any} agentCtx the review agent's scoped creation context.
     * @returns {Promise<void>} resolves once the composition is in place.
     */
    const compose = async (agentCtx) => {
      if (presets !== undefined) {
        try {
          await presets.mount(agentCtx, presetId)
        } catch (error) {
          warn('could not mount the agent preset on the review session', error)
        }
      }
      try {
        agentCtx.get?.('tools')?.restrict?.({ allow: ['memory', 'skill_manage'] })
      } catch (error) {
        warn('could not narrow the review session tool scope', error)
      }
    }

    const cached = book.sync
    if (cached !== undefined && agents.get?.(cached.reviewerId) === cached.agent) return cached.agent

    const state = await ensureState()
    const entry = state.sessions[agent.id]
    if (entry !== undefined && entry.provider === route.provider && entry.model === route.model) {
      try {
        const handle = await agents.resume({ resumeSessionId: entry.reviewerId, parentAgent: agent, agentOptions: route, setup: compose })
        book.sync = { agent: handle.agent, handle, reviewerId: entry.reviewerId }
        book.syncFirstMessage = false
        if (typeof entry.lastSeq === 'number') book.syncLastSeq = entry.lastSeq
        return handle.agent
      } catch (error) {
        warn('could not resume the sync review agent; starting a new one', error)
      }
    }

    const reviewerId = `${REVIEW_ID_PREFIX}sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    try {
      const handle = await agents.create({
        sessionId: reviewerId,
        parentAgent: agent,
        meta: {
          ...(typeof header.cwd === 'string' && header.cwd !== '' ? { cwd: header.cwd } : {}),
          parentSession: agent.id,
          origin: 'subagent',
          ...(typeof header.agentPreset === 'string' && header.agentPreset !== '' ? { agentPreset: header.agentPreset } : {}),
        },
        agentOptions: route,
        setup: compose,
      })
      book.sync = { agent: handle.agent, handle, reviewerId }
      book.syncFirstMessage = true
      state.sessions[agent.id] = {
        reviewerId,
        lastSeq: typeof book.syncLastSeq === 'number' ? book.syncLastSeq : 0,
        provider: route.provider,
        model: route.model,
        updatedAt: Date.now(),
      }
      void saveState().catch((error) => warn('could not persist the sync review state', error))
      return handle.agent
    } catch (error) {
      warn('could not create the sync review agent', error)
      return undefined
    }
  }

  /**
   * Deliver one completed turn's content to the persistent review agent.
   * @param {any} agent main agent.
   * @param {ReviewBook} book its bookkeeping.
   * @param {any} settings effective settings.
   * @returns {Promise<void>} resolves when delivered or skipped.
   */
  async function deliverSync(agent, book, settings) {
    const previous = book.syncChain ?? Promise.resolve()
    const run = previous.then(() => deliverSyncNow(agent, book, settings), () => deliverSyncNow(agent, book, settings))
    book.syncChain = run.then(() => undefined, () => undefined)
    await run
  }

  /**
   * The serialized body of one sync delivery.
   * @param {any} agent main agent.
   * @param {ReviewBook} book its bookkeeping.
   * @param {any} settings effective settings.
   * @returns {Promise<void>} resolves when handled.
   */
  async function deliverSyncNow(agent, book, settings) {
    if (disposed) return
    const session = agent.session
    if (typeof book.syncLastSeq !== 'number') book.syncLastSeq = currentTurnStart(session)
    const from = book.syncLastSeq
    let events
    try {
      events = session.snapshotEvents(from, session.seq)
    } catch (error) {
      warn('could not read the session log for the sync review', error)
      return
    }
    const rendered = renderEvents(events)
    if (rendered.trim() === '') return

    const reviewer = await ensureReviewer(agent, book, settings)
    if (reviewer === undefined) return

    const first = book.syncFirstMessage === true
    const text = first
      ? `${SYNC_REVIEW_PROMPT}\n\n=== 主会话记录（截至现在） ===\n\n${rendered}`
      : `${SYNC_REVIEW_REMINDER}\n\n=== 新增内容 ===\n\n${rendered}`

    const startedAt = Date.now()
    const chunks = splitForDelivery(text, SYNC_DELIVERY_CHUNK_CHARS)
    try {
      for (const chunk of chunks) reviewer.followup(reviewMessage(chunk, agent.id))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warn(`sync review delivery failed: ${message}`, error)
      writeLog({
        ts: new Date().toISOString(),
        sessionId: agent.id,
        strategy: 'sync',
        trigger: 'turn',
        triggerTurn: book.userTurns,
        provider: settings.model.provider,
        model: settings.model.model,
        chars: rendered.length,
        result: 'error',
        error: message,
      })
      return
    }

    book.syncLastSeq = session.seq
    book.syncFirstMessage = false
    book.reviews += 1
    book.lastReviewedTurn = book.userTurns
    const state = await ensureState()
    state.sessions[agent.id] = {
      reviewerId: book.sync?.reviewerId ?? state.sessions[agent.id]?.reviewerId ?? '',
      lastSeq: session.seq,
      provider: settings.model.provider,
      model: settings.model.model,
      updatedAt: Date.now(),
    }
    void saveState().catch((error) => warn('could not persist the sync review state', error))

    writeLog({
      ts: new Date().toISOString(),
      sessionId: agent.id,
      strategy: 'sync',
      trigger: 'turn',
      triggerTurn: book.userTurns,
      provider: settings.model.provider,
      model: settings.model.model,
      reviewerId: book.sync?.reviewerId,
      chars: rendered.length,
      durationMs: Date.now() - startedAt,
      result: 'delivered',
    })
  }

  // ── tool entry point ───────────────────────────────────────────────────
  /**
   * Handle one `review_memory` request.
   *
   * Scoring is part of the request: the main model lists the `MEMORY.md`
   * entries it actually used, every used entry gains one point, every other
   * entry loses one, and entries at or below zero are deleted before the review
   * is queued.
   * @param {any} agent calling agent.
   * @param {object} args tool arguments.
   * @returns {Promise<object>} tool receipt.
   */
  async function requestClosing(agent, args) {
    if (agent === undefined || !isMainSession(agent.session)) {
      return { success: false, error: 'unavailable', message: 'a memory review can only be requested by the main session' }
    }
    const book = books.get(agent.id)
    if (book === undefined) {
      return { success: false, error: 'unavailable', message: 'this session has no review bookkeeping' }
    }
    const settings = await readEffective()
    if (settings.enabled !== true) {
      return { success: false, error: 'review-disabled', message: 'the memory review is switched off' }
    }
    if (strategyOf(agent, settings) !== 'standard') {
      return {
        success: false,
        error: 'synchronous-review',
        message: 'this session reviews every completed turn with the configured review model; no closing review is needed',
      }
    }
    if (book.active !== undefined) {
      return { success: false, error: 'review-running', message: 'a review is already running for this session' }
    }
    if (book.pendingClosing) {
      return {
        success: true,
        scheduled: true,
        already_scheduled: true,
        message: 'a memory review is already scheduled for the end of this turn; answer the user normally',
      }
    }

    const used = Array.isArray(args?.used_memory) ? args.used_memory : []
    let scoring
    try {
      scoring = await scoreMemories(used)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warn(`memory scoring failed: ${message}`, error)
      return { success: false, error: 'score-failed', message: `memory was not scored: ${message}` }
    }
    if (scoring?.success !== true) {
      return {
        success: false,
        error: scoring?.error ?? 'score-failed',
        message: scoring?.message ?? 'memory was not scored; the review was not scheduled',
      }
    }

    book.pendingScore = scoring
    book.pendingClosing = true
    return {
      success: true,
      scheduled: true,
      scored: {
        entries: scoring.before,
        used: scoring.used,
        unused: scoring.unused,
        removed: scoring.removed_count,
        removed_entries: scoring.removed,
        unmatched: scoring.unmatched,
      },
      message: 'memory was scored and the review will run right after this turn ends; answer the user normally in this turn',
    }
  }

  // ── lifecycle ──────────────────────────────────────────────────────────
  /**
   * Handle an `agent/created` notification.
   * @param {any} agent the created agent.
   * @returns {void}
   */
  function onAgentCreated(agent) {
    if (!isMainSession(agent?.session)) return
    if (isReviewAgent(agent.id)) return
    const existing = countUserMessages(agent.session)
    const interval = Math.max(1, config.intervalTurns)
    books.set(agent.id, {
      userTurns: existing,
      lastReviewedTurn: Math.floor(existing / interval) * interval,
      reviews: 0,
      active: undefined,
      pendingClosing: false,
      pendingScore: undefined,
      idleTimer: undefined,
      strategy: 'standard',
      syncLastSeq: undefined,
      syncFirstMessage: false,
      sync: undefined,
      syncChain: undefined,
    })
  }

  /**
   * Handle an `agent/disposed` notification.
   * @param {any} agent the disposed agent.
   * @returns {void}
   */
  function onAgentDisposed(agent) {
    const id = agent?.id
    if (id === undefined) return
    const book = books.get(id)
    clearIdle(id)
    supersede(id, 'agent-disposed')
    books.delete(id)
    if (book?.sync !== undefined) {
      try {
        void book.sync.handle?.dispose?.()?.catch?.(() => {})
      } catch {
        /* best effort */
      }
    }
  }

  /**
   * Register every listener this module owns.
   * @returns {void}
   */
  function attach() {
    void trimLog().catch((error) => warn('review log trim failed', error))
    disposers.push(
      ctx.on('session/event', (session, event) => {
        if (disposed || !isMainSession(session)) return
        if (event?.type === 'user/message' && event?.data?.source?.kind === 'user') {
          const book = books.get(session.id)
          if (book) book.userTurns += 1
          clearIdle(session.id)
          // The user's task wins: a running review yields immediately.
          supersede(session.id, 'new-user-turn')
          return
        }
        if (event?.type === 'turn/end') onTurnEnd(session, event)
      }),
    )

    disposers.push(
      ctx.on('tools/result', (execution, result) => {
        if (disposed) return
        if (result?.isError === true) return
        const owner = ownerOfChild(execution?.agent?.id)
        if (!owner) return
        const action = describeAction(execution)
        if (action === undefined) return
        if (owner.active.actions[owner.active.actions.length - 1] !== action) owner.active.actions.push(action)
      }),
    )
  }

  /**
   * Release every timer, listener, and running review.
   * @returns {void}
   */
  function dispose() {
    disposed = true
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    for (const [sessionId, book] of books) {
      supersede(sessionId, 'plugin-unloaded')
      try {
        void book.sync?.handle?.dispose?.()?.catch?.(() => {})
      } catch {
        /* best effort */
      }
    }
    for (const disposer of disposers.splice(0)) {
      try {
        disposer()
      } catch {
        /* a failing disposer must not block the others */
      }
    }
    books.clear()
  }

  return {
    attach,
    dispose,
    onAgentCreated,
    onAgentDisposed,
    canOfferClosing,
    requestClosing,
  }
}
