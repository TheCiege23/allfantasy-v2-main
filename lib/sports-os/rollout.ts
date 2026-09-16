/**
 * Sports OS — point 10: feature flags with small production groups before everyone.
 *
 * The unit of rollout is a `RolloutRule`: a kill switch, an allowlist, and a percentage evaluated
 * against a DETERMINISTIC bucket derived from the flag name and the subject id.
 *
 * ⚠ THE BUCKET IS HASHED WITH THE FLAG NAME IN IT, WHICH IS THE WHOLE DESIGN. Hashing the subject
 * alone would put the same unlucky 5% of users in the first cohort of EVERY expensive feature —
 * they would carry every regression we ship while 95% of users see none of them. Salting per flag
 * makes each rollout an independent draw.
 *
 * ⚠ AND IT IS DETERMINISTIC ON PURPOSE. A user must not flip between cohorts on every request:
 * half-rendered A and half-rendered B is a bug report nobody can reproduce, and it makes the
 * measurement the rollout exists to produce worthless.
 *
 * PURE. No I/O, no env reads at module scope, no clock. Rules come in as an argument, so a test
 * states the world instead of mutating `process.env`.
 */

export type RolloutRule = {
  /**
   * `false` turns the feature off for everyone, ignoring every other field. An incident switch
   * should not require reasoning about allowlists.
   */
  enabled: boolean
  /** 0–100. `0` means nobody but the allowlist; `100` means everybody. */
  percentage: number
  /** Subject ids that always get the feature regardless of percentage — staff, design partners. */
  allowlist?: readonly string[]
  /** Subject ids that never get it, and that BEAT the allowlist. */
  denylist?: readonly string[]
  /** Free-text note for whoever reads this table in six months. */
  note?: string
}

export type RolloutDecision = {
  flag: string
  enabled: boolean
  /** Why, so a support answer and a log line can both be specific. */
  reason: 'kill-switch' | 'denylist' | 'allowlist' | 'percentage' | 'no-subject' | 'unknown-flag'
  /** 0–9999, or null when there was no subject to bucket. */
  bucket: number | null
}

export const BUCKET_SPACE = 10_000

/**
 * FNV-1a, 32-bit. Chosen because it is stable across runtimes and trivially portable — the same
 * subject must land in the same bucket in Node, in the browser and in a SQL backfill, and a
 * `hashCode`-style sum does not spread short ids evenly enough for a 1% cohort to be 1%.
 */
export function hash32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    // hash * 16777619, in 32-bit shift-add form to stay inside a JS number.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash >>> 0
}

/** The stable 0–9999 bucket for one subject under one flag. */
export function bucketFor(flag: string, subjectId: string): number {
  return hash32(`${flag}:${subjectId}`) % BUCKET_SPACE
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/**
 * Decide one flag for one subject.
 *
 * ⚠ NO SUBJECT MEANS OFF, EXCEPT AT 100%. An anonymous visitor cannot be held in a stable cohort,
 * so bucketing them would re-roll on every request — the non-determinism this module exists to
 * prevent. A rule at 100% needs no bucket, so it applies to them too.
 */
export function evaluateRollout(
  flag: string,
  subjectId: string | null | undefined,
  rules: Readonly<Record<string, RolloutRule>>,
): RolloutDecision {
  const rule = rules[flag]
  if (!rule) return { flag, enabled: false, reason: 'unknown-flag', bucket: null }
  if (!rule.enabled) return { flag, enabled: false, reason: 'kill-switch', bucket: null }

  const subject = typeof subjectId === 'string' ? subjectId.trim() : ''
  const percentage = clampPercentage(rule.percentage)

  if (subject) {
    // Denylist beats allowlist: the list that takes something away must be the one that wins.
    if (rule.denylist?.includes(subject)) return { flag, enabled: false, reason: 'denylist', bucket: null }
    if (rule.allowlist?.includes(subject)) return { flag, enabled: true, reason: 'allowlist', bucket: null }
    const bucket = bucketFor(flag, subject)
    return { flag, enabled: bucket < Math.round((percentage / 100) * BUCKET_SPACE), reason: 'percentage', bucket }
  }

  return { flag, enabled: percentage >= 100, reason: 'no-subject', bucket: null }
}

export function isEnabled(
  flag: string,
  subjectId: string | null | undefined,
  rules: Readonly<Record<string, RolloutRule>>,
): boolean {
  return evaluateRollout(flag, subjectId, rules).enabled
}

/**
 * Parse a rule out of an env value, so a rollout can be widened by setting one variable rather than
 * shipping a commit.
 *
 * Accepted: `off` / `0` / `false` (kill switch), `on` / `100` / `true`, a bare percentage (`5`),
 * and a percentage with an allowlist (`5|user_a,user_b`).
 *
 * ⚠ AN UNPARSEABLE VALUE FALLS BACK TO THE CODE DEFAULT RATHER THAN TO OFF. A typo'd variable
 * silently disabling a shipped feature is the worse failure — and on Railway, correcting it costs a
 * redeploy (see CLAUDE.md: writing a Railway variable IS a deploy).
 */
export function parseRolloutEnv(raw: string | undefined | null, fallback: RolloutRule): RolloutRule {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!value) return fallback
  if (value === 'off' || value === 'false') return { ...fallback, enabled: false }
  if (value === 'on' || value === 'true') return { ...fallback, enabled: true, percentage: 100 }

  const [percentPart, listPart] = value.split('|', 2)
  const percentage = Number(percentPart)
  if (!Number.isFinite(percentage)) return fallback

  const allowlist = listPart
    ? listPart.split(',').map((entry) => entry.trim()).filter(Boolean)
    : fallback.allowlist
  return { ...fallback, enabled: percentage > 0 || (allowlist?.length ?? 0) > 0, percentage: clampPercentage(percentage), allowlist }
}

/**
 * The declared rollouts. Everything expensive that point 10 is about goes here BEFORE it is on for
 * everyone, and the `note` says what it costs.
 *
 * Keep them ordered by flag name so the diff of a widening is one line.
 */
export const DEFAULT_ROLLOUTS: Readonly<Record<string, RolloutRule>> = Object.freeze({
  'sports-os.budget-telemetry': {
    enabled: true,
    percentage: 100,
    note: 'Stamps budget verdicts on spans already being sampled. No extra queries, no extra spans.',
  },
  'sports-os.screen-summaries': {
    enabled: true,
    percentage: 10,
    note: 'Serves screens from precomputed summaries. Read-through, so a miss costs one compute — widen once hit rate is observable.',
  },
  'sports-os.ingest-reactions': {
    enabled: true,
    percentage: 0,
    note: 'Fans an import out to projections/rankings/alerts. Starts at 0: enqueueing per import multiplies worker load, and the worker is a single JS thread (see CLAUDE.md).',
  },
})
