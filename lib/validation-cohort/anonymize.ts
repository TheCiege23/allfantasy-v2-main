/**
 * Fantasy OS Suite — Phase V7.1: Decision OS Validation Cohort (anonymization).
 *
 * Step 10 privacy: reports must not carry raw provider league ids or account names. A league is
 * referenced by a stable, opaque, one-way token derived from its real id, so reports are correlatable
 * across runs without exposing identifying data. This is not encryption — it is a deterministic label.
 */
import { createHash } from 'node:crypto'

/** Stable opaque reference for a league, e.g. `lg_1a2b3c4d`. One-way; safe to put in a report. */
export function anonymizeLeagueId(rawLeagueId: string): string {
  const h = createHash('sha256').update(String(rawLeagueId)).digest('hex')
  return `lg_${h.slice(0, 10)}`
}

/** Stable opaque reference for an account (used only if an account must appear in a shareable report). */
export function anonymizeAccount(userIdOrName: string): string {
  const h = createHash('sha256').update(String(userIdOrName)).digest('hex')
  return `acct_${h.slice(0, 10)}`
}
