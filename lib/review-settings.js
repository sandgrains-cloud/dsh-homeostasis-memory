/**
 * Review settings that the settings page owns.
 *
 * The static row configuration in `cordis.patch.yml` is the default; a value the
 * user changes in the page is persisted here and wins, so the review behaviour
 * can change without editing YAML or reloading the profile. Everything is
 * re-read at trigger time, so a change applies to the next review.
 *
 * Two strategies exist and are chosen implicitly by the model:
 * - the review model follows the main model (`inherit`) → the standard
 *   strategy: fork the whole conversation after a closing request or an idle
 *   period;
 * - a different model is fixed → synchronous review: one incremental pass after
 *   every completed turn.
 *
 * @module dsh-homeostasis-memory/review-settings
 */

import { readTextFile, writeTextAtomic } from './store.js'

const MODEL_MODES = new Set(['inherit', 'fixed'])

/**
 * @typedef {object} ReviewSettings
 * @property {boolean} enabled whether any review runs at all.
 * @property {boolean} passive whether the idle rule runs a standard review.
 * @property {{mode: 'inherit' | 'fixed', provider: string, model: string}} model which model the review uses.
 */

/**
 * Accept only the fields this module owns and normalize them.
 * Unknown fields stored by an older version (the retired bounded-review
 * options) are dropped here, so no migration is needed.
 * @param {unknown} raw parsed file or request body.
 * @param {ReviewSettings} base value to fall back on per field.
 * @returns {ReviewSettings} normalized settings.
 */
export function normalizeSettings(raw, base) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const modelRaw = source.model !== null && typeof source.model === 'object' && !Array.isArray(source.model) ? source.model : {}

  const modelMode = MODEL_MODES.has(modelRaw.mode) ? modelRaw.mode : base.model.mode
  const provider = typeof modelRaw.provider === 'string' ? modelRaw.provider : base.model.provider
  const model = typeof modelRaw.model === 'string' ? modelRaw.model : base.model.model

  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : base.enabled,
    passive: typeof source.passive === 'boolean' ? source.passive : base.passive,
    // A fixed route without both halves is meaningless: fall back to inherit.
    model: {
      mode: modelMode === 'fixed' && (provider === '' || model === '') ? 'inherit' : modelMode,
      provider,
      model,
    },
  }
}

/**
 * Build the documented defaults from the static row configuration.
 * @param {{enabled: boolean, passive: boolean, model: {mode: string, provider: string, model: string}}} config static review config.
 * @returns {ReviewSettings} defaults.
 */
export function reviewDefaults(config) {
  return normalizeSettings(
    {
      enabled: config.enabled === true,
      passive: config.passive === true,
      model: {
        mode: config.model?.mode,
        provider: config.model?.provider,
        model: config.model?.model,
      },
    },
    {
      enabled: true,
      passive: true,
      model: { mode: 'inherit', provider: '', model: '' },
    },
  )
}

/**
 * @param {object} options dependencies.
 * @param {string} options.file absolute settings path.
 * @param {ReviewSettings} options.defaults static defaults.
 * @returns {object} settings accessors.
 */
export function createReviewSettings({ file, defaults }) {
  /** @type {ReviewSettings | undefined} */
  let cached

  /**
   * Read the file and merge it over the defaults.
   * @returns {Promise<ReviewSettings>} effective settings.
   */
  async function read() {
    const result = await readTextFile(file)
    if (!result.exists || result.text.trim() === '') {
      cached = normalizeSettings({}, defaults)
      return cached
    }
    if (!result.readable) {
      // An unreadable file must not silently change behaviour: keep the
      // defaults and let the caller warn.
      throw new Error(`cannot read ${file}: ${result.error ?? 'unknown'}`)
    }
    try {
      cached = normalizeSettings(JSON.parse(result.text), defaults)
      return cached
    } catch (error) {
      throw new Error(`invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Merge a patch into the stored file.
   * @param {unknown} patch fields to change.
   * @returns {Promise<ReviewSettings>} effective settings after the write.
   */
  async function write(patch) {
    const current = cached ?? (await read())
    const next = normalizeSettings(patch, current)
    await writeTextAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
    cached = next
    return next
  }

  return {
    file,
    read,
    write,
    /** The static defaults, used when the file cannot be read. */
    fallback: () => normalizeSettings({}, defaults),
    getCached: () => cached,
  }
}
