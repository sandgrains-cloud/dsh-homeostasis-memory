/**
 * The settings page's Host half.
 *
 * The Client cannot read `$DSH_HOME`, so this module exposes one JSON endpoint
 * that the page calls with ordinary `fetch`. Every write still goes through the
 * same modules the tools use, so validation, scanning, budgets, atomic writes,
 * and locks behave identically whether the change came from the agent or from
 * this page.
 *
 * Route: `<prefix>/state` (GET), `<prefix>/persona|memory/add|memory/replace|memory/remove|memory/score` (POST).
 *
 * @module dsh-homeostasis-memory/ui
 */

import { readTextFile } from './store.js'

const API_PREFIX = '/dsh-homeostasis-memory/api'
const REVIEW_LOG_TAIL = 3

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res response.
 * @param {number} status HTTP status.
 * @param {unknown} payload JSON-serializable body.
 * @returns {void}
 */
function send(res, status, payload) {
  if (res.writableEnded) return
  const text = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(text)
}

/**
 * Read and parse a JSON request body.
 * @param {import('node:http').IncomingMessage} req request.
 * @param {number} limit maximum accepted characters.
 * @returns {Promise<{ok: true, value: Record<string, unknown>} | {ok: false, error: string}>} parsed body.
 */
function readJsonBody(req, limit = 1_000_000) {
  return new Promise((resolve) => {
    let raw = ''
    let rejected = false
    req.on('data', (chunk) => {
      if (rejected) return
      raw += chunk
      if (raw.length > limit) {
        rejected = true
        resolve({ ok: false, error: 'request body is too large' })
      }
    })
    req.on('end', () => {
      if (rejected) return
      if (raw.trim() === '') return resolve({ ok: true, value: {} })
      try {
        const value = JSON.parse(raw)
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          return resolve({ ok: false, error: 'request body must be a JSON object' })
        }
        resolve({ ok: true, value })
      } catch {
        resolve({ ok: false, error: 'request body is not valid JSON' })
      }
    })
    req.on('error', () => resolve({ ok: false, error: 'request body could not be read' }))
  })
}

/**
 * Read the newest review-log entries.
 * @param {string} file absolute log path.
 * @returns {Promise<object[]>} newest-first parsed records, best effort.
 */
async function readReviewLog(file) {
  const read = await readTextFile(file)
  if (!read.readable || read.text.trim() === '') return []
  const lines = read.text.trim().split('\n')
  const tail = lines.slice(Math.max(0, lines.length - REVIEW_LOG_TAIL))
  const records = []
  for (const line of tail) {
    try {
      const record = JSON.parse(line)
      if (record !== null && typeof record === 'object') records.push(record)
    } catch {
      /* one corrupt line must not hide the rest */
    }
  }
  return records.reverse()
}

/**
 * @param {object} options dependencies.
 * @param {object} options.settings resolved plugin configuration.
 * @param {object} options.persona persona module.
 * @param {object} options.hotMemory hot-memory module.
 * @param {object} options.skills skills module.
 * @param {object} options.reviewSettings effective review settings store.
 * @param {object} options.longTerm long-term memory controller.
 * @param {(message: string, error?: unknown) => void} options.warn logger.
 * @param {(name: string) => any} options.service optional-service resolver.
 * @param {() => void} [options.onReviewSettingsChanged] called after the page saves review settings.
 * @returns {object} settings-page controller.
 */
export function createMemoryUi({ settings, persona, hotMemory, skills, reviewSettings, longTerm, warn, service, onReviewSettingsChanged, onLongTermChanged }) {
  /**
   * Everything the page renders in one response.
   * @returns {Promise<object>} page state.
   */
  async function collectState() {
    const [soul, user, memory, inventory] = await Promise.all([
      persona.read(),
      hotMemory.load('user'),
      hotMemory.load('memory'),
      skills.inventory(),
    ])

    return {
      ok: true,
      home: settings.home,
      ui: { locale: settings.ui.locale },
      persona: {
        path: settings.persona.path,
        bytes: soul.bytes,
        maxBytes: settings.persona.maxBytes,
        revision: soul.revision,
        exists: soul.exists,
        readable: soul.readable,
        requireApproval: settings.persona.requireApproval,
        text: soul.text,
      },
      hot: {
        user: {
          path: hotMemory.files.user,
          limit: hotMemory.limits.user,
          used: user.used,
          entries: user.entries,
          readable: user.readable,
          drift: user.drift ?? null,
        },
        memory: {
          path: hotMemory.files.memory,
          limit: null,
          used: memory.used,
          entries: memory.entries,
          readable: memory.readable,
          drift: null,
        },
      },
      skills: inventory,
      review: {
        settings: await reviewSettings.read(),
        config: {
          intervalTurns: settings.review.intervalTurns,
          idleMinutes: settings.review.idleMinutes,
          maxPerSession: settings.review.maxPerSession,
          maxTokens: settings.review.maxTokens,
          maxInputChars: settings.review.maxInputChars,
          modelMode: settings.review.model.mode,
          provider: settings.review.model.provider,
          model: settings.review.model.model,
          logPath: settings.review.logPath,
          logMaxEntries: settings.review.logMaxEntries,
          settingsPath: reviewSettings.file,
          statePath: settings.review.statePath,
        },
        recent: await readReviewLog(settings.review.logPath),
      },
      longTerm: await collectLongTerm(),
    }
  }

  /**
   * Everything the long-term tab renders in one response.
   *
   * A space whose statistics cannot be read does not fail the whole response:
   * the tab still lists it with `healthy: false` and the reason, because a
   * page that shows nothing is worse than one that shows what broke.
   *
   * @returns {Promise<object>} long-term state.
   */
  async function collectLongTerm() {
    const enabled = settings.longTerm.enabled === true
    const base = {
      ok: true,
      enabled,
      dataDir: settings.longTerm.dataDir,
      diagnostics: settings.longTerm.diagnostics,
    }
    if (!enabled) return { ...base, cli: { found: false, path: '', version: '' }, spaces: [], settings: { recall: false }, quality: settings.longTerm.recallQuality, archive: { total: 0, last: null }, log: [] }

    try {
      const [cli, catalog, effective, log] = await Promise.all([
        longTerm.cliStatus(),
        longTerm.listSpaces(),
        longTerm.readSettings(),
        longTerm.readLog(),
      ])
      const total = catalog.spaces.reduce((sum, space) => sum + (typeof space.stats?.totalInsights === 'number' ? space.stats.totalInsights : 0), 0)
      return {
        ...base,
        ok: catalog.ok !== false,
        error: catalog.error ?? null,
        registryPath: longTerm.registryPath,
        settingsFile: longTerm.settingsFile,
        cli,
        spaces: catalog.spaces,
        settings: { recall: effective.recall === true, targetSpace: effective.targetSpace, createTargetSpace: effective.createTargetSpace !== false },
        quality: effective.recallQuality,
        archive: { total, last: log[0] ?? null },
        // `readLog` already returns at most `longTerm.logMaxEntries` (3 by
        // default), newest first, so the page and the file agree by construction.
        log,
      }
    } catch (error) {
      warn('could not collect long-term memory state', error)
      return {
        ...base,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        cli: { found: false, path: '', version: '' },
        spaces: [],
        settings: { recall: false },
        quality: settings.longTerm.recallQuality,
        archive: { total: 0, last: null },
        log: [],
      }
    }
  }

  /**
   * Archive the dead `MEMORY.md` entries on request.
   *
   * Shared by the page button and the archive-now endpoint so both report the
   * same receipt; a review uses the same controller method through its hook.
   *
   * @returns {Promise<object>} receipt plus the live long-term state.
   */
  async function archiveDeadNow() {
    const memory = await hotMemory.load('memory')
    const dead = memory.entries.filter((entry) => typeof entry.score === 'number' && entry.score <= 0)
    if (dead.length === 0) {
      return {
        ok: true,
        archived: 0,
        retained: 0,
        candidates: 0,
        ids: [],
        targetSpace: longTerm.getSettings().targetSpace,
        error: null,
        longTerm: await collectLongTerm(),
      }
    }
    const receipt = await longTerm.archive(dead.map((entry) => ({ text: entry.text, score: entry.score })), { trigger: 'manual' })
    if (receipt.ok !== true) {
      return { ...receipt, candidates: dead.length, longTerm: await collectLongTerm() }
    }
    // The archive confirmed these entries, so they may leave MEMORY.md now; the
    // ones it refused stay where they are.
    const refused = new Set(Array.isArray(receipt.retain) ? receipt.retain : [])
    const removal = await hotMemory.removeArchived(receipt.ids.length === 0 ? [] : dead.map((entry) => entry.text), refused)
    return {
      ...receipt,
      candidates: dead.length,
      removed: removal.success === true ? removal.removed : 0,
      removal_error: removal.success === true ? null : (removal.message ?? removal.error ?? 'unknown'),
      longTerm: await collectLongTerm(),
    }
  }

  /** @type {{at: number, value: any} | undefined} short-lived model catalog cache. */
  let modelCache

  /**
   * Enumerate the provider/model routes the registry can currently serve, for
   * the review model picker. Cached briefly; a provider that fails to answer is
   * skipped rather than failing the whole list.
   * @returns {Promise<object>} `{ ok, providers, models, cached }`.
   */
  async function listAvailableModels() {
    const now = Date.now()
    if (modelCache !== undefined && now - modelCache.at < 60_000) {
      return { ok: true, cached: true, ...modelCache.value }
    }

    const llm = service('llm')
    if (!llm || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
      return { ok: true, cached: false, providers: [], models: [], error: 'the llm service is not available' }
    }

    let providers = []
    try {
      providers = llm.listProviders() ?? []
    } catch (error) {
      warn('could not list llm providers', error)
      return { ok: true, cached: false, providers: [], models: [], error: 'could not list providers' }
    }

    const models = []
    const seen = new Set()
    for (const provider of providers) {
      const id = typeof provider === 'string' ? provider : provider?.id
      if (typeof id !== 'string' || id === '') continue
      try {
        const list = await llm.listModels(id)
        for (const model of list ?? []) {
          const modelId = String(model?.id ?? '')
          if (modelId === '') continue
          const key = `${id}\u0000${modelId}`
          if (seen.has(key)) continue
          seen.add(key)
          models.push({
            provider: id,
            id: modelId,
            name: typeof model?.name === 'string' && model.name !== '' ? model.name : modelId,
          })
        }
      } catch (error) {
        warn(`could not list models for provider "${id}"`, error)
      }
    }

    const value = {
      providers: providers
        .map((provider) => (typeof provider === 'string' ? { id: provider, name: provider } : { id: String(provider?.id ?? ''), name: String(provider?.name ?? provider?.id ?? '') }))
        .filter((provider) => provider.id !== ''),
      models,
    }
    modelCache = { at: now, value }
    return { ok: true, cached: false, ...value }
  }

  /**
   * Report the approval policy each live session currently carries.
   *
   * `approval.overrideOf(session)` returns the last policy the session recorded;
   * `undefined` means "no explicit policy", i.e. the composition default applies.
   * @returns {object} `{ ok, available, policy, sessions }`.
   */
  function collectApproval() {
    const agents = service('agents')
    const approval = service('approval')
    if (!agents || typeof agents.list !== 'function' || !approval || typeof approval.setPolicy !== 'function') {
      return { ok: true, available: false, sessions: [], error: 'the approval or agents service is not available' }
    }

    let live = []
    try {
      live = agents.list()
    } catch (error) {
      warn('could not list live agents for the approval view', error)
      return { ok: true, available: false, sessions: [], error: 'could not list live agents' }
    }

    const sessions = live.map((agent) => {
      let policy = null
      try {
        policy = approval.overrideOf(agent.session) ?? null
      } catch {
        policy = null
      }
      return { id: agent.id, policy }
    })

    return { ok: true, available: true, sessions }
  }

  /**
   * Switch the approval policy of every live session.
   *
   * This changes only the approval knob, never the sandbox mode, so a session
   * that was on a bundled preset becomes "custom" — that is the intended
   * trade-off, and the page says so. New sessions keep the permission preset.
   * @param {unknown} policy `ask` or `never`.
   * @returns {object} receipt.
   */
  function applyApprovalPolicy(policy) {
    if (policy !== 'ask' && policy !== 'never') {
      return { success: false, error: 'invalid', message: 'policy must be "ask" or "never"' }
    }

    const agents = service('agents')
    const approval = service('approval')
    if (!agents || typeof agents.list !== 'function' || !approval || typeof approval.setPolicy !== 'function') {
      return { success: false, error: 'unavailable', message: 'the approval or agents service is not available' }
    }

    const applied = []
    const failed = []
    for (const agent of agents.list()) {
      try {
        approval.setPolicy(agent, policy)
        applied.push(agent.id)
      } catch (error) {
        failed.push({ id: agent.id, error: error instanceof Error ? error.message : String(error) })
      }
    }

    return {
      success: true,
      done: true,
      policy,
      applied: applied.length,
      failed,
      note: 'applies to live sessions only; new sessions still use the permission preset, and this does not change the sandbox mode',
    }
  }

  /**
   * Handle one request under the prefix.
   * @param {import('node:http').IncomingMessage} req request.
   * @param {import('node:http').ServerResponse} res response.
   * @returns {Promise<void>} resolves when the response is written.
   */
  async function handler(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname.startsWith(API_PREFIX)
        ? url.pathname.slice(API_PREFIX.length) || '/'
        : '/'

      if (req.method === 'GET' && path === '/state') {
        send(res, 200, await collectState())
        return
      }
      if (req.method === 'GET' && path === '/review-models') {
        send(res, 200, await listAvailableModels())
        return
      }
      if (req.method === 'GET' && path === '/approval') {
        send(res, 200, collectApproval())
        return
      }
      if (req.method !== 'POST') {
        send(res, 404, { ok: false, error: `not found: ${req.method} ${path}` })
        return
      }

      const parsed = await readJsonBody(req)
      if (!parsed.ok) {
        send(res, 400, { ok: false, error: parsed.error })
        return
      }
      const body = parsed.value

      if (path === '/approval-policy') {
        const result = applyApprovalPolicy(body.policy)
        send(res, result.success ? 200 : 400, result)
        return
      }

      if (path === '/review-settings') {
        try {
          const next = await reviewSettings.write(body)
          try {
            onReviewSettingsChanged?.()
          } catch (error) {
            warn('review settings changed but the strategy refresh failed', error)
          }
          send(res, 200, { success: true, done: true, settings: next })
        } catch (error) {
          send(res, 400, {
            success: false,
            error: 'invalid',
            message: error instanceof Error ? error.message : String(error),
          })
        }
        return
      }

      // ── long-term memory ──────────────────────────────────────────────
      if (path === '/long-term/settings') {
        try {
          const next = await longTerm.writeSettings(body)
          onLongTermChanged?.()
          send(res, 200, { ok: true, settings: { recall: next.recall, targetSpace: next.targetSpace, createTargetSpace: next.createTargetSpace } })
        } catch (error) {
          send(res, 400, { ok: false, error: 'invalid', message: error instanceof Error ? error.message : String(error) })
        }
        return
      }

      if (path === '/long-term/space') {
        const action = String(body.action ?? '')
        let result
        if (action === 'create') {
          result = await longTerm.createSpace({
            id: String(body.id ?? '').trim(),
            name: body.name,
            description: body.description,
          })
        } else if (action === 'toggle') {
          result = await longTerm.toggleSpace(String(body.id ?? '').trim(), body.active === true)
        } else if (action === 'delete') {
          result = await longTerm.deleteSpace(String(body.id ?? '').trim())
        } else {
          result = { ok: false, error: 'invalid-action', message: 'action must be "create", "toggle" or "delete"' }
        }
        if (result.ok) onLongTermChanged?.()
        const state = await collectLongTerm()
        send(res, result.ok ? 200 : 400, { ...result, longTerm: state })
        return
      }

      if (path === '/long-term/search') {
        const result = await longTerm.search({
          spaceId: String(body.spaceId ?? '').trim(),
          query: body.query,
          limit: body.limit,
        })
        send(res, result.ok ? 200 : 400, result)
        return
      }

      if (path === '/long-term/related') {
        const result = await longTerm.related({
          id: String(body.id ?? '').trim(),
          spaceId: typeof body.spaceId === 'string' ? body.spaceId : undefined,
          depth: body.depth,
          edge: typeof body.edge === 'string' && body.edge !== '' ? body.edge : undefined,
        })
        send(res, result.ok ? 200 : 400, result)
        return
      }

      if (path === '/long-term/archive-now') {
        const result = await archiveDeadNow()
        send(res, result.ok ? 200 : 400, result)
        return
      }

      if (path === '/persona') {
        const result = await persona.saveText(body.text)
        send(res, result.success ? 200 : 400, result)
        return
      }

      if (path === '/memory/score') {
        const result = await hotMemory.setScore(body.target, body.text, body.score)
        send(res, result.success ? 200 : 400, result)
        return
      }

      if (path === '/memory/add' || path === '/memory/replace' || path === '/memory/remove') {
        const target = body.target
        if (target !== 'user' && target !== 'memory') {
          send(res, 400, { ok: false, error: 'target must be "user" or "memory"' })
          return
        }
        // `viaUi` skips the inline write-approval round trip: the person
        // clicking Save in this page is the approval.
        const args = path === '/memory/add'
          ? { target, action: 'add', content: body.content }
          : path === '/memory/replace'
            ? { target, action: 'patch', old_text: body.oldText, new_text: body.newText }
            : { target, action: 'remove', old_text: body.oldText }
        const result = await hotMemory.run(args, { viaUi: true })
        send(res, result.success ? 200 : 400, result)
        return
      }

      send(res, 404, { ok: false, error: `not found: ${req.method} ${path}` })
    } catch (error) {
      warn('settings API request failed', error)
      send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Register the route on a context that already carries `webServer`. This is
   * the path the plugin uses: the service mounts after the plugin row, so the
   * registration waits for it instead of silently finding `undefined`.
   * @param {any} scoped context carrying the service.
   * @returns {() => void} disposer.
   */
  function registerOn(scoped) {
    return scoped.webServer.register({ kind: 'prefix', path: API_PREFIX, handler })
  }

  /**
   * Register the route if the service is reachable right now; a composition
   * without a web server gets a no-op.
   * @returns {() => void} disposer.
   */
  function register() {
    const webServer = service('webServer')
    if (!webServer || typeof webServer.register !== 'function') {
      warn('the webServer service is absent; the settings page cannot load data')
      return () => {}
    }
    return webServer.register({ kind: 'prefix', path: API_PREFIX, handler })
  }

  return { register, registerOn, collectState, collectLongTerm, archiveDeadNow, listAvailableModels, collectApproval, apiPrefix: API_PREFIX }
}
