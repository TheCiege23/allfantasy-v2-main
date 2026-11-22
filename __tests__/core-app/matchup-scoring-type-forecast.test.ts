// @vitest-environment node
/**
 * 🛑 A CATEGORY OR ROTO LEAGUE GETS NO POINTS PROJECTION AND NO WIN PROBABILITY ON /core/matchup.
 *
 * `weeklyFormat` reads a league's scoring type (incl. Fantrax's `fantrax_settings.scoringSystem.type`),
 * and the week board and Season Outlook already withhold head-to-head points odds for anything that
 * is not head-to-head points. The one-league Matchup screen did not consult it, so a categories or
 * rotisserie league was handed a projected final and a win chance computed from fantasy points the
 * league does not score by.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeagueContext } from '@/lib/core-app/leagueContext'
import { matchupReasonText } from '@/lib/core-app/matchupReasonText'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, leagueType: null as string | null }))

vi.mock('@/lib/prisma', () => {
  const fallback = (method: string) =>
    method === 'count' ? 0 : method === 'findMany' || method === 'groupBy' ? [] : null
  const answers: Record<string, (args: any) => unknown> = {
    'weeklyMatchup.findMany': () => [
      { rosterId: '1', matchupId: 7, pointsFor: 0, pointsAgainst: 0, win: null },
      { rosterId: '2', matchupId: 7, pointsFor: 0, pointsAgainst: 0, win: null },
    ],
    'leagueTeam.findMany': () => [
      { externalId: '1', teamName: 'Mine', ownerName: 'me', wins: 0, losses: 0, ties: 0, platformUserId: 'u1', avatarUrl: null },
      { externalId: '2', teamName: 'Theirs', ownerName: 'them', wins: 0, losses: 0, ties: 0, platformUserId: 'u2', avatarUrl: null },
    ],
  }
  const modelProxy = (model: string) =>
    new Proxy({}, { get: (_t, method: string) => vi.fn(async (args: unknown) => (answers[`${model}.${method}`] ?? (() => fallback(method)))(args)) })
  const prisma = new Proxy({}, {
    get: (_t, key: string) => {
      if (key.startsWith('$query') || key.startsWith('$execute')) return vi.fn(async () => [])
      if (key === 'then') return undefined
      return modelProxy(key)
    },
  })
  return { prisma, default: prisma }
})

vi.mock('@/lib/core-app/currentWeek', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveCurrentWeekForLeague: vi.fn(async () => ({ seasonYear: 2026, week: 3 })),
}))
vi.mock('@/lib/core-app/finishedNflWeeks', () => ({ loadFinishedNflWeeks: vi.fn(async () => new Set()) }))
/* Both lineups fully priced, nothing banked: a head-to-head points league gets a forecast from this. */
vi.mock('@/lib/core-app/matchupWinInputs', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  loadMatchupSides: vi.fn(async () => {
    const side = (id: string, pts: number) => ({
      starters: [{ playerId: id, projectedPoints: pts, actualPoints: 0, isFinal: false }],
      unprojected: 0,
      projectedRemaining: pts,
      lineup: [{ playerId: id, projected: pts, afEngine: pts + 1 }],
    })
    return { you: side('1001', 20), opponent: side('2002', 15), leagueScoring: { available: true }, atRiskBySleeperId: {} }
  }),
}))

import { getMatchupData } from '@/lib/core-app/matchup'

const context = () =>
  ({
    leagueId: 'L',
    userId: 'u',
    league: async () => ({
      id: 'L', name: 'Cats', platform: 'fantrax', platformLeagueId: 'p1', sport: 'NFL', season: 2026, status: 'in_season',
      leagueType: db.leagueType, settings: db.settings,
    }),
    claimedTeam: async () => ({ externalId: '1', platformUserId: 'u1' }),
    claimedTeams: async () => [],
  }) as unknown as LeagueContext

beforeEach(() => {
  db.settings = {}
  db.leagueType = null
})

describe('Matchup — points forecast only for head-to-head points leagues', () => {
  it('control: a head-to-head points league IS given a projected final and a win probability', async () => {
    db.settings = { fantrax_settings: { scoringSystem: { type: 'HEAD_TO_HEAD_POINTS_BASED' } } }
    const data = await getMatchupData('L', 'u', null, context())
    expect(data?.projectedFinal.available).toBe(true)
    expect(data?.winProbability.available).toBe(true)
    const slot = data?.lineups.available ? data.lineups.data[0] : null
    expect(slot?.you?.projected).toBe(20)
    expect(slot?.you?.afEngine).toBe(21)
    expect(slot?.opponent?.projected).toBe(15)
  })

  it.each([
    ['Fantrax categories', { fantrax_settings: { scoringSystem: { type: 'HEAD_TO_HEAD_CATEGORIES' } } }, null],
    ['Fantrax roto', { fantrax_settings: { scoringSystem: { type: 'ROTISSERIE' } } }, null],
    ['a categories league type', {}, 'h2h_category'],
  ])('🛑 %s gets neither, with a reason the screen can say in both languages', async (_label, settings, leagueType) => {
    db.settings = settings
    db.leagueType = leagueType
    const data = await getMatchupData('L', 'u', null, context())
    expect(data?.projectedFinal.available).toBe(false)
    expect(data?.winProbability.available).toBe(false)
    const reason = data?.winProbability.available === false ? data.winProbability.reason : ''
    expect(data?.projectedFinal.available === false ? data.projectedFinal.reason : '').toBe(reason)
    expect(reason).toMatch(/scoring type/)
    /* Translated, not passed through in English. */
    expect(matchupReasonText(reason, 'es')).not.toBe(reason)
    /* The matchup itself — who you play — is still shown. */
    expect(data?.teams.available).toBe(true)
    /*
     * 🛑 AND NO PER-PLAYER POINTS PROJECTION EITHER. Withholding the projected final while every
     * starter's cell still showed a points projection left the same claim on screen one row down.
     * The lineup itself — who starts where — is still shown.
     */
    expect(data?.lineups.available).toBe(true)
    const slot = data?.lineups.available ? data.lineups.data[0] : null
    expect(slot?.you?.playerId).toBe('1001')
    expect(slot?.you?.projected).toBeNull()
    expect(slot?.you?.afEngine ?? null).toBeNull()
    expect(slot?.opponent?.projected).toBeNull()
    expect(slot?.opponent?.afEngine ?? null).toBeNull()
    /* Nor may the per-player note claim each column is a projection. */
    expect(data?.playerScoring.available === false ? data.playerScoring.reason : '').toBe(reason)
  })
})
