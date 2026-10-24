/**
 * Storage primitives for the memory system: paths, atomic writes, per-file
 * in-process locking, revisions, and encoding normalization.
 *
 * Single-process assumption (PRD FR-8): one DSH process owns one $DSH_HOME.
 * The mutex below serializes read-modify-write inside this process; it does
 * not coordinate two processes.
 *
 * @module dsh-homeostasis-memory/store
 */

import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Resolve `$DSH_HOME` the way the Harness does.
 * @returns {string} absolute path, without a trailing separator.
 */
export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return path.resolve(fromEnv.trim())
  const profileDir = process.env.DSH_PROFILE_DIR
  if (typeof profileDir === 'string' && profileDir.trim() !== '') {
    return path.dirname(path.resolve(profileDir.trim()))
  }
  return path.join(os.homedir(), '.dsh')
}

/**
 * Strip a UTF-8 BOM and normalize CRLF / lone CR to LF so that every byte
 * comparison and every revision stays stable across Windows editors.
 * @param {string} text raw file text.
 * @returns {string} normalized text.
 */
export function normalizeText(text) {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return withoutBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * Count characters by Unicode code point so limits match hermes' Python
 * `len()` instead of UTF-16 code units.
 * @param {string} text measured text.
 * @returns {number} code-point count.
 */
export function charCount(text) {
  let count = 0
  for (const _ of text) count += 1
  return count
}

/**
 * Short content revision used for optimistic concurrency.
 * @param {string} text current text.
 * @returns {string} 12 hex characters.
 */
export function revisionOf(text) {
  return createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 12)
}

/**
 * Number of UTF-8 bytes in a string.
 * @param {string} text measured text.
 * @returns {number} byte length.
 */
export function byteLength(text) {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * Describe a filesystem failure without leaking a stack trace into a tool result.
 * @param {unknown} error thrown value.
 * @returns {string} stable, short reason.
 */
export function describeFsError(error) {
  if (error && typeof error === 'object') {
    const code = /** @type {{ code?: unknown, message?: unknown }} */ (error).code
    if (typeof code === 'string' && code !== '') return code
    const message = /** @type {{ message?: unknown }} */ (error).message
    if (typeof message === 'string' && message !== '') return message
  }
  return String(error)
}

/**
 * Asynchronously read a UTF-8 text file.
 * @param {string} file absolute path.
 * @returns {Promise<{exists: boolean, readable: boolean, text: string, mtimeMs: number, size: number, error?: string}>} read result.
 */
export async function readTextFile(file) {
  try {
    const stat = await fsp.stat(file)
    if (!stat.isFile()) return { exists: true, readable: false, text: '', mtimeMs: 0, size: 0, error: 'not-a-file' }
    const raw = await fsp.readFile(file, 'utf8')
    return { exists: true, readable: true, text: normalizeText(raw), mtimeMs: stat.mtimeMs, size: stat.size }
  } catch (error) {
    if (error && typeof error === 'object' && /** @type {{ code?: unknown }} */ (error).code === 'ENOENT') {
      return { exists: false, readable: false, text: '', mtimeMs: 0, size: 0 }
    }
    return { exists: true, readable: false, text: '', mtimeMs: 0, size: 0, error: describeFsError(error) }
  }
}

/**
 * Synchronously read a UTF-8 text file. Used by prompt-section providers,
 * which must return a string synchronously on every assembly.
 * @param {string} file absolute path.
 * @returns {{exists: boolean, readable: boolean, text: string, mtimeMs: number, size: number, error?: string}} read result.
 */
export function readTextFileSync(file) {
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile()) return { exists: true, readable: false, text: '', mtimeMs: 0, size: 0, error: 'not-a-file' }
    const raw = fs.readFileSync(file, 'utf8')
    return { exists: true, readable: true, text: normalizeText(raw), mtimeMs: stat.mtimeMs, size: stat.size }
  } catch (error) {
    if (error && typeof error === 'object' && /** @type {{ code?: unknown }} */ (error).code === 'ENOENT') {
      return { exists: false, readable: false, text: '', mtimeMs: 0, size: 0 }
    }
    return { exists: true, readable: false, text: '', mtimeMs: 0, size: 0, error: describeFsError(error) }
  }
}

/**
 * Write text through a temporary file plus rename in the same directory.
 * @param {string} file absolute destination.
 * @param {string} text content to write (written with `\n` line endings).
 * @returns {Promise<void>} resolves once the destination holds the new bytes.
 */
export async function writeTextAtomic(file, text) {
  const directory = path.dirname(file)
  await fsp.mkdir(directory, { recursive: true })
  const suffix = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const temporary = path.join(directory, `.${path.basename(file)}.${suffix}.tmp`)
  await fsp.writeFile(temporary, text, 'utf8')
  try {
    await fsp.rename(temporary, file)
  } catch (error) {
    // Windows can refuse a rename over a file another handle briefly holds.
    try {
      await fsp.rm(file, { force: true })
      await fsp.rename(temporary, file)
    } catch (retryError) {
      await fsp.rm(temporary, { force: true })
      throw retryError
    }
  }
}

/**
 * Append one line to a newline-delimited file, creating it if needed.
 * @param {string} file absolute path.
 * @param {string} line line content without a trailing newline.
 * @returns {Promise<void>} resolves when appended.
 */
export async function appendLine(file, line) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.appendFile(file, `${line}\n`, 'utf8')
}

/**
 * Append one line to a newline-delimited file and keep only the newest lines.
 * The read-modify-write runs under the same per-file lock as every other write,
 * so concurrent review records can never interleave or resurrect a dropped line.
 * @param {string} file absolute path.
 * @param {string} line line content without a trailing newline.
 * @param {number} maxLines maximum number of lines kept.
 * @returns {Promise<{kept: number, dropped: number}>} what the file holds now.
 */
export async function appendBoundedLine(file, line, maxLines) {
  const limit = Number.isFinite(maxLines) ? Math.max(1, Math.trunc(maxLines)) : 5
  return withFileLock(file, async () => {
    const result = await readTextFile(file)
    if (result.exists && !result.readable) {
      throw new Error(`cannot read ${file}: ${result.error ?? 'unknown'}`)
    }
    const lines = result.text.split('\n').filter((entry) => entry.trim() !== '')
    lines.push(line)
    const dropped = Math.max(0, lines.length - limit)
    const kept = lines.slice(-limit)
    await writeTextAtomic(file, `${kept.join('\n')}\n`)
    return { kept: kept.length, dropped }
  })
}

/**
 * Copy a file to `<file>.bak.<timestamp>`.
 * @param {string} file absolute source path.
 * @returns {Promise<string>} the backup path.
 */
export async function backupFile(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = `${file}.bak.${stamp}`
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.copyFile(file, target)
  return target
}

const chains = new Map()

/**
 * Serialize an asynchronous critical section per key inside this process.
 * @template T
 * @param {string} key lock identity, usually the absolute file path.
 * @param {() => Promise<T>} operation critical section.
 * @returns {Promise<T>} the operation's value.
 */
export function withFileLock(key, operation) {
  const previous = chains.get(key) ?? Promise.resolve()
  const run = previous.then(operation, operation)
  const settled = run.then(
    () => undefined,
    () => undefined,
  )
  chains.set(key, settled)
  void settled.then(() => {
    if (chains.get(key) === settled) chains.delete(key)
  })
  return run
}

/**
 * Case-insensitive, separator-normalized key for path comparisons on Windows.
 * @param {string} value path to normalize.
 * @returns {string} comparison key.
 */
export function pathKey(value) {
  return path.resolve(value).replace(/[\\/]+/g, '/').toLowerCase()
}

/**
 * Whether `candidate` is the same file as `expected` or sits beneath it.
 * @param {string} candidate absolute or relative candidate path.
 * @param {string} expected absolute protected path.
 * @returns {boolean} true when the candidate must be guarded.
 */
export function samePath(candidate, expected) {
  try {
    return pathKey(candidate) === pathKey(expected)
  } catch {
    return false
  }
}
