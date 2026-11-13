/**
 * Audit rows 45–46 (docs/audits/best-ball-guilly-audit-2026-11-06.md): Classic Best Ball and Guilly + Best
 * Ball are saved in different shapes, and readers that asked one shape's fields answered wrong for the other.
 * Both shapes run through the read model and through every repointed reader that is testable without a DB.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn(), runStartSit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany: db.findMany, findFirst: db.findFirst } } }))
vi.mock('@/lib/ai-tools-start-sit/runStartSitAnalysis', () => ({ runStartSitAnalysis: db.runStartSit }))
vi.mock('server-only', () => ({}))

import { resolveBestBallLeagueState, bestBallLineupSetsItself } from '@/lib/bestball/bestBallLeagueState'
import { decisionFormatBlock } from '@/lib/chimmy/decisionFormatGate'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { resolveBestBallRosterPolicy } from '@/lib/waiver-wire/season-phase-gate'
import { classifyLeagueFormat } from '@/lib/core-app/portfolioClassify'
import { fetchAiStartSitLineupSignalsForUser } from '@/lib/lineup-actions/aiStartSitLineupSignals'
import type { League } from '@prisma/client'
import { normalizeBestBallSettings, buildBestBallSettingsSummary } from '@/lib/bestball/rules'
import { bestBallRulesSummary } from '@/lib/create-league-v2/bestBallWizard'

/** What `POST /api/leagues` saves for Classic Best Ball (createCanonicalLeagueInTransaction.ts). */
const CLASSIC = {
  id: 'classic', name: 'Classic', platform: 'manual', sport: 'NBA', isDynasty: false,
  leagueType: 'best_ball', leagueVariant: null, bestBallMode: true, guillotineMode: false,
  bestBallVariant: 'standard', bbMatchupFormat: 'h2h',
  bbWaiversEnabled: false, bbFaEnabled: false, bbTradesEnabled: false, lockAllMoves: false,
  settings: { best_ball_settings: { contestStructure: 'season_long', matchupFormat: 'h2h', scoringPeriod: 'weekly', waiversEnabled: false, tradesEnabled: false } },
}
/** What it saves for Guilly + Best Ball: the settings flag, never the column, no bb* values. */
const GUILLY = {
  id: 'guilly', name: 'Guilly', platform: 'manual', sport: 'NBA', isDynasty: false,
  leagueType: 'guillotine', leagueVariant: null, bestBallMode: false, guillotineMode: true,
  bestBallVariant: 'standard', bbMatchupFormat: 'h2h',
  bbWaiversEnabled: false, bbFaEnabled: false, bbTradesEnabled: false, lockAllMoves: false,
  settings: { best_ball: true },
}
const PLAIN_GUILLY = { ...GUILLY, id: 'plain-guilly', settings: {} }
const REDRAFT = { ...CLASSIC, id: 'redraft', leagueType: 'redraft', bestBallMode: false, settings: {} }

const asLeague = (l: object) => l as unknown as League

describe('resolveBestBallLeagueState — both saved shapes', () => {
  it.each([
    ['Classic', CLASSIC, { shape: 'classic', lineupSetsItself: true, scoringPeriod: 'weekly', competition: 'head_to_head',
      transactions: { waivers: false, freeAgency: false, trades: false } }],
    ['Guilly + Best Ball', GUILLY, { shape: 'guillotine', lineupSetsItself: true, scoringPeriod: 'weekly', competition: 'guillotine',
      transactions: { waivers: null, freeAgency: null, trades: null } }],
    ['plain Guilly', PLAIN_GUILLY, { shape: null, lineupSetsItself: false, scoringPeriod: null, competition: null,
      transactions: { waivers: null, freeAgency: null, trades: null } }],
    ['redraft', REDRAFT, { shape: null, lineupSetsItself: false, scoringPeriod: null, competition: null,
      transactions: { waivers: null, freeAgency: null, trades: null } }],
  ])('%s', (_label, league, expected) => {
    expect(resolveBestBallLeagueState(league)).toEqual(expected)
  })

  it('Classic reads its waiver/FA switches, daily period and competition — and trades stay OFF even when saved on', () => {
    const s = resolveBestBallLeagueState({
      ...CLASSIC, bbWaiversEnabled: true, bbFaEnabled: false, bbTradesEnabled: true,
      settings: { best_ball_settings: { scoringPeriod: 'daily', dailyBestBall: true, matchupFormat: 'cumulative' } },
    })
    expect(s.transactions).toEqual({ waivers: true, freeAgency: false, trades: false })
    expect(s.scoringPeriod).toBe('daily')
    expect(s.competition).toBe('cumulative')
    expect(resolveBestBallLeagueState({ ...CLASSIC, settings: { best_ball_settings: { contestStructure: 'tournament' } } }).competition).toBe('tournament')
  })

  it('an imported Classic league has no AllFantasy transaction policy (the platform decides)', () => {
    expect(resolveBestBallLeagueState({ ...CLASSIC, platform: 'sleeper', bbTradesEnabled: true }).transactions)
      .toEqual({ waivers: null, freeAgency: null, trades: null })
  })

  it('an imported league with only the provider flag is not one whose lineup AllFantasy sets', () => {
    expect(bestBallLineupSetsItself({ platform: 'sleeper', leagueType: 'redraft', settings: { best_ball: 1 } })).toBe(false)
  })

  it('a row with both flags is never Classic (the guillotine guard)', () => {
    expect(resolveBestBallLeagueState({ ...CLASSIC, guillotineMode: true }).shape).toBe(null)
  })
})

describe('repointed readers answer the same for both shapes', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([['Classic', CLASSIC], ['Guilly + Best Ball', GUILLY]])(
    'Chimmy refuses a start/sit decision (decisionFormatGate) — %s', (_l, league) => {
      expect(decisionFormatBlock({ ...league, bestBallMode: league.bestBallMode }, 'lineup')?.code).toBe('best_ball_auto_lineup')
    },
  )

  it('Chimmy still answers start/sit in a plain Guilly or redraft league', () => {
    expect(decisionFormatBlock(PLAIN_GUILLY, 'lineup')).toBeNull()
    expect(decisionFormatBlock(REDRAFT, 'lineup')).toBeNull()
  })

  it.each([['Classic', CLASSIC], ['Guilly + Best Ball', GUILLY]])(
    'the portfolio best ball filter finds the league — %s', (_l, league) => {
      expect(classifyLeagueFormat(league).bestBall).toBe(true)
    },
  )

  it.each([['Classic', CLASSIC], ['Guilly + Best Ball', GUILLY]])(
    'the Lineups action center does not run start/sit for the league — %s', async (_l, league) => {
      process.env.LINEUP_ACTION_START_SIT_SIGNALS = '1'
      db.findMany.mockResolvedValue([league])
      db.runStartSit.mockResolvedValue({ ok: false })
      const out = await fetchAiStartSitLineupSignalsForUser('u1', {} as never)
      expect(out).toEqual([])
      expect(db.runStartSit).not.toHaveBeenCalled()
    },
  )

  it('…but it does for a plain Guilly league (control: the env switch is on)', async () => {
    process.env.LINEUP_ACTION_START_SIT_SIGNALS = '1'
    db.findMany.mockResolvedValue([PLAIN_GUILLY])
    db.runStartSit.mockResolvedValue({ ok: false })
    await fetchAiStartSitLineupSignalsForUser('u1', {} as never)
    expect(db.runStartSit).toHaveBeenCalledTimes(1)
  })
})

describe('transaction policy — where Guilly legitimately keeps its own rule', () => {
  it('waivers/FA: Classic applies its saved switches; Guilly + Best Ball gets none (survivors claim chopped rosters)', () => {
    expect(resolveBestBallRosterPolicy(CLASSIC)).toEqual({ waiversEnabled: false, freeAgencyEnabled: false })
    expect(resolveBestBallRosterPolicy({ ...CLASSIC, bbWaiversEnabled: true, bbFaEnabled: true })).toEqual({ waiversEnabled: true, freeAgencyEnabled: true })
    expect(resolveBestBallRosterPolicy(GUILLY)).toBeNull()
    expect(resolveBestBallRosterPolicy({ ...CLASSIC, platform: 'sleeper' })).toBeNull()
  })

  it('trades: Classic is off by default', () => {
    expect(resolveLeagueTradeSettings(asLeague(CLASSIC)).tradesAllowed).toBe(false)
  })

  it('🛑 trades: Classic stays OFF even for a league that saved bbTradesEnabled=true (owner 2026-11-07)', () => {
    // Best ball scoring does not split a traded player's week (audit "Ownership history").
    const saved = { ...CLASSIC, bbTradesEnabled: true, settings: { best_ball_settings: { tradesEnabled: true } } }
    expect(resolveLeagueTradeSettings(asLeague(saved)).tradesAllowed).toBe(false)
    expect(resolveBestBallLeagueState(saved).transactions.trades).toBe(false)
  })

  it('every reader of the normalized settings says trades are off, whatever was stored', () => {
    const bb = normalizeBestBallSettings({ sport: 'NFL', conceptSetup: { bestBall: { tradesEnabled: true, waiversEnabled: true } } })
    expect(bb.tradesEnabled).toBe(false)
    expect(bb.waiversEnabled).toBe(true)
    expect(buildBestBallSettingsSummary(bb)).toContain('trades off')
    expect(buildBestBallSettingsSummary(bb)).not.toContain('trades on')
  })

  it.each([true, false])('the creation review never says trades are allowed (waivers %s, stale tradesEnabled true)', (waiversEnabled) => {
    const bb = { ...normalizeBestBallSettings({ sport: 'NFL' }), waiversEnabled, tradesEnabled: true }
    const line = bestBallRulesSummary(bb as never, 'NFL', 12).find((l) => l.id === 'transactions')!
    expect(line.text).not.toMatch(/trades are allowed/i)
    expect(line.text).toMatch(/trades are off|no trades/i)
  })

  it('trades: an imported Classic league is not AllFantasy-gated', () => {
    expect(resolveLeagueTradeSettings(asLeague({ ...CLASSIC, platform: 'sleeper' })).tradesAllowed).toBe(true)
  })

  it('trades: Guilly + Best Ball follows the guillotine rule (off unless the Guilly settings allow), not bbTradesEnabled', () => {
    expect(resolveLeagueTradeSettings(asLeague({ ...GUILLY, bbTradesEnabled: true })).tradesAllowed).toBe(false)
    expect(resolveLeagueTradeSettings(asLeague({ ...GUILLY, settings: { best_ball: true, guillotineSettings: { tradesAllowed: true } } })).tradesAllowed).toBe(true)
  })
})
