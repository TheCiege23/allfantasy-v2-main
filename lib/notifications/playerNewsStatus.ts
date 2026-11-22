/**
 * What a piece of player news SAYS about the player's availability — and whether that is worth
 * interrupting anyone for. Pure. Owner's rule (2026-10-22): alert when a player goes from questionable
 * to out, or is activated; skip practice-report noise; skip news about a player already on IR.
 *
 * The bucket is also half of the shared "already told" key (lib/notifications/playerNewsGate), so two
 * senders reporting the same thing — the news feed's "ruled out" story and the injury sync's "Out" —
 * collapse to one alert, while a real change (questionable → out) is still news.
 */

export type StatusBucket = 'ir' | 'suspended' | 'out' | 'doubtful' | 'questionable' | 'active' | 'practice' | 'other'

const IR = /injured reserve|\bIR\b|\bI\.R\.|out for (the )?season|season[- ]ending|\bPUP\b|\bNFI\b|60-day IL|\bIL\b|injured list/i
const ACTIVE = /\bactivated\b|\breturn(s|ed|ing)? (to|from)\b|\bcleared\b|\bwill play\b|\bavailable\b|\bhealthy\b|\bactive\b|off (the )?(IR|injured)/i
const PRACTICE = /(limited|full|did not|didn't|DNP|non-?participant|sat out|absent from)\W+(\w+\W+){0,4}practice|practice (report|participation|status)|\b(limited|full) participant\b/i

/** Classify a status word ("Out", "Questionable") or a headline ("X ruled out Sunday"). */
export function statusBucket(text: string | null | undefined): StatusBucket {
  const s = String(text ?? '').trim()
  if (!s) return 'other'
  // Activation wins over the IR word it usually carries ("activated off IR").
  if (/\bactivated\b|off (the )?(IR|injured)|returns? from (IR|injured)/i.test(s)) return 'active'
  if (IR.test(s)) return 'ir'
  if (/suspen(d|sion)/i.test(s)) return 'suspended'
  // "Out" as a status, or availability phrasing — never the bare word ("worked out", "came out of").
  if (/\brul(e|es|ed) out\b|^out\b|\b(is|was|listed|remains?|will be|declared)\s+out\b|\bout (for|vs\.?|against|this|tonight|indefinitely|sunday|monday|tuesday|wednesday|thursday|friday|saturday|week|game)\b|\binactive\b|will (not play|miss)|\bsidelin(e|es|ed|ing)\b/i.test(s)) return 'out'
  if (/\bdoubtful\b/i.test(s)) return 'doubtful'
  if (/\bquestionable\b|game[- ]time decision|day[- ]to[- ]day|\bprobable\b/i.test(s)) return 'questionable'
  if (PRACTICE.test(s)) return 'practice'
  if (ACTIVE.test(s)) return 'active'
  return 'other'
}

/** Buckets that change a lineup decision now: worth a push. 'other' and 'practice' are not. */
export function isInstantBucket(b: StatusBucket): boolean {
  return b !== 'other' && b !== 'practice'
}

/**
 * Is moving from `prev` to `next` news at all?
 *   - the same bucket again is not (Questionable on Wednesday and Questionable on Thursday);
 *   - a practice report is not;
 *   - a player already on IR is news only when he comes back.
 * `prev` null = we never saw him before, so anything but noise counts.
 */
export function isMeaningfulStatusChange(prev: StatusBucket | null, next: StatusBucket): boolean {
  if (next === 'practice') return false
  if (prev == null) return true
  if (prev === next) return false
  if (prev === 'ir' && next !== 'active') return false
  return true
}
