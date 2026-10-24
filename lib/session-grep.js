/**
 * Layer 5 — literal recall over past sessions in the same workspace.
 *
 * The Harness' own full-text index is not used (PRD FR-3.1): its `unicode61`
 * tokenizer matches whole tokens only, so a Chinese query like `生产库` never
 * matches a message containing `生产库只读`. `sessionQuery.filterEvents` takes a
 * literal-text predicate, which is what this tool relies on.
 *
 * Scope is deliberately narrow: the current working directory, the most recent
 * sessions, excluding the session asking the question.
 *
 * @module dsh-homeostasis-memory/session-grep
 */

import { charCount } from './store.js'

const ROLES = new Set(['user', 'assistant', 'both'])

/**
 * Build a short excerpt around the first match.
 * @param {string} text full document text.
 * @param {string} query literal query.
 * @param {number} size maximum excerpt length in code points.
 * @returns {string} excerpt.
 */
function excerpt(text, query, size) {
  const flat = text.replace(/\s+/g, ' ').trim()
  const index = flat.toLowerCase().indexOf(query.toLowerCase())
  if (index === -1) {
    return flat.length <= size ? flat : `${flat.slice(0, size)}…`
  }
  const half = Math.max(40, Math.floor((size - query.length) / 2))
  const from = Math.max(0, index - half)
  const to = Math.min(flat.length, index + query.length + half)
  const head = from > 0 ? '…' : ''
  const tail = to < flat.length ? '…' : ''
  return `${head}${flat.slice(from, to)}${tail}`
}

/**
 * @param {object} options dependencies.
 * @param {object} options.ctx plugin context, used to resolve optional services.
 * @param {{maxSessions: number, maxHits: number, snippetChars: number, timeoutMs: number}} options.config limits.
 * @returns {{run: Function}} the tool implementation.
 */
export function createSessionGrep({ ctx, config }) {
  /**
   * Resolve an optional Host service without throwing.
   * @param {string} name service key.
   * @returns {any} the service, or `undefined`.
   */
  function service(name) {
    try {
      const found = ctx.get(name)
      if (found !== undefined && found !== null) return found
    } catch {
      /* fall through to the property form */
    }
    try {
      return ctx[name]
    } catch {
      return undefined
    }
  }

  /**
   * The calling session's working directory.
   * @param {object | undefined} agent calling agent.
   * @returns {string | undefined} absolute cwd.
   */
  function cwdOf(agent) {
    const session = agent?.session
    if (session?.header?.cwd) return session.header.cwd
    const wd = service('workingDirectory')
    if (wd && session) {
      try {
        return wd.get(session)
      } catch {
        return undefined
      }
    }
    return undefined
  }

  /**
   * Fold a session title without failing the search.
   * @param {any} queryService the session query service.
   * @param {string} sessionId target session.
   * @returns {Promise<string | undefined>} title.
   */
  async function titleOf(queryService, sessionId) {
    try {
      const title = await queryService.readTitle(sessionId)
      return typeof title?.title === 'string' ? title.title : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Execute one `session_grep` call.
   * @param {{query?: string, role?: string, limit?: number}} args tool arguments.
   * @param {{agent?: object, signal?: AbortSignal}} exec tool execution context.
   * @returns {Promise<object>} matches or an actionable error.
   */
  async function run(args, exec) {
    const query = String(args?.query ?? '').trim()
    if (charCount(query) < 2) {
      return { success: false, error: 'invalid', message: 'query must be at least 2 characters' }
    }

    const role = String(args?.role ?? 'both')
    if (!ROLES.has(role)) {
      return { success: false, error: 'invalid', message: 'role must be one of: user, assistant, both' }
    }

    const queryService = service('sessionQuery')
    if (!queryService) {
      return {
        success: false,
        error: 'unavailable',
        message: 'the sessionQuery service is not mounted in this profile, so past sessions cannot be read',
      }
    }

    const cwd = cwdOf(exec?.agent)
    if (!cwd) {
      return { success: false, error: 'unavailable', message: 'this session has no working directory, so there is no workspace to search' }
    }

    const types = role === 'user' ? ['user/message'] : role === 'assistant' ? ['assistant/message'] : ['user/message', 'assistant/message']
    const limit = Math.max(1, Math.min(Number(args?.limit) || config.maxHits, 50))
    const currentId = exec?.agent?.session?.id

    const controller = new AbortController()
    const deadline = Date.now() + config.timeoutMs
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)

    const started = Date.now()
    let scanned = 0
    let truncated = false
    const hits = []

    try {
      const records = await queryService.listSessions(controller.signal)
      const candidates = records
        .filter((record) => record?.header && record.header.cwd === cwd)
        .filter((record) => record.header.origin !== 'subagent')
        .filter((record) => currentId === undefined || record.header.id !== currentId)
        .sort((left, right) => (right.header.createdAt ?? 0) - (left.header.createdAt ?? 0))
        .slice(0, config.maxSessions)

      if (candidates.length === 0) {
        return {
          success: true,
          query,
          cwd,
          hits: [],
          scanned_sessions: 0,
          truncated: false,
          message: 'no other sessions in this workspace',
        }
      }

      for (const record of candidates) {
        if (Date.now() > deadline) {
          truncated = true
          break
        }
        scanned += 1
        let documents
        try {
          documents = await queryService.filterEvents(record.header.id, [
            { kind: 'type', values: types },
            { kind: 'text', text: query },
          ])
        } catch {
          continue
        }
        if (!Array.isArray(documents) || documents.length === 0) continue

        const title = await titleOf(queryService, record.header.id)
        for (const document of documents) {
          if (hits.length >= limit) {
            truncated = true
            break
          }
          hits.push({
            session_id: record.header.id,
            ...(title === undefined ? {} : { title }),
            time: new Date(document.time ?? record.header.createdAt ?? 0).toISOString(),
            role: document.type === 'user/message' ? 'user' : 'assistant',
            seq: document.seq,
            snippet: excerpt(String(document.text ?? ''), query, config.snippetChars),
          })
        }
        if (hits.length >= limit) {
          truncated = true
          break
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return {
          success: hits.length > 0,
          query,
          cwd,
          hits,
          scanned_sessions: scanned,
          truncated: true,
          error: 'timeout',
          message: `the scan exceeded ${config.timeoutMs} ms; these are the matches collected so far`,
        }
      }
      return {
        success: false,
        error: 'io-error',
        message: `session search failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    } finally {
      clearTimeout(timer)
    }

    return {
      success: true,
      query,
      cwd,
      hits,
      scanned_sessions: scanned,
      truncated,
      elapsed_ms: Date.now() - started,
      ...(hits.length === 0
        ? { message: `no literal match for "${query}" in the last ${scanned} sessions of this workspace` }
        : {}),
    }
  }

  return { run }
}
