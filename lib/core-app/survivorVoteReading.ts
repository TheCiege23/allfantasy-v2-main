/**
 * What the Camp banner's Tribal Council vote reading shows, from the league summary
 * (`/api/leagues/[leagueId]/survivor/summary`). Pure, so the tally, the latest ballot and the verdict
 * can be tested without rendering.
 *
 * ⚠ NO SPOILERS. The server releases ballots one at a time (lib/survivor/survivorRevealGate.ts) and
 * withholds the verdict until the last one is out. This module only ever reads what is in
 * `council.revealSequence`, and it names a voted-out castaway only when the server says the read is
 * complete AND every ballot it announced has arrived — so a half-delivered payload can never show a
 * verdict early.
 *
 * Tally semantics match the league reading scroll (components/league/survivor/SurvivorVoteRevealScrolls
 * `tallyOf`): every name read appears in reading order, and a ballot that does not count adds 0.
 */
import type { SurvivorScrollRevealStep, SurvivorSummary } from '@/components/survivor/types'

export type VoteReadingStatus = SurvivorScrollRevealStep['status']

export interface VoteReadingTallyRow {
  name: string
  count: number
  /** Holds the most counted votes so far (ties all lead; nobody leads at 0). */
  leading: boolean
}

export interface VoteReadingBallot {
  /** 1-based position in the read. */
  position: number
  /** null when the ballot had no eligible target. */
  targetName: string | null
  status: VoteReadingStatus
  counts: boolean
  isExtraVote: boolean
}

export type VoteReadingVerdict =
  | { kind: 'out'; name: string; votes: number; nextBest: number }
  | { kind: 'tie' }
  | { kind: 'none' }

export interface VoteReadingView {
  councilId: string
  week: number
  tribeName: string | null
  /** Ballots in the whole read (server), never fewer than the ballots released. */
  total: number
  /** Ballots the server has released so far. */
  released: number
  latest: VoteReadingBallot | null
  tally: VoteReadingTallyRow[]
  complete: boolean
  /** Only once the read is complete; null while it is in progress. */
  verdict: VoteReadingVerdict | null
}

/** Ballots that add a vote. Everything else (idol, late, stolen, Shot in the Dark, safe) adds 0. */
export function ballotCounts(status: VoteReadingStatus): boolean {
  return status === 'counts'
}

/** Live tally of the released ballots: every name read, cancelled names at 0, in reading order. */
export function readingTally(steps: readonly SurvivorScrollRevealStep[]): VoteReadingTallyRow[] {
  const rows = new Map<string, number>()
  for (const step of steps) {
    if (!step.targetName) continue
    rows.set(step.targetName, (rows.get(step.targetName) ?? 0) + (ballotCounts(step.status) ? 1 : 0))
  }
  const top = Math.max(0, ...rows.values())
  return [...rows].map(([name, count]) => ({ name, count, leading: top > 0 && count === top }))
}

/** A read from an earlier week stops showing once the league has moved on. */
function superseded(s: SurvivorSummary, week: number): boolean {
  return s.currentWeek > 0 && week > 0 && s.currentWeek > week
}

/**
 * The reading panel, or null when there is nothing to read: no council, not yet published, or a
 * read from a week the league has already moved past.
 */
export function voteReadingView(s: SurvivorSummary | null | undefined): VoteReadingView | null {
  const c = s?.council
  if (!s || !c || c.isRevealed !== true) return null
  if (superseded(s, c.week)) return null
  const steps = Array.isArray(c.revealSequence) ? c.revealSequence : []
  const released = steps.length
  const total = Math.max(released, typeof c.revealTotalSteps === 'number' ? c.revealTotalSteps : released)
  const last = steps[released - 1]
  const latest: VoteReadingBallot | null = last
    ? { position: released, targetName: last.targetName, status: last.status, counts: ballotCounts(last.status), isExtraVote: last.isExtraVote === true }
    : null
  const tally = readingTally(steps)
  // Both the server's word and the ballots in hand: a verdict never runs ahead of the read.
  const complete = c.revealComplete === true && released >= total
  let verdict: VoteReadingVerdict | null = null
  if (complete) {
    if (c.isTie === true) verdict = { kind: 'tie' }
    else if (c.eliminatedName) {
      const name = c.eliminatedName
      const votes = tally.find((r) => r.name === name)?.count ?? 0
      const nextBest = tally.filter((r) => r.name !== name).reduce((m, r) => Math.max(m, r.count), 0)
      verdict = { kind: 'out', name, votes, nextBest }
    } else verdict = { kind: 'none' }
  }
  const tribeName = c.attendingTribeId ? s.tribes.find((t) => t.id === c.attendingTribeId)?.name ?? null : null
  return { councilId: c.id, week: c.week, tribeName, total, released, latest, tally, complete, verdict }
}

/** Poll the summary only while a published read is still being released. */
export function shouldPollReading(s: SurvivorSummary | null | undefined): boolean {
  const c = s?.council
  if (!s || !c || c.isRevealed !== true || c.revealComplete !== false) return false
  return !superseded(s, c.week)
}
