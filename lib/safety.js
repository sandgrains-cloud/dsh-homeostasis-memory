/**
 * Content scanning for everything this plugin writes: persona, hot memory, and
 * skills. Three categories are refused — prompt injection, privilege
 * escalation, and credential-shaped secrets — plus invisible Unicode, which is
 * how an injection hides from a human reviewer.
 *
 * Scanning is intentionally conservative: a false positive rejects a write and
 * shows its category, so the user can reword. A false negative would persist
 * attacker-controlled text into every later request.
 *
 * @module dsh-homeostasis-memory/safety
 */

/** Zero-width, bidi-control, and other non-printing characters. */
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/

/** Attempts to override the assembled prompt. */
const INJECTION = [
  /ignore\s+(?:all\s+|any\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|preceding|earlier)\s+(?:instructions?|prompts?|rules?|directions?|messages?)/i,
  /disregard\s+(?:all\s+|any\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|preceding|earlier)\s+/i,
  /(?:忽略|无视|忘记|忘掉|跳过|绕过|不要理会|别管)\s*(?:掉|了)?\s*(?:以上|上面|之前|先前|前面|所有|全部|一切|系统|你的|旧的)*\s*(?:的)?\s*(?:指令|提示词?|规则|设定|要求|限制|约束)/,
  /\byou\s+are\s+no\s+longer\b/i,
  /\byou\s+are\s+now\s+(?:a|an|the|my)\b/i,
  /\b(?:reveal|print|show|output|leak|repeat)\s+(?:me\s+)?(?:your|the)\s+(?:system\s+prompt|hidden\s+instructions?|initial\s+prompt|developer\s+message)/i,
  /\b(?:system|developer)\s+override\b/i,
  /^\s*(?:SYSTEM|DEVELOPER)\s*:/m,
  /\b(?:jailbreak|dan\s+mode|developer\s+mode\s+(?:enabled|on))\b/i,
  /(?:把|将)\s*(?:你的)?\s*(?:系统提示|系统提示词|指令)\s*(?:输出|打印|告诉我|发给我)/
]

/** Attempts to widen authority or remove a guardrail. */
const ESCALATION = [
  /\b(?:escalate|elevate|raise)\w*\s+(?:your\s+|the\s+)?(?:privileges?|permissions?|access)\b/i,
  /\b(?:disable|turn\s+off|circumvent|bypass|skip)\s+(?:the\s+|all\s+|any\s+)?(?:approval|safety|guard|permission|sandbox|confirmations?)/i,
  /\bwithout\s+(?:asking|confirming|approval|permission)\b/i,
  /(?:禁用它?|关闭|绕过|跳过)\s*(?:所有|全部|该)?\s*(?:的)?\s*(?:审批|确认|安全|守卫|沙箱|权限)/,
  // Only "somebody asks the agent to escalate", not the technical term for
  // self-elevating a script — "自提权" in a Windows scripting skill is normal.
  /(?:帮我|给我|替我|让你)\s*(?:提权|提升权限|获取管理员权限)/,
  /免审批|不需要确认|无需确认/
]

/** Credential-shaped strings that must never enter a prompt. */
const SECRETS = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/
]

/**
 * @typedef {{ ok: boolean, category?: string, detail?: string }} ScanResult
 */

/**
 * A negation on the same line means the instruction forbids the escalation
 * instead of asking for it. "Don't install X without asking" is correct advice,
 * and refusing it would block exactly the safety-conscious text.
 */
const NEGATION = /\b(?:don't|do not|never|must not|should not|avoid|refrain from)\b|不要|不得|禁止|绝不|切勿|避免|先问|先征得/i

/**
 * Find the first matching rule of one pattern list.
 * @param {string} text scanned text.
 * @param {readonly RegExp[]} patterns ordered rules.
 * @returns {string | undefined} a short, non-leaking detail.
 */
function firstHit(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match) return match[0].slice(0, 60)
  }
  return undefined
}

/**
 * Find an escalation instruction, skipping hits that sit on a negated line.
 * @param {string} text scanned text.
 * @returns {string | undefined} a short, non-leaking detail.
 */
function escalationHit(text) {
  for (const pattern of ESCALATION) {
    const scanner = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
    let match = scanner.exec(text)
    while (match !== null) {
      const lineStart = text.lastIndexOf('\n', match.index) + 1
      const lineEnd = text.indexOf('\n', match.index)
      const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd)
      if (!NEGATION.test(line)) return match[0].slice(0, 60)
      match = scanner.exec(text)
    }
  }
  return undefined
}

/**
 * Scan text before it is persisted.
 * @param {string} text candidate content.
 * @returns {ScanResult} `ok: false` with a category when the write must be refused.
 */
export function scan(text) {
  if (typeof text !== 'string' || text === '') return { ok: true }

  const invisible = INVISIBLE.exec(text)
  if (invisible) {
    const code = invisible[0].codePointAt(0) ?? 0
    return {
      ok: false,
      category: 'invisible-unicode',
      detail: `U+${code.toString(16).toUpperCase().padStart(4, '0')} at offset ${invisible.index}`,
    }
  }

  const injection = firstHit(text, INJECTION)
  if (injection) return { ok: false, category: 'prompt-injection', detail: injection }

  const escalation = escalationHit(text)
  if (escalation) return { ok: false, category: 'privilege-escalation', detail: escalation }

  const secret = firstHit(text, SECRETS)
  if (secret) return { ok: false, category: 'secret', detail: 'credential-shaped string' }

  return { ok: true }
}

/**
 * Whether text is safe only after removal of the flagged fragment. Used by the
 * snapshot builder, which must degrade one entry instead of failing the whole
 * assembly.
 * @param {string} text candidate entry.
 * @returns {boolean} true when the entry scans clean.
 */
export function isClean(text) {
  return scan(text).ok
}

/**
 * Escape a value for a double-quoted YAML scalar. JSON string syntax is valid
 * YAML double-quoted syntax, so this avoids hand-written frontmatter errors.
 * @param {string} value raw value.
 * @returns {string} a quoted scalar, including the surrounding quotes.
 */
export function yamlScalar(value) {
  return JSON.stringify(String(value))
}
