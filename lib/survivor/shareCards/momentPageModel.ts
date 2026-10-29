/**
 * Pure pieces of the public moment page (survivor-core §4). No I/O; the privacy rules the page
 * relies on live here so tests can drive them directly.
 *
 *  - The scroll shows the names written down and their order. Never who wrote them: the input is
 *    run through `toPublicRevealSteps`, which drops any voter field an older sequence carried.
 *  - The scroll is shown only once the council read is complete (`isCouncilReadComplete`). The
 *    moment itself is captured after the read, but the page checks again rather than trusting it.
 *  - "Still in the game" is torches per tribe: counts only, no names.
 */
import { isCouncilReadComplete, toPublicRevealSteps, type RevealStateRow } from '@/lib/survivor/survivorRevealGate'

export interface MomentScrollSlip {
  order: number
  name: string
  /** Did not count (idol, late, steal, ...). Rendered struck through with a stamp. */
  struck: boolean
  stamp: string | null
}

const STAMP: Record<string, string | null> = {
  counts: null,
  blocked_by_idol: 'Idol played',
  target_safe: 'Idol played',
  late_does_not_count: 'Too late',
  forfeited_by_shot: 'Forfeited',
  blocked_by_shot: 'Blocked',
  taken_by_vote_steal: 'Vote stolen',
}

export function momentCouncilIdFromDedupeKey(dedupeKey: string | null | undefined): string | null {
  if (!dedupeKey) return null
  const match = /^(?:out|idol):([^:]+)/.exec(dedupeKey)
  return match ? match[1] : null
}

export function publicMomentScroll(council: (RevealStateRow & { week: number }) | null, revealMode: string | null | undefined, now: Date = new Date()): { week: number; slips: MomentScrollSlip[] } | null {
  if (!council || !isCouncilReadComplete(council, revealMode, now)) return null
  const steps = toPublicRevealSteps(council.revealSequence)
  if (!steps.length) return null
  return {
    week: council.week,
    slips: steps.map(step => ({
      order: step.order,
      name: step.targetName ?? 'A manager',
      struck: step.status !== 'counts',
      stamp: STAMP[step.status] ?? null,
    })),
  }
}

export interface MomentTribeTorches {
  name: string
  crestUrl: string | null
  color: string | null
  lit: number
  out: number
}

export interface MomentMoreItem {
  href: string
  kicker: string
  headline: string
  backgroundPath: string
  heroPath: string
  accent: string
}
