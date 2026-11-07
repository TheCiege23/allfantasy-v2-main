/**
 * ONE READ MODEL FOR "IS THIS LEAGUE BEST BALL, AND WHAT DOES THAT MEAN FOR IT" — whichever shape the
 * league was saved in. Pure and client-safe (no prisma, no 'server-only').
 *
 * 🛑 THE TWO BEST BALL PRESETS ARE SAVED IN DIFFERENT SHAPES, AND READERS ANSWERED FOR ONE OF THEM.
 *
 *   Classic Best Ball  `leagueType: 'best_ball'` + `bestBallMode: true` + `settings.best_ball_settings`
 *                      + the `bb*` columns (bbWaiversEnabled, bbFaEnabled, bbTradesEnabled, …).
 *   Guilly + Best Ball `guillotineMode: true` (+ `leagueType: 'guillotine'`) + `settings.best_ball: true`.
 *                      `bestBallMode` is false ON PURPOSE (lib/guillotine/guillotineBestBall.ts) and it has
 *                      no `best_ball_settings` block and no `bb*` values.
 *
 * Both run the same optimizer, and a lineup save is refused in both (`lineupSetsItself`). But a reader that
 * asked `bestBallMode` alone answered "manual lineup" for Guilly + Best Ball: it sent that manager start/sit
 * action items, AI start/sit advice and Chimmy "bench him" evidence for a lineup they cannot set
 * (docs/audits/best-ball-guilly-audit-2026-11-06.md rows 45–46). This module is what such a reader asks.
 *
 * NO SCHEMA CHANGE AND NO DATA MIGRATION: both shapes stay as they are; only the reading is unified.
 *
 * What it answers, and where each half legitimately differs:
 *
 *   lineupSetsItself  The scoring test itself (lineupSetsItself, which scoringEngine.leagueIsBestBall
 *                     delegates to). An imported league carrying only the provider's `settings.best_ball`
 *                     flag is NOT one — its provider sets that lineup, and scoring reads its slots.
 *   scoringPeriod     `resolveBestBallScoringPeriod` for Classic. Guilly + Best Ball is weekly by
 *                     construction: a chop is decided on a week's (or a two-week period's) total, and it
 *                     has no `best_ball_settings` block that could choose daily.
 *   transactions      Classic native: its saved switches (`bbWaiversEnabled`, `bbFaEnabled`,
 *                     `bbTradesEnabled`; all default false = draft-only). Guilly + Best Ball: NO best ball
 *                     restriction (null). Its survivors must claim chopped rosters through waivers/FAAB
 *                     (lib/waiver-wire/season-phase-gate.ts), and its trades follow the guillotine rule
 *                     (`guillotineSettings.tradesAllowed`, off by default) in tradeSettingsResolver — a
 *                     Guilly rule, not a best ball one. An imported league: null; the platform decides.
 *   competition       Classic: tournament / cumulative / head_to_head. Guilly + Best Ball: 'guillotine'.
 */

import { isBestBallLeague } from '@/lib/autocoach/bestBallShared'
import { isBestBallGuillotine, lineupSetsItself } from '@/lib/guillotine/guillotineBestBall'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { resolveBestBallScoringPeriod, storedBestBallSettings, type BestBallScoringPeriodValue } from './scoringPeriod'

export type BestBallLeagueStateInput = {
  platform?: string | null
  sport?: string | null
  bestBallMode?: boolean | null
  leagueType?: string | null
  leagueVariant?: string | null
  guillotineMode?: boolean | null
  settings?: unknown
  bestBallVariant?: string | null
  bbMatchupFormat?: string | null
  bbWaiversEnabled?: boolean | null
  bbFaEnabled?: boolean | null
  bbTradesEnabled?: boolean | null
}

/** Which saved shape the league is: Classic Best Ball, Guilly + Best Ball, or neither. */
export type BestBallLeagueShape = 'classic' | 'guillotine' | null

export type BestBallTransactionPolicy = {
  /** Waiver claims. null = best ball imposes nothing; the league's other rules decide. */
  waivers: boolean | null
  /** Instant free-agent adds. null = as above. */
  freeAgency: boolean | null
  /** Trades. null = as above. */
  trades: boolean | null
}

export type BestBallCompetition = 'tournament' | 'cumulative' | 'head_to_head' | 'guillotine'

export type BestBallLeagueState = {
  shape: BestBallLeagueShape
  /** The league scores the best lineup and refuses lineup saves — the one lineup-mode answer. */
  lineupSetsItself: boolean
  /** Null when the league is not best ball. */
  scoringPeriod: BestBallScoringPeriodValue | null
  transactions: BestBallTransactionPolicy
  /** Null when the league is not best ball. */
  competition: BestBallCompetition | null
}

const NO_POLICY: BestBallTransactionPolicy = { waivers: null, freeAgency: null, trades: null }

function isClassicShape(league: BestBallLeagueStateInput): boolean {
  if (isBestBallGuillotine(league)) return false
  // The guillotine guard mirrors season-phase-gate: a guillotine-flagged row is never Classic, even if
  // both flags were ever set on it.
  if (league.guillotineMode === true) return false
  if (`${league.leagueVariant ?? ''} ${league.leagueType ?? ''}`.toLowerCase().includes('guillotine')) return false
  return isBestBallLeague(league.leagueVariant, league.bestBallMode) || isBestBallLeague(league.leagueType)
}

function classicCompetition(league: BestBallLeagueStateInput): BestBallCompetition {
  const bb = storedBestBallSettings(league.settings)
  if (bb?.contestStructure === 'tournament' || bb?.tournamentEnabled === true || league.bestBallVariant === 'tournament') {
    return 'tournament'
  }
  const format = typeof bb?.matchupFormat === 'string' ? bb.matchupFormat : league.bbMatchupFormat
  return format === 'cumulative' ? 'cumulative' : 'head_to_head'
}

export function resolveBestBallLeagueState(league: BestBallLeagueStateInput | null | undefined): BestBallLeagueState {
  if (!league) return { shape: null, lineupSetsItself: false, scoringPeriod: null, transactions: NO_POLICY, competition: null }
  const setsItself = lineupSetsItself(league)
  if (isBestBallGuillotine(league)) {
    return { shape: 'guillotine', lineupSetsItself: setsItself, scoringPeriod: 'weekly', transactions: NO_POLICY, competition: 'guillotine' }
  }
  if (isClassicShape(league)) {
    const native = resolveWriteAuthority(league.platform) === 'NATIVE'
    return {
      shape: 'classic',
      lineupSetsItself: setsItself,
      scoringPeriod: resolveBestBallScoringPeriod(league),
      transactions: native
        ? {
            waivers: league.bbWaiversEnabled === true,
            freeAgency: league.bbFaEnabled === true,
            trades: league.bbTradesEnabled === true,
          }
        : NO_POLICY,
      competition: classicCompetition(league),
    }
  }
  return { shape: null, lineupSetsItself: setsItself, scoringPeriod: null, transactions: NO_POLICY, competition: null }
}

/** Shorthand for the lineup-mode question, for readers that hold only the row. */
export function bestBallLineupSetsItself(league: BestBallLeagueStateInput | null | undefined): boolean {
  return resolveBestBallLeagueState(league).lineupSetsItself
}
