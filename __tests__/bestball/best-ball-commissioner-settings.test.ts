/**
 * PATCH /api/bestball/settings — what a commissioner may change, when, and what it leaves behind.
 *
 * Audit 2026-11: the route had a role check and nothing else. No lifecycle lock (only tournament
 * structure froze, and only once a contest existed); no change history; playoff and season-length edits
 * reached only the JSON, never `League.playoffTeams` / `playoffStartWeek`, which the playoff resolver
 * reads first — so they did nothing; it could relabel a league "tournament" with no contest; and it
 * accepted more playoff teams than the league has.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  role: vi.fn(),
  leagueFindUnique: vi.fn(),
  leagueUpdate: vi.fn(),
  draftSessionFindFirst: vi.fn(),
  seasonFindFirst: vi.fn(),
  auditCreate: vi.fn(),
  publish: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: m.role }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.leagueFindUnique, update: m.leagueUpdate },
    draftSession: { findFirst: m.draftSessionFindFirst },
    redraftSeason: { findFirst: m.seasonFindFirst },
    leagueAuditLog: { create: m.auditCreate },
  },
}))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: m.publish }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true })) }))
vi.mock('@/lib/bestball/nativeBestBallTabLoad', () => ({
  loadNativeBestBallTab: vi.fn(async () => ({ season: 2026, body: { selectedWeek: 1, weeksAvailable: [], lineups: [], rosterComposition: [], standings: [], history: [] } })),
}))

import { PATCH } from '@/app/api/bestball/settings/route'
import { GET } from '@/app/api/leagues/[leagueId]/bestball/handler'

function league(over: Record<string, unknown> = {}, bestBall: Record<string, unknown> = {}) {
  return {
    id: 'L1',
    sport: 'NBA',
    leagueSize: 10,
    bestBallMode: true,
    bbContestId: null,
    bbWaiversEnabled: false,
    bbTradesEnabled: false,
    bbFaEnabled: false,
    bbIrEnabled: false,
    bbTaxiEnabled: false,
    playoffTeams: 6,
    playoffStartWeek: 22,
    playoffWeeksPerRound: 1,
    playoffSeedingRule: 'record_then_points',
    settings: {
      canonical_draft_mode: 'snake',
      playoff_structure: { playoff_start_week: 22 },
      best_ball_settings: {
        mode: 'standard',
        contestStructure: 'season_long',
        matchupFormat: 'h2h',
        playoffFormat: 'bracket',
        playoffTeams: 6,
        regularSeasonLength: 21,
        scoringPeriod: 'weekly',
        dailyBestBall: false,
        ...bestBall,
      },
    },
    ...over,
  }
}

const patch = (body: Record<string, unknown>) =>
  PATCH(new Request('http://localhost/api/bestball/settings', { method: 'PATCH', body: JSON.stringify({ leagueId: 'L1', ...body }) }) as never)

function drafted(started: boolean) {
  m.draftSessionFindFirst.mockResolvedValue(started ? { id: 'ds1' } : null)
}

beforeEach(() => {
  vi.resetAllMocks()
  m.session.mockResolvedValue({ user: { id: 'commish' } })
  m.role.mockResolvedValue(undefined)
  m.seasonFindFirst.mockResolvedValue(null)
  m.auditCreate.mockResolvedValue({ id: 'a1' })
  m.publish.mockResolvedValue(undefined)
  m.leagueUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'L1', ...data }))
  m.leagueFindUnique.mockResolvedValue(league())
  drafted(false)
})

describe('after the draft has started', () => {
  beforeEach(() => drafted(true))

  it.each([
    ['scoring period', { bestBall: { scoringPeriod: 'daily' } }],
    ['playoff teams', { bestBall: { playoffTeams: 4 } }],
    ['regular season length', { bestBall: { regularSeasonLength: 18 } }],
    ['scoring model', { bestBall: { matchupFormat: 'cumulative' } }],
    ['lineup', { bestBall: { lineupTemplateId: 'other' } }],
  ])('refuses a change to the %s, and writes nothing', async (label, body) => {
    const res = await patch(body)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toContain(label)
    expect(json.error).toMatch(/after the draft has started/)
    expect(m.leagueUpdate).not.toHaveBeenCalled()
    expect(m.auditCreate).not.toHaveBeenCalled()
  })

  it('still lets transactions change, and records it', async () => {
    const res = await patch({ bbTradesEnabled: true, bbFaEnabled: true, bestBall: { substitutionsEnabled: true } })
    expect(res.status).toBe(200)
    expect(m.leagueUpdate.mock.calls[0]![0].data).toMatchObject({ bbTradesEnabled: true, bbFaEnabled: true })
    const audit = m.auditCreate.mock.calls[0]![0].data
    expect(audit).toMatchObject({ leagueId: 'L1', userId: 'commish', actionType: 'settings_patch', entityType: 'league' })
    expect(audit.afterState).toEqual({ substitutionsEnabled: true, bbTradesEnabled: true, bbFaEnabled: true })
    expect(audit.beforeState).toEqual({ substitutionsEnabled: false, bbTradesEnabled: false, bbFaEnabled: false })
  })

  it('a save that resends every unchanged field (the panel does) is not a locked change', async () => {
    const res = await patch({
      bbWaiversEnabled: false,
      bbTradesEnabled: true,
      bestBall: { mode: 'standard', contestStructure: 'season_long', matchupFormat: 'h2h', playoffFormat: 'bracket', scoringPeriod: 'weekly', playoffTeams: 6, regularSeasonLength: 21 },
    })
    expect(res.status).toBe(200)
  })

  it('a legacy league whose stored "daily" was only the old default saves as weekly without tripping the lock', async () => {
    m.leagueFindUnique.mockResolvedValue(league({}, { scoringPeriod: 'daily', dailyBestBall: undefined }))
    const res = await patch({ bbTradesEnabled: true, bestBall: { scoringPeriod: 'weekly' } })
    expect(res.status).toBe(200)
    const data = m.leagueUpdate.mock.calls[0]![0].data
    expect(data.bbScoringPeriod).toBe('weekly')
    expect(data.settings.best_ball_settings).toMatchObject({ scoringPeriod: 'weekly', dailyBestBall: false })
  })
})

describe('before the draft', () => {
  it('switches an NBA league to daily best ball and records the change', async () => {
    const res = await patch({ bestBall: { scoringPeriod: 'daily' } })
    expect(res.status).toBe(200)
    const data = m.leagueUpdate.mock.calls[0]![0].data
    expect(data.bbScoringPeriod).toBe('daily')
    expect(data.settings.best_ball_settings).toMatchObject({ scoringPeriod: 'daily', dailyBestBall: true })
    const audit = m.auditCreate.mock.calls[0]![0].data
    expect(audit.beforeState).toEqual({ scoringPeriod: 'weekly' })
    expect(audit.afterState).toEqual({ scoringPeriod: 'daily' })
    expect(audit.metadata).toMatchObject({ updatedFields: ['scoringPeriod'] })
  })

  it('writes no audit row for a save that changed nothing', async () => {
    const res = await patch({ bestBall: { scoringPeriod: 'weekly' } })
    expect(res.status).toBe(200)
    expect(m.auditCreate).not.toHaveBeenCalled()
    expect(m.publish).not.toHaveBeenCalled()
  })

  it('refuses daily for a sport without daily stats, and for a tournament', async () => {
    m.leagueFindUnique.mockResolvedValue(league({ sport: 'NFL' }))
    expect((await patch({ bestBall: { scoringPeriod: 'daily' } })).status).toBe(400)
    m.leagueFindUnique.mockResolvedValue(league({ bbContestId: 'c1' }, { contestStructure: 'tournament', tournamentAdvancementRounds: 1 }))
    expect((await patch({ bestBall: { scoringPeriod: 'daily' } })).status).toBe(400)
    expect(m.leagueUpdate).not.toHaveBeenCalled()
  })

  it('playoff and season-length edits reach the columns the resolver reads first, and every JSON copy', async () => {
    const res = await patch({ bestBall: { playoffTeams: 4, regularSeasonLength: 18 } })
    expect(res.status).toBe(200)
    const data = m.leagueUpdate.mock.calls[0]![0].data
    expect(data).toMatchObject({ playoffTeams: 4, playoffStartWeek: 19 })
    expect(data.settings.playoff_structure.playoff_start_week).toBe(19)
    expect(data.settings.best_ball_settings).toMatchObject({ playoffTeams: 4, regularSeasonLength: 18 })
    // And the league home's "What changed" card hears about the playoff columns.
    expect(m.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'L1',
        changes: expect.arrayContaining([
          { key: 'playoffTeams', before: 6, after: 4 },
          { key: 'playoffStartWeek', before: 22, after: 19 },
        ]),
      }),
    )
  })

  it('a transaction-only save leaves the playoff columns alone', async () => {
    await patch({ bbTradesEnabled: true })
    const data = m.leagueUpdate.mock.calls[0]![0].data
    expect(data).not.toHaveProperty('playoffTeams')
    expect(data).not.toHaveProperty('playoffStartWeek')
  })

  it('refuses more playoff teams than the league has', async () => {
    const res = await patch({ bestBall: { playoffTeams: 12 } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/cannot be more than the league's 10 teams/)
    expect(m.leagueUpdate).not.toHaveBeenCalled()
  })

  it('refuses to switch a league to tournament without its contest', async () => {
    const res = await patch({ bestBall: { contestStructure: 'tournament' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/set up when the league is created/)
    expect(m.leagueUpdate).not.toHaveBeenCalled()
  })
})

describe('GET /api/leagues/:id/bestball — what the panel loads', () => {
  const get = async () => {
    const res = await GET({ nextUrl: new URL('http://localhost/api/leagues/L1/bestball?week=1') } as never, { params: Promise.resolve({ leagueId: 'L1' }) })
    return (await res.json()) as { league: { settings: Record<string, unknown>; structureLock: string | null } }
  }

  it('a legacy league reads the weekly scoring it actually has, and the lock once the draft started', async () => {
    m.leagueFindUnique.mockResolvedValue({ ...league({}, { scoringPeriod: 'daily', dailyBestBall: undefined }), name: 'L', season: 2026, platform: 'manual', rosters: [], teams: [] })
    drafted(true)
    const body = await get()
    expect(body.league.settings.scoringPeriod).toBe('weekly')
    expect(body.league.structureLock).toBe('after the draft has started')
  })

  it('a daily league reads daily; pre-draft nothing is locked', async () => {
    m.leagueFindUnique.mockResolvedValue({ ...league({}, { scoringPeriod: 'daily', dailyBestBall: true }), name: 'L', season: 2026, platform: 'manual', rosters: [], teams: [] })
    const body = await get()
    expect(body.league.settings.scoringPeriod).toBe('daily')
    expect(body.league.structureLock).toBeNull()
  })
})

/*
 * Audit 2026-11-06, "Settings saved and never read": these were saved and nothing read them back, so a
 * commissioner could change them and the league behaved the same. The route now refuses each one, names
 * where the real setting lives, and writes nothing.
 */
describe('settings that were saved and never read', () => {
  it.each([
    ['bbIrEnabled', { bbIrEnabled: true }, /roster/],
    ['bbTaxiEnabled', { bbTaxiEnabled: true }, /no taxi/],
    ['bestBall.slowDraftClockMinutes', { bestBall: { slowDraftClockMinutes: 30 } }, /Draft settings/],
    ['bestBall.autoPickBehavior', { bestBall: { autoPickBehavior: 'best_available' } }, /Draft settings/],
    ['bestBall.allowCommissionerPause', { bestBall: { allowCommissionerPause: false } }, /draft room/],
    ['bestBall.allowCommissionerResume', { bestBall: { allowCommissionerResume: false } }, /draft room/],
    ['bestBall.allowCommissionerForcePick', { bestBall: { allowCommissionerForcePick: false } }, /draft room/],
    ['bestBall.draftDateUtc', { bestBall: { draftDateUtc: '2026-12-01T00:00:00.000Z' } }, /Draft settings/],
    ['bestBall.queueBehavior', { bestBall: { queueBehavior: 'strict' } }, /Queue first.*Draft settings/],
    ['bestBall.missedPickFallback', { bestBall: { missedPickFallback: 'commissioner' } }, /Autopick.*Draft settings/],
    ['bestBall.allowDuplicatePlayers', { bestBall: { allowDuplicatePlayers: true } }, /No such setting exists/],
  ])('refuses %s, names where it is really set, and writes nothing', async (field, body, hint) => {
    const res = await patch(body)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.field).toBe(field)
    expect(json.error).toMatch(hint)
    expect(m.leagueUpdate).not.toHaveBeenCalled()
    expect(m.auditCreate).not.toHaveBeenCalled()
  })

  it('refuses the field even when false (it would still be a no-op save)', async () => {
    const res = await patch({ bbTradesEnabled: true, bbIrEnabled: false })
    expect(res.status).toBe(400)
    expect(m.leagueUpdate).not.toHaveBeenCalled()
  })

  it('a save without them still lands, and never writes the IR / taxi columns', async () => {
    const res = await patch({ bbTradesEnabled: true, bestBall: { substitutionsEnabled: true } })
    expect(res.status).toBe(200)
    const data = m.leagueUpdate.mock.calls[0]![0].data
    expect(data).not.toHaveProperty('bbIrEnabled')
    expect(data).not.toHaveProperty('bbTaxiEnabled')
  })
})
