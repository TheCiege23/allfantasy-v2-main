/**
 * No "set your lineup" nags in a league whose lineup sets itself — a Classic Best Ball league or a best ball
 * Guilly league. Chimmy's lineup and slate-lock alerts already skip them (lib/chimmy-alerts/proactiveDelivery.ts
 * `isBestBallAudienceLeague` → lib/core-app/leagueBestBall.ts `isBestBallLeagueRow`); the commissioner's
 * lineup-reminder recipe and the AI commissioner's LINEUP_REMINDER alert did not. Both now read the same helper.
 * Mocks only: no league chat post and no notification is sent by any of this.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { league: {} as Record<string, unknown> }
  const prisma = {
    league: { findUnique: vi.fn(async () => state.league) },
    leagueTeam: { findMany: vi.fn(async () => []) },
    roster: { findMany: vi.fn(async () => []) },
    leagueChatMessage: { findMany: vi.fn(async () => []) },
    sportsGame: { findMany: vi.fn(async () => []) },
    waiverClaim: { count: vi.fn(async () => 0) },
    matchupFact: { findFirst: vi.fn(async () => null) },
    leagueTrade: { findMany: vi.fn(async () => []) },
  }
  return { state, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/commissioner-hub/managerHealth', () => ({ getLeagueManagerHealth: vi.fn(async () => null) }))
vi.mock('@/lib/league-history/leagueWarehouseReads', () => ({
  readActivityWindow: vi.fn(async () => null),
  readManagerActivity: vi.fn(async () => null),
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: vi.fn() }))

import { dueRecipeMessages, recipeCatalogEntry, RECIPES, type RecipeFacts } from '@/lib/core-app/commissioner/recipes'
import { commissionerToolsMessages } from '@/lib/core-app/messages/commissionerTools'
import { readRecipeFacts } from '@/lib/automation/jobs/commissioner/runCommissionerRecipesJob'
import { generateCommissionerAlerts } from '@/lib/ai-commissioner/CommissionerAlertGenerator'
import { analyzeLeagueGovernance } from '@/lib/ai-commissioner/LeagueGovernanceAnalyzer'
import type { GovernanceAnalysis } from '@/lib/ai-commissioner/types'

const NOW = new Date('2026-10-11T12:00:00Z') // Sunday, 8am ET, an NFL game day
const allOn = { lineupReminder: true, weeklyRecap: true, inactivityWarning: true, votingDeadline: true, playoffAnnouncement: true }
const facts = (over: Partial<RecipeFacts> = {}): RecipeFacts => ({
  now: NOW,
  leagueName: 'Dragons',
  sport: 'NFL',
  platform: 'manual',
  status: 'in_season',
  season: 2026,
  currentWeek: 6,
  playoffStartWeek: 15,
  playoffSpots: 4,
  kickoffs: [new Date('2026-10-11T17:00:00Z')],
  emptyLineups: [{ name: 'Holes', empty: 2 }],
  inactiveTeams: ['Ghost Town'],
  dataStale: false,
  polls: [],
  standings: [],
  ...over,
})

const CLASSIC = { bestBallMode: true, leagueVariant: null, leagueType: 'redraft', settings: {} }
const CLASSIC_BY_TYPE = { bestBallMode: false, leagueVariant: null, leagueType: 'best_ball', settings: {} }
const GUILLY_BB = { bestBallMode: false, leagueVariant: 'guillotine', leagueType: 'guillotine', guillotineMode: true, settings: { best_ball: true } }
const NORMAL = { bestBallMode: false, leagueVariant: null, leagueType: 'redraft', settings: {} }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the commissioner lineup-reminder recipe', () => {
  it('posts nothing for a best ball league, and still posts the other recipes', () => {
    const due = dueRecipeMessages(allOn, facts({ bestBall: true }))
    expect(due.map((d) => d.recipe)).toEqual(['inactivityWarning'])
  })

  it('still reminds a league whose managers set lineups (control)', () => {
    expect(dueRecipeMessages(allOn, facts({ bestBall: false })).map((d) => d.recipe)).toEqual(['lineupReminder', 'inactivityWarning'])
    expect(dueRecipeMessages(allOn, facts()).map((d) => d.recipe)).toEqual(['lineupReminder', 'inactivityWarning'])
  })

  it('shows as unavailable in the hub catalog for a best ball league, worded in the reader\'s language', () => {
    const recipe = RECIPES.find((r) => r.key === 'lineupReminder')!
    expect(recipeCatalogEntry(recipe, { platform: 'manual', sport: 'NFL', bestBall: true }).unavailable).toBe(
      commissionerToolsMessages.en.recipesUnavailableBestBall,
    )
    expect(recipeCatalogEntry(recipe, { platform: 'manual', sport: 'NFL', bestBall: true }, 'es').unavailable).toBe(
      commissionerToolsMessages.es.recipesUnavailableBestBall,
    )
    expect(recipeCatalogEntry(recipe, { platform: 'manual', sport: 'NFL', bestBall: false }).unavailable).toBeNull()
    // Only the lineup recipe: the recap and the playoff post still make sense in best ball.
    const playoff = RECIPES.find((r) => r.key === 'playoffAnnouncement')!
    expect(recipeCatalogEntry(playoff, { platform: 'manual', sport: 'NFL', bestBall: true }).unavailable).toBeNull()
  })

  it.each([
    ['Classic Best Ball (column)', CLASSIC, true],
    ['Classic Best Ball (leagueType)', CLASSIC_BY_TYPE, true],
    ['best ball Guilly', GUILLY_BB, true],
    ['a normal league', NORMAL, false],
  ])('the job reads %s (%j) as bestBall=%s', async (_label, row, expected) => {
    h.state.league = { id: 'L', name: 'Dragons', userId: 'owner', platform: 'manual', sport: 'NFL', status: 'in_season', season: 2026, starters: null, lastSyncedAt: null, ...row }
    const loaded = await readRecipeFacts('L', NOW)
    expect(loaded?.facts.bestBall).toBe(expected)
  })
})

describe('the AI commissioner LINEUP_REMINDER alert', () => {
  const analysis = (over: Partial<GovernanceAnalysis> = {}): GovernanceAnalysis => ({
    leagueId: 'L', sport: 'NFL' as GovernanceAnalysis['sport'], season: 2026, pendingWaiverClaims: 0,
    inactiveManagers: [], tradeDisputes: [], collusionSignals: [], ruleConflicts: [],
    scheduleContext: { currentPeriod: 13, playoffStartPeriod: 15, periodsUntilPlayoffs: 2, lockReminderHours: 2 },
    ...over,
  })
  const config = { remindersEnabled: true, inactivityMonitoringEnabled: false, disputeAnalysisEnabled: false, collusionMonitoringEnabled: false } as never
  const types = (a: GovernanceAnalysis) => generateCommissionerAlerts({ analysis: a, config }).map((s) => s.alertType)

  it('is not generated for a best ball league; the playoff deadline reminder still is', () => {
    expect(types(analysis({ bestBall: true }))).toEqual(['PLAYOFF_DEADLINE_REMINDER'])
  })

  it('is still generated for a league with manual lineups (control)', () => {
    expect(types(analysis({ bestBall: false }))).toEqual(['LINEUP_REMINDER', 'PLAYOFF_DEADLINE_REMINDER'])
    expect(types(analysis())).toEqual(['LINEUP_REMINDER', 'PLAYOFF_DEADLINE_REMINDER'])
  })

  it.each([
    ['Classic Best Ball (column)', CLASSIC, true],
    ['Classic Best Ball (leagueType)', CLASSIC_BY_TYPE, true],
    ['best ball Guilly', GUILLY_BB, true],
    ['a normal league', NORMAL, false],
  ])('the governance analysis reads %s (%j) as bestBall=%s', async (_label, row, expected) => {
    h.state.league = { id: 'L', sport: 'NFL', season: 2026, platformLeagueId: 'p', teams: [], ...row }
    const a = await analyzeLeagueGovernance({ leagueId: 'L', sport: 'NFL', season: 2026 })
    expect(a.bestBall).toBe(expected)
  })
})
