/**
 * Layer 4 — skills written from the conversation.
 *
 * Layout is flat (`skills/<name>/SKILL.md`) because the Harness discovers one
 * level only. There is deliberately no `delete` action and no category folder:
 * removing a skill stays a human, filesystem-level decision.
 *
 * `patch`, an overwriting `write_file`, and `remove_file` all require a `read`
 * of that exact target earlier in the same turn.
 *
 * @module dsh-homeostasis-memory/skills
 */

import * as fsp from 'node:fs/promises'
import * as path from 'node:path'

import { scan, yamlScalar } from './safety.js'
import { charCount, describeFsError, readTextFile, writeTextAtomic } from './store.js'
import { similarity } from './hot-memory.js'

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SUPPORT_DIRS = ['references', 'templates', 'scripts', 'assets']
const MAX_NAME_CHARS = 64

/**
 * Normalize a requested skill name: trim, lower-case, internal whitespace to
 * hyphens. Comparison uses this, so `Foo Bar` and `foo-bar` are one skill.
 * @param {string} value requested name.
 * @returns {string} comparison key.
 */
function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
}

/**
 * Split a SKILL.md document into frontmatter and body.
 * @param {string} content file text.
 * @returns {{frontmatter: Record<string, string>, body: string}} parsed parts.
 */
function parseSkill(content) {
  const text = content.replace(/^\uFEFF/, '')
  if (!text.startsWith('---\n')) return { frontmatter: {}, body: text }
  const end = text.indexOf('\n---\n', 4)
  if (end === -1) return { frontmatter: {}, body: text }
  const raw = text.slice(4, end)
  const frontmatter = {}
  for (const line of raw.split('\n')) {
    const match = /^(name|description|whenToUse)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value)
      } catch {
        value = value.slice(1, -1)
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }
    frontmatter[match[1]] = value
  }
  return { frontmatter, body: text.slice(end + 5) }
}

/**
 * Render a SKILL.md document. Frontmatter is generated, never hand-written, so
 * an agent cannot produce invalid YAML.
 * @param {{name: string, description: string, whenToUse?: string}} meta metadata.
 * @param {string} body markdown body.
 * @returns {string} complete document.
 */
function renderSkill(meta, body) {
  const lines = ['---', `name: ${yamlScalar(meta.name)}`, `description: ${yamlScalar(meta.description)}`]
  if (typeof meta.whenToUse === 'string' && meta.whenToUse.trim() !== '') {
    lines.push(`whenToUse: ${yamlScalar(meta.whenToUse.trim())}`)
  }
  lines.push('---', '', body.replace(/\s+$/, ''), '')
  return lines.join('\n')
}

/**
 * Validate a support-file relative path.
 * @param {string} value requested path.
 * @returns {{ok: true, relative: string, target: string} | {ok: false, message: string}} validation.
 */
function validateSupportPath(value) {
  const raw = String(value ?? '').trim().replace(/\\/g, '/')
  if (raw === '') return { ok: false, message: 'path is required for this action' }
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    return { ok: false, message: 'path must be relative to the skill directory' }
  }
  const segments = raw.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.some((segment) => segment === '..')) {
    return { ok: false, message: 'path must not contain ".."' }
  }
  if (segments.length < 2) {
    return { ok: false, message: `path must be one of ${SUPPORT_DIRS.map((dir) => `${dir}/<file>`).join(', ')}` }
  }
  if (!SUPPORT_DIRS.includes(segments[0])) {
    return { ok: false, message: `path must start with one of: ${SUPPORT_DIRS.join(', ')}` }
  }
  return { ok: true, relative: segments.join('/'), target: segments.join(path.sep) }
}

/**
 * @param {object} options dependencies.
 * @param {string} options.root absolute skills root.
 * @param {number} options.descriptionMaxChars description ceiling.
 * @param {number} options.bodyMaxChars per-file ceiling.
 * @param {number} options.dedupeThreshold description similarity warning threshold.
 * @param {(agentId: string | undefined) => boolean} options.isReviewAgent review-child test.
 * @param {() => void} options.onChanged invalidate the Harness skill catalog.
 * @param {(message: string, error?: unknown) => void} options.warn logger.
 * @returns {object} skill helpers.
 */
export function createSkills({ root, descriptionMaxChars, bodyMaxChars, dedupeThreshold, isReviewAgent, onChanged, warn }) {
  /** @type {Map<string, Set<string>>} agent id -> targets read this turn. */
  const reads = new Map()

  /**
   * Record that an agent has read one target in this turn.
   * @param {string | undefined} agentId calling agent.
   * @param {string} key target key.
   * @returns {void}
   */
  function noteRead(agentId, key) {
    const id = agentId ?? 'anonymous'
    const set = reads.get(id) ?? new Set()
    set.add(key)
    reads.set(id, set)
  }

  /**
   * Forget one agent's read targets, called at each turn boundary.
   * @param {string | undefined} agentId calling agent.
   * @returns {void}
   */
  function clearReads(agentId) {
    reads.delete(agentId ?? 'anonymous')
  }

  /**
   * Drop every read target, called on plugin unload.
   * @returns {void}
   */
  function clearAllReads() {
    reads.clear()
  }

  /**
   * Whether a target was read this turn.
   * @param {string | undefined} agentId calling agent.
   * @param {string} key target key.
   * @returns {boolean} read state.
   */
  function wasRead(agentId, key) {
    return reads.get(agentId ?? 'anonymous')?.has(key) === true
  }

  /**
   * Skill directory for a name.
   * @param {string} name normalized name.
   * @returns {string} absolute directory.
   */
  function skillDir(name) {
    return path.join(root, name)
  }

  /**
   * List every skill directory that parses, with its description.
   * @returns {Promise<{name: string, description: string}[]>} existing skills.
   */
  async function listSkills() {
    let entries
    try {
      entries = await fsp.readdir(root, { withFileTypes: true })
    } catch (error) {
      if (error && typeof error === 'object' && /** @type {{code?: unknown}} */ (error).code === 'ENOENT') return []
      throw error
    }
    const skills = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const file = path.join(root, entry.name, 'SKILL.md')
      const read = await readTextFile(file)
      if (!read.readable) continue
      const { frontmatter } = parseSkill(read.text)
      skills.push({ name: entry.name, description: frontmatter.description ?? '' })
    }
    return skills
  }

  /**
   * List support files inside one skill.
   * @param {string} name normalized name.
   * @returns {Promise<string[]>} relative paths with `/` separators.
   */
  async function listSupportFiles(name) {
    const base = skillDir(name)
    const found = []
    const walk = async (directory, prefix) => {
      let entries
      try {
        entries = await fsp.readdir(directory, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
        if (entry.isDirectory()) {
          if (prefix === '' && !SUPPORT_DIRS.includes(entry.name)) continue
          await walk(path.join(directory, entry.name), relative)
        } else if (entry.isFile() && prefix !== '') {
          found.push(relative)
        }
      }
    }
    await walk(base, '')
    return found.sort()
  }

  /**
   * Read the frontmatter and body of one skill.
   * @param {string} name normalized name.
   * @returns {Promise<{ok: true, file: string, text: string, meta: Record<string, string>, body: string} | {ok: false, error: string, message: string}>} result.
   */
  async function readSkill(name) {
    const file = path.join(skillDir(name), 'SKILL.md')
    const read = await readTextFile(file)
    if (!read.exists) return { ok: false, error: 'not-found', message: `no skill named "${name}" under ${root}` }
    if (!read.readable) return { ok: false, error: 'io-error', message: `cannot read ${file}: ${read.error ?? 'unknown'}` }
    const parsed = parseSkill(read.text)
    return { ok: true, file, text: read.text, meta: parsed.frontmatter, body: parsed.body }
  }

  /**
   * Execute one `skill_manage` call.
   * @param {object} args tool arguments.
   * @param {{agent?: {id: string}, callId?: string, signal?: AbortSignal}} exec tool execution context.
   * @returns {Promise<object>} receipt or actionable error.
   */
  async function run(args, exec) {
    const action = String(args?.action ?? '')
    const agentId = exec?.agent?.id
    const name = normalizeName(args?.name)

    if (!['read', 'create', 'patch', 'write_file', 'remove_file'].includes(action)) {
      return {
        success: false,
        error: 'invalid',
        message: 'action must be one of: read, create, patch, write_file, remove_file',
      }
    }

    if (name === '') return { success: false, error: 'invalid', message: 'name is required' }
    if (!NAME_PATTERN.test(name) || name.length > MAX_NAME_CHARS) {
      return {
        success: false,
        error: 'invalid',
        message: `name must be kebab-case (a-z, 0-9, single hyphens) and at most ${MAX_NAME_CHARS} characters; got "${name}"`,
      }
    }

    if (action === 'read') return readAction(args, name, agentId)

    if (isReviewAgent(agentId) && action === 'remove_file') {
      return {
        success: false,
        error: 'unavailable-in-review',
        message: 'the review pass may create and patch skills but never remove files',
      }
    }

    if (action === 'create') return createAction(args, name)
    if (action === 'patch') return patchAction(args, name, agentId)
    if (action === 'write_file') return writeFileAction(args, name, agentId)
    return removeFileAction(args, name, agentId)
  }

  /**
   * `read` — return SKILL.md or one support file and record the read.
   * @param {object} args tool arguments.
   * @param {string} name normalized name.
   * @param {string | undefined} agentId calling agent.
   * @returns {Promise<object>} receipt.
   */
  async function readAction(args, name, agentId) {
    const requested = String(args?.file_path ?? args?.path ?? '').trim()

    if (requested === '') {
      const skill = await readSkill(name)
      if (!skill.ok) return { success: false, error: skill.error, message: skill.message }
      noteRead(agentId, name)
      const support = await listSupportFiles(name)
      return {
        success: true,
        action: 'read',
        name,
        path: skill.file,
        chars: charCount(skill.text),
        max_chars: bodyMaxChars,
        description: skill.meta.description ?? '',
        ...(skill.meta.whenToUse === undefined ? {} : { whenToUse: skill.meta.whenToUse }),
        body: skill.body.trim(),
        support_files: support,
      }
    }

    const validated = validateSupportPath(requested)
    if (!validated.ok) return { success: false, error: 'invalid', message: validated.message }
    const file = path.join(skillDir(name), validated.target)
    const read = await readTextFile(file)
    if (!read.exists) {
      return {
        success: false,
        error: 'not-found',
        message: `no file "${validated.relative}" in skill "${name}"`,
        support_files: await listSupportFiles(name),
      }
    }
    if (!read.readable) return { success: false, error: 'io-error', message: `cannot read ${file}: ${read.error ?? 'unknown'}` }
    noteRead(agentId, `${name}/${validated.relative}`)
    return {
      success: true,
      action: 'read',
      name,
      path: file,
      chars: charCount(read.text),
      max_chars: bodyMaxChars,
      content: read.text,
    }
  }

  /**
   * `create` — validate, dedupe, and write a new SKILL.md.
   * @param {object} args tool arguments.
   * @param {string} name normalized name.
   * @returns {Promise<object>} receipt.
   */
  async function createAction(args, name) {
    const description = String(args?.description ?? '').trim()
    const body = String(args?.body ?? '')
    const whenToUse = args?.whenToUse === undefined ? undefined : String(args.whenToUse)

    if (description === '') return { success: false, error: 'invalid', message: 'description is required and must not be empty' }
    if (charCount(description) > descriptionMaxChars) {
      return {
        success: false,
        error: 'too-large',
        message: `description is ${charCount(description)} characters; the limit is ${descriptionMaxChars}`,
      }
    }
    if (body.trim() === '') return { success: false, error: 'invalid', message: 'body is required and must not be empty' }

    const conflict = await readSkill(name)
    if (conflict.ok) {
      return {
        success: false,
        error: 'invalid',
        reason: 'exists',
        message: `a skill named "${name}" already exists at ${conflict.file}; patch it instead of creating it again`,
        existing: { name, path: conflict.file, description: conflict.meta.description ?? '' },
      }
    }

    const existing = await listSkills()
    const sameName = existing.find((skill) => normalizeName(skill.name) === name)
    if (sameName !== undefined) {
      return {
        success: false,
        error: 'invalid',
        reason: 'exists',
        message: `a skill named "${sameName.name}" already exists; patch it instead`,
        existing: sameName,
      }
    }

    const candidates = existing
      .map((skill) => ({ ...skill, score: similarity(skill.description, description) }))
      .filter((row) => row.score >= dedupeThreshold)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5)

    if (candidates.length > 0 && args?.create_anyway !== true) {
      return {
        success: false,
        error: 'ambiguous',
        reason: 'similar-description',
        message: `these skills already cover a similar description (>= ${dedupeThreshold}): patch one of them, or call create again with create_anyway: true if this is genuinely a new class`,
        candidates: candidates.map((row) => ({
          name: row.name,
          description: row.description.length <= 200 ? row.description : `${row.description.slice(0, 200)}...`,
          score: Number(row.score.toFixed(2)),
        })),
      }
    }

    const content = renderSkill({ name, description, whenToUse }, body)
    const chars = charCount(content)
    if (chars > bodyMaxChars) {
      return {
        success: false,
        error: 'too-large',
        message: `SKILL.md would be ${chars} characters; the limit is ${bodyMaxChars}. Move depth into references/ and keep SKILL.md to always-on rules.`,
      }
    }

    const verdict = scan(`${description}\n${body}`)
    if (!verdict.ok) {
      return {
        success: false,
        error: 'scan-blocked',
        category: verdict.category,
        message: `content refused by the scan (${verdict.category}: ${verdict.detail}); reword it and retry`,
      }
    }

    const file = path.join(skillDir(name), 'SKILL.md')
    try {
      await writeTextAtomic(file, content)
    } catch (error) {
      return { success: false, error: 'io-error', message: `write failed: ${describeFsError(error)}` }
    }
    notifyChanged()
    return {
      success: true,
      done: true,
      action: 'create',
      name,
      path: file,
      chars,
      max_chars: bodyMaxChars,
      note: 'created — a skill catalog refresh was requested; it appears on the next catalog read',
    }
  }

  /**
   * `patch` — unique substring replacement inside SKILL.md or a support file.
   * @param {object} args tool arguments.
   * @param {string} name normalized name.
   * @param {string | undefined} agentId calling agent.
   * @returns {Promise<object>} receipt.
   */
  async function patchAction(args, name, agentId) {
    const requested = String(args?.file_path ?? args?.path ?? '').trim()
    const relative = requested === '' ? undefined : validateSupportPath(requested)
    if (relative !== undefined && !relative.ok) return { success: false, error: 'invalid', message: relative.message }

    const key = relative === undefined ? name : `${name}/${relative.relative}`
    if (!wasRead(agentId, key)) {
      return {
        success: false,
        error: 'read-before-write',
        message: `read "${key}" in this turn before patching it: skill_manage action "read" with name "${name}"${relative === undefined ? '' : `, file_path "${relative.relative}"`}`,
      }
    }

    const skill = await readSkill(name)
    if (!skill.ok) return { success: false, error: skill.error, message: skill.message }

    const file = relative === undefined ? skill.file : path.join(skillDir(name), relative.target)
    const read = await readTextFile(file)
    if (!read.exists) return { success: false, error: 'not-found', message: `no file "${key}"` }
    if (!read.readable) return { success: false, error: 'io-error', message: `cannot read ${file}: ${read.error ?? 'unknown'}` }

    const oldText = String(args?.old_text ?? '')
    const newText = String(args?.new_text ?? '')
    if (oldText.trim() === '') return { success: false, error: 'invalid', message: 'old_text must not be empty' }
    if (newText.trim() === '') return { success: false, error: 'invalid', message: 'new_text must not be empty' }

    const occurrences = read.text.split(oldText).length - 1
    if (occurrences === 0) {
      return {
        success: false,
        error: 'not-found',
        message: 'old_text does not appear in that file; read it again and copy the exact text',
      }
    }
    if (occurrences > 1) {
      return {
        success: false,
        error: 'ambiguous',
        message: `old_text appears ${occurrences} times; include more surrounding text so it matches exactly once`,
      }
    }

    const next = read.text.replace(oldText, newText)
    const chars = charCount(next)
    if (chars > bodyMaxChars) {
      return { success: false, error: 'too-large', message: `the file would be ${chars} characters; the limit is ${bodyMaxChars}` }
    }

    const verdict = scan(newText)
    if (!verdict.ok) {
      return {
        success: false,
        error: 'scan-blocked',
        category: verdict.category,
        message: `new_text refused by the scan (${verdict.category}: ${verdict.detail}); reword it and retry`,
      }
    }

    try {
      await writeTextAtomic(file, next)
    } catch (error) {
      return { success: false, error: 'io-error', message: `write failed: ${describeFsError(error)}` }
    }
    reads.get(agentId ?? 'anonymous')?.delete(key)
    notifyChanged()
    return {
      success: true,
      done: true,
      action: 'patch',
      name,
      path: file,
      chars,
      max_chars: bodyMaxChars,
      note: 'patched — a skill catalog refresh was requested',
    }
  }

  /**
   * `write_file` — create or overwrite one support file.
   * @param {object} args tool arguments.
   * @param {string} name normalized name.
   * @param {string | undefined} agentId calling agent.
   * @returns {Promise<object>} receipt.
   */
  async function writeFileAction(args, name, agentId) {
    const validated = validateSupportPath(args?.path)
    if (!validated.ok) return { success: false, error: 'invalid', message: validated.message }

    const skill = await readSkill(name)
    if (!skill.ok) {
      return {
        success: false,
        error: 'not-found',
        message: `${skill.message}. Create the skill first with action "create" so SKILL.md exists.`,
      }
    }

    const content = String(args?.content ?? '')
    if (content.trim() === '') return { success: false, error: 'invalid', message: 'content must not be empty' }
    const chars = charCount(content)
    if (chars > bodyMaxChars) {
      return { success: false, error: 'too-large', message: `content is ${chars} characters; the limit is ${bodyMaxChars}` }
    }

    const key = `${name}/${validated.relative}`
    const file = path.join(skillDir(name), validated.target)
    const existing = await readTextFile(file)
    if (existing.exists && !wasRead(agentId, key)) {
      return {
        success: false,
        error: 'read-before-write',
        message: `"${key}" already exists; read it in this turn before overwriting it`,
      }
    }

    const verdict = scan(content)
    if (!verdict.ok) {
      return {
        success: false,
        error: 'scan-blocked',
        category: verdict.category,
        message: `content refused by the scan (${verdict.category}: ${verdict.detail}); reword it and retry`,
      }
    }

    try {
      await writeTextAtomic(file, content)
    } catch (error) {
      return { success: false, error: 'io-error', message: `write failed: ${describeFsError(error)}` }
    }
    reads.get(agentId ?? 'anonymous')?.delete(key)
    notifyChanged()
    return {
      success: true,
      done: true,
      action: 'write_file',
      name,
      path: file,
      chars,
      max_chars: bodyMaxChars,
      replaced: existing.exists,
      note: 'written — a skill catalog refresh was requested',
    }
  }

  /**
   * `remove_file` — delete one support file.
   * @param {object} args tool arguments.
   * @param {string} name normalized name.
   * @param {string | undefined} agentId calling agent.
   * @returns {Promise<object>} receipt.
   */
  async function removeFileAction(args, name, agentId) {
    const validated = validateSupportPath(args?.path)
    if (!validated.ok) return { success: false, error: 'invalid', message: validated.message }

    const key = `${name}/${validated.relative}`
    if (!wasRead(agentId, key)) {
      return { success: false, error: 'read-before-write', message: `read "${key}" in this turn before removing it` }
    }

    const file = path.join(skillDir(name), validated.target)
    const read = await readTextFile(file)
    if (!read.exists) return { success: false, error: 'not-found', message: `no file "${key}"` }

    try {
      await fsp.rm(file, { force: true })
    } catch (error) {
      return { success: false, error: 'io-error', message: `delete failed: ${describeFsError(error)}` }
    }
    reads.get(agentId ?? 'anonymous')?.delete(key)
    notifyChanged()
    return {
      success: true,
      done: true,
      action: 'remove_file',
      name,
      path: file,
      note: 'removed — a skill catalog refresh was requested',
    }
  }

  /**
   * Ask the Harness to re-read the skill catalog. Failure is logged, never fatal.
   * @returns {void}
   */
  function notifyChanged() {
    try {
      onChanged()
    } catch (error) {
      warn('skills/change emit failed', error)
    }
  }

  /**
   * Detailed rows for the settings page: name, description, size, mtime, and
   * how many supporting files each skill carries.
   * @returns {Promise<{name: string, description: string, path: string, chars: number, mtimeMs: number, supportFiles: number}[]>} skill rows, name-sorted.
   */
  async function inventory() {
    const rows = await listSkills()
    const detailed = []
    for (const row of rows) {
      const file = path.join(skillDir(row.name), 'SKILL.md')
      const read = await readTextFile(file)
      let mtimeMs = 0
      try {
        mtimeMs = (await fsp.stat(file)).mtimeMs
      } catch {
        mtimeMs = 0
      }
      detailed.push({
        name: row.name,
        description: row.description,
        path: file,
        chars: charCount(read.text),
        mtimeMs,
        supportFiles: (await listSupportFiles(row.name)).length,
      })
    }
    return detailed.sort((left, right) => left.name.localeCompare(right.name))
  }

  return { root, run, clearReads, clearAllReads, listSkills, inventory }
}
