/**
 * Fantasy OS Suite — Phase V7.1: Decision OS Validation Cohort (candidate normalization).
 *
 * Turns the raw pasted cohort lines into a deduplicated candidate registry. This step is deliberately
 * conservative and evidence-based: it NEVER guesses that an ambiguous line is a username. It only
 * heuristically pre-classifies; the authoritative check is the Sleeper API (in the resolver). Lines that
 * don't look like a username are recorded as `ambiguous` with the exact reason — never silently dropped
 * or coerced.
 */
import type { ValidationAccount, AmbiguityReason } from './types'

/**
 * Sleeper usernames are a single token: letters, digits, and underscores, no whitespace, up to 32 chars.
 * (This is a pre-filter; the API is the source of truth for whether a token is a real account.)
 */
const USERNAME_RE = /^[a-zA-Z0-9_]{1,32}$/

/** Tokens that strongly indicate a league/team display name rather than a username. */
const NAME_HINT_RE = /\b(league|dynasty|keeper|redraft|division|conference|cup|bowl)\b/i

function classify(trimmed: string): { ok: boolean; reason?: AmbiguityReason } {
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (/\s/.test(trimmed)) return { ok: false, reason: 'contains-whitespace' }
  if (trimmed.length > 32) return { ok: false, reason: 'too-long' }
  if (!USERNAME_RE.test(trimmed)) return { ok: false, reason: 'contains-illegal-chars' }
  // A single-token match that still reads like a league label (e.g. "DynastyLeague") — flag, don't drop.
  if (NAME_HINT_RE.test(trimmed)) return { ok: false, reason: 'looks-like-league-or-team-name' }
  return { ok: true }
}

/**
 * Normalize a raw cohort paste into a deduplicated candidate registry.
 *
 * - Trims every line; blank lines are ignored entirely (not recorded).
 * - Lowercases for the normalized username and for dedup (Sleeper usernames are case-insensitive).
 * - Deduplicates by normalized username; repeated appearances are noted on the first occurrence.
 * - Pre-classifies non-username-looking lines as `ambiguous` with a reason (recorded, never guessed).
 */
export function normalizeCohort(rawLines: string[]): ValidationAccount[] {
  const byKey = new Map<string, ValidationAccount>()
  const order: string[] = []

  for (const line of rawLines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue

    const { ok, reason } = classify(trimmed)
    const key = trimmed.toLowerCase()

    const existing = byKey.get(key)
    if (existing) {
      existing.notes.push(`duplicate occurrence of "${trimmed}" ignored`)
      continue
    }

    const account: ValidationAccount = {
      raw: trimmed,
      normalizedUsername: key,
      status: ok ? 'pending' : 'ambiguous',
      source: 'manual-cohort',
      notes: ok ? [] : [`pre-classified ambiguous: ${reason} — not resolved as a username without confirmation`],
    }
    byKey.set(key, account)
    order.push(key)
  }

  return order.map((k) => byKey.get(k)!)
}

/** Convenience: the subset worth sending to the resolver (pending candidates only). */
export function resolvableCandidates(accounts: ValidationAccount[]): ValidationAccount[] {
  return accounts.filter((a) => a.status === 'pending')
}
