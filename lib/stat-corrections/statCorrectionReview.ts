/**
 * STAT-CORRECTION REVIEW — which scores in a SEALED week would change if the league office's
 * corrected stats were applied, and whether any result would flip.
 *
 * Pure: the detector (statCorrectionDetector.ts) loads the week's starters, their stored stat lines
 * and a fresh pull of the same week, and this compares them. Nothing here writes, and nothing the
 * detector does moves a score — a sealed week's results stand (see the 🛑 note on the sealed-week
 * skip in app/api/redraft/score-sync/route.ts). Applying a correction is a commissioner decision.
 *
 * A matchup's corrected total is its STORED score plus the starters' point changes, so a commissioner
 * score adjustment already in the stored score is carried through untouched.
 */
import { createHash } from 'node:crypto'

import type { LeagueStatScorer } from '@/lib/redraft/scoringEngine'

/** Point changes smaller than this are rounding, not a correction. */
export const STAT_CORRECTION_MIN_DELTA = 0.01

export type StarterStatLine = {
  rosterId: string
  playerId: string
  playerName: string
  position: string | null
  /** The stat line the week was scored on; null when the player had no stored row. */
  storedStats: Record<string, number> | null
  /** The same week pulled again now; null when the fresh pull had no line for him. */
  freshStats: Record<string, number> | null
}

export type ReviewMatchup = {
  matchupId: string
  homeRosterId: string
  awayRosterId: string
  homeScore: number
  awayScore: number
}

export type PlayerCorrection = {
  rosterId: string
  playerId: string
  playerName: string
  position: string | null
  before: number
  after: number
  delta: number
}

export type MatchupSide = { rosterId: string; before: number; after: number }

export type MatchupCorrection = {
  matchupId: string
  home: MatchupSide
  away: MatchupSide
  /** The winner (or a tie) would be different on the corrected scores. */
  resultFlipped: boolean
}

export type StatCorrectionReview = {
  changes: PlayerCorrection[]
  /** Only the matchups a change touches. */
  matchups: MatchupCorrection[]
  /** Starters that could not be compared: no stored row, or nothing in the fresh pull. */
  unchecked: number
  /** Stable for the same set of corrections, so the detector logs each set once. Empty when nothing changed. */
  fingerprint: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

function outcome(home: number, away: number): 'home' | 'away' | 'tie' {
  return home > away ? 'home' : away > home ? 'away' : 'tie'
}

export function reviewStatCorrections(args: {
  starters: readonly StarterStatLine[]
  matchups: readonly ReviewMatchup[]
  score: LeagueStatScorer
}): StatCorrectionReview {
  const changes: PlayerCorrection[] = []
  let unchecked = 0
  for (const s of args.starters) {
    if (!s.storedStats || !s.freshStats) {
      unchecked += 1
      continue
    }
    const before = round2(args.score(s.storedStats, s.position))
    const after = round2(args.score(s.freshStats, s.position))
    const delta = round2(after - before)
    if (Math.abs(delta) < STAT_CORRECTION_MIN_DELTA) continue
    changes.push({ rosterId: s.rosterId, playerId: s.playerId, playerName: s.playerName, position: s.position, before, after, delta })
  }
  changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.playerId.localeCompare(b.playerId))

  const deltaByRoster = new Map<string, number>()
  for (const c of changes) deltaByRoster.set(c.rosterId, (deltaByRoster.get(c.rosterId) ?? 0) + c.delta)

  const matchups: MatchupCorrection[] = []
  for (const m of args.matchups) {
    const homeDelta = deltaByRoster.get(m.homeRosterId) ?? 0
    const awayDelta = deltaByRoster.get(m.awayRosterId) ?? 0
    if (homeDelta === 0 && awayDelta === 0) continue
    const home = { rosterId: m.homeRosterId, before: round2(m.homeScore), after: round2(m.homeScore + homeDelta) }
    const away = { rosterId: m.awayRosterId, before: round2(m.awayScore), after: round2(m.awayScore + awayDelta) }
    matchups.push({
      matchupId: m.matchupId,
      home,
      away,
      resultFlipped: outcome(home.before, away.before) !== outcome(home.after, away.after),
    })
  }

  const fingerprint = changes.length
    ? createHash('sha256')
        .update(
          changes
            .map((c) => `${c.rosterId}:${c.playerId}:${c.after}`)
            .sort()
            .join('|'),
        )
        .digest('hex')
        .slice(0, 16)
    : ''
  return { changes, matchups, unchecked, fingerprint }
}
