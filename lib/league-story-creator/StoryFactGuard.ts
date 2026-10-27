/**
 * StoryFactGuard — ensures story does not invent players, matchups, standings, trades, rivalries, or scores.
 * Validates that narrative only references real structured inputs and allowed entities.
 */

import type { StoryOutput } from "./types"
import type { NarrativeContextPackage } from "./types"

export interface StoryFactGuardResult {
  passed: boolean
  errors: string[]
  warnings: string[]
}

const INVENTED_PATTERNS = [
  /\b(fake|invented|hypothetical|imaginary|made up)\b/i,
  /\b(guaranteed|100%|certain(ly)?)\s+(win|loss|title)\b/i,
  /\b(unbeatable|automatic championship|scripted outcome)\b/i,
]

/**
 * Validate story output against the context package. No entities outside allowed lists.
 */
export function validateStoryOutput(
  output: StoryOutput,
  context: NarrativeContextPackage
): StoryFactGuardResult {
  const errors: string[] = []
  const warnings: string[] = []
  const allowed = new Set(
    [
    ...(context.allowedManagerNames ?? []).map((n) => n.toLowerCase()),
    ...(context.allowedEntityIds ?? []).map((id) => id.toLowerCase()),
    context.leagueId?.toLowerCase(),
    context.sport?.toLowerCase(),
    context.sportLabel?.toLowerCase(),
    ]
      .filter(Boolean)
      .map((token) => String(token).trim())
  )

  const fullText = [
    output.headline,
    output.whatHappened,
    output.whyItMatters,
    output.whoItAffects,
    output.nextStorylineToWatch,
    ...(output.keyEvidence ?? []),
    output.shortVersion,
    output.socialVersion,
    output.longVersion,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  for (const p of INVENTED_PATTERNS) {
    if (p.test(fullText)) {
      errors.push("Story may contain invented or hypothetical claims.")
      break
    }
  }

  if (context.dramaEvents?.length === 0 && context.rivalries?.length === 0) {
    warnings.push("No drama or rivalry data in context; story may be generic.")
  }

  const outputNumbers = extractIntegers(fullText)
  const contextNumbers = extractContextIntegers(context)
  const unknownNumbers = outputNumbers.filter((value) => !contextNumbers.has(value))
  if (unknownNumbers.length > 0) {
    warnings.push("Story includes numeric claims that are not directly traceable to structured context.")
  }

  const candidateEntityTokens = extractCandidateEntities(
    [
      output.headline,
      output.whatHappened,
      output.whyItMatters,
      output.whoItAffects,
      output.nextStorylineToWatch,
    ]
      .filter(Boolean)
      .join(" ")
  )
  const unknownEntityTokens = candidateEntityTokens.filter((token) => {
    const normalized = token.toLowerCase()
    if (allowed.has(normalized)) return false
    return true
  })
  if (unknownEntityTokens.length > 0) {
    warnings.push("Story references entities that are not clearly present in deterministic context.")
  }

  if (output.keyEvidence.length > 0 && context.dramaEvents.length === 0 && context.rivalries.length === 0) {
    warnings.push("Evidence is provided, but deterministic drama/rivalry context is empty.")
  }

  if (!output.keyEvidence?.length && fullText.length > 100) {
    warnings.push("Key evidence section is empty; add evidence from context.")
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  }
}

function extractIntegers(text: string): number[] {
  const matches = text.match(/\b\d{1,4}\b/g) ?? []
  return matches.map((value) => Number(value)).filter((value) => Number.isFinite(value))
}

function extractContextIntegers(context: NarrativeContextPackage): Set<number> {
  const numbers = new Set<number>()
  if (typeof context.season === "number") numbers.add(context.season)
  context.dramaEvents.forEach((event) => numbers.add(Math.round(event.dramaScore)))
  context.rivalries.forEach((rivalry) => {
    if (typeof rivalry.intensityScore === "number") numbers.add(Math.round(rivalry.intensityScore))
  })
  ;[
    context.graphSummary,
    context.rankingsSnapshot,
    context.legacyHint,
    context.simulationHint,
  ].forEach((value) => {
    extractIntegers(String(value ?? "")).forEach((num) => numbers.add(num))
  })
  return numbers
}

function extractCandidateEntities(text: string): string[] {
  const tokens = text.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? []
  return Array.from(
    new Set(
      tokens.filter(
        (token) => token.includes("_") || token.includes("-") || /\d/.test(token)
      )
    )
  )
}

/* ─── Storyline Studio hook rewrites (lib/storyline-studio) ────────────────────────────────── */

/**
 * Trash talk is about fantasy teams and play. These are the shapes that turn it into a personal
 * attack on the manager — their intelligence, looks, family, job — and a rewrite carrying one is
 * refused outright, whatever tone was asked for.
 */
const PERSONAL_ATTACK_PATTERNS = [
  /\byou(?:'re| are)\s+(?:a\s+)?(?:stupid|dumb|an?\s+idiot|ugly|fat|worthless|pathetic|a\s+loser|trash|garbage)\b/i,
  /\b(?:your|his|her|their)\s+(?:wife|husband|girlfriend|boyfriend|mom|mother|dad|father|kids?|family|job|face|weight)\b/i,
  /\b(?:kill|die|suicide|retard(?:ed)?)\b/i,
]

export type HookRewriteFact = { key: string; value: string | number }

/**
 * Is an AI rewrite of a hook still the same facts? Every number in it must be one of the hook's
 * fact values (names stripped first, since a team called "Gridiron 99" carries a number), it may
 * not drop a team or player name the facts carry, and it must clear the invented-claim and
 * personal-attack patterns. `hasProfanity` is the chat's own whole-word filter.
 */
export function validateHookRewrite(
  text: string,
  facts: readonly HookRewriteFact[],
  opts: { hasProfanity?: (t: string) => boolean } = {},
): StoryFactGuardResult {
  const errors: string[] = []
  const trimmed = text.trim()
  if (!trimmed) errors.push('Rewrite is empty.')
  for (const p of INVENTED_PATTERNS) if (p.test(trimmed)) errors.push('Rewrite contains an invented or certain-outcome claim.')
  for (const p of PERSONAL_ATTACK_PATTERNS) if (p.test(trimmed)) errors.push('Rewrite attacks a person rather than a team.')
  if (opts.hasProfanity?.(trimmed)) errors.push('Rewrite contains profanity.')

  const strings = facts
    .map((f) => (typeof f.value === 'string' ? f.value.trim() : ''))
    .filter((s) => s.length > 0)
  let rest = trimmed
  for (const s of [...strings].sort((a, b) => b.length - a.length)) rest = rest.split(s).join(' ')
  const allowed = new Set(
    facts.flatMap((f) => {
      if (typeof f.value === 'number') {
        const r = Math.round(f.value * 10) / 10
        return [Number.isInteger(r) ? String(r) : r.toFixed(1), String(f.value)]
      }
      return f.value.match(/\d+(?:\.\d+)?/g) ?? []
    }),
  )
  const unknown = (rest.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !allowed.has(n))
  if (unknown.length > 0) errors.push(`Rewrite has numbers that are not in its facts: ${unknown.join(', ')}`)

  // Names the hook is about must survive — a rewrite that swaps a team is a different claim.
  const names = facts.filter((f) => /Team$|^team[AB]?$|^player$/.test(f.key) && typeof f.value === 'string').map((f) => String(f.value))
  for (const n of names) if (!trimmed.includes(n)) errors.push(`Rewrite dropped "${n}".`)

  return { passed: errors.length === 0, errors, warnings: [] }
}

/* ─── Season recap, written from the recap's facts (lib/season-recap) ──────────────────────── */

/**
 * Is a written season recap still the recap's facts? The same rules as a hook rewrite, for prose:
 *
 *   - every number in it must be one of the facts' numbers (rounded as the page rounds, or to a whole
 *     number), after the fact strings — team and player names, which may carry digits — are removed;
 *   - the names it is about (`requiredNames`, the champion) must survive;
 *   - no invented or certain-outcome claim, no personal attack, no profanity;
 *   - Spanish text never says «waiver»: a pickup is a «reclamo».
 *
 * Numbers are compared as numbers, so "142.30" is 142.3. English thousands separators ("1,234") and a
 * Spanish decimal comma ("142,4") are read as the number they write.
 */
export function validateSeasonRecapText(
  text: string,
  facts: readonly HookRewriteFact[],
  opts: { requiredNames?: readonly string[]; language?: 'en' | 'es'; hasProfanity?: (t: string) => boolean } = {},
): StoryFactGuardResult {
  const errors: string[] = []
  const trimmed = text.trim()
  if (!trimmed) errors.push('Recap is empty.')
  for (const p of INVENTED_PATTERNS) if (p.test(trimmed)) errors.push('Recap contains an invented or certain-outcome claim.')
  for (const p of PERSONAL_ATTACK_PATTERNS) if (p.test(trimmed)) errors.push('Recap attacks a person rather than a team.')
  if (opts.hasProfanity?.(trimmed)) errors.push('Recap contains profanity.')
  if (opts.language === 'es' && /\bwaivers?\b/i.test(trimmed)) errors.push('Spanish recap uses the English loanword for a claim; it must say reclamo.')

  const strings = facts
    .map((f) => (typeof f.value === 'string' ? f.value.trim() : ''))
    .filter((s) => s.length > 0)
  let rest = trimmed
  for (const s of [...strings].sort((a, b) => b.length - a.length)) rest = rest.split(s).join(' ')
  rest = opts.language === 'es' ? rest.replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2') : rest.replace(/(\d),(\d{3})(?!\d)/g, '$1$2')

  const allowed = new Set<number>()
  for (const f of facts) {
    const values = typeof f.value === 'number' ? [f.value] : (f.value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
    for (const v of values) {
      allowed.add(v)
      allowed.add(Math.round(v))
      allowed.add(Math.round(v * 10) / 10)
      allowed.add(Math.round(v * 100) / 100)
    }
  }
  const unknown = (rest.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !allowed.has(Number(n)))
  if (unknown.length > 0) errors.push(`Recap has numbers that are not in its facts: ${[...new Set(unknown)].join(', ')}`)

  for (const n of opts.requiredNames ?? []) if (n && !trimmed.includes(n)) errors.push(`Recap dropped "${n}".`)

  return { passed: errors.length === 0, errors, warnings: [] }
}
