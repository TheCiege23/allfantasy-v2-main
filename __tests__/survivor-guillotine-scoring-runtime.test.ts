// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSGConfig } from '@/lib/survivor-guillotine/config'
const source = vi.hoisted(() => ({ load: vi.fn() }))
const db = vi.hoisted(() => ({
  survivorGuillotineLeague: { findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  league: { findUniqueOrThrow: vi.fn() }, redraftSeason: { findFirstOrThrow: vi.fn() },
  sportsDataCache: { findUnique: vi.fn() }, roster: { findMany: vi.fn() }, survivorGuillotineChop: { findMany: vi.fn() },
  survivorGuillotineDailyLineup: { findMany: vi.fn() }, teamWeekResult: { upsert: vi.fn() }, $transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/redraft/lineupHistory', () => ({ loadHistoricalPeriod: source.load }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ calculateScoreForLeague: (_league: unknown, stats: { pts?: number }) => stats.pts ?? 0,
  isScoringStarterSlot: (slot: string) => !['BENCH', 'BN'].includes(slot.toUpperCase()) }))
import { refreshSGScores } from '@/lib/survivor-guillotine/scoringService'

const config = { ...defaultSGConfig(), teamCount: 4, championshipPeriod: 2, gauntletPeriods: 0, mergedChopPeriods: 1 }
const dates = { scoringStartsAt: '2026-09-01T00:00:00Z', scoringEndsAt: '2026-09-08T00:00:00Z' }
const player = (id: string, slotType = 'QB') => ({ id, playerId: id, rosterId: `r${id}`, sport: 'NFL', position: 'QB', team: 'KC', slotType, droppedAt: null })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SG_PROVIDER_INGEST_ENABLED','false')
  db.survivorGuillotineLeague.findUniqueOrThrow.mockResolvedValue({ config, currentPeriod: 1, revision: 4, periodCalendar: { 1: dates } })
  db.survivorGuillotineLeague.updateMany.mockResolvedValue({ count: 1 })
  db.league.findUniqueOrThrow.mockResolvedValue({ id: 'L', sport: 'NFL', season: 2026, platform: 'allfantasy', leagueVariant: 'survivor_guillotine', settings: { lineup_history_version: 1 } })
  db.redraftSeason.findFirstOrThrow.mockResolvedValue({ id: 'season' })
  db.roster.findMany.mockResolvedValue(['1', '2', '3', '4'].map(id => ({ id, redraftRosterId: `r${id}` })))
  db.survivorGuillotineChop.findMany.mockResolvedValue([])
  db.survivorGuillotineDailyLineup.findMany.mockResolvedValue([])
  db.$transaction.mockImplementation(fn => fn(db))
  source.load.mockResolvedValue({ eligible: [player('1'), player('2')], missingPlayerIds: [], slateFinal: true, correctionsReady: true,
    contributions: [{ player: player('1'), stats: { pts: 10 }, gameId: 'g1' }, { player: player('2'), stats: { pts: 20 }, gameId: 'g2' }] })
})

afterEach(()=>vi.unstubAllEnvs())

describe('combined native scoring', () => {
  it('scores historical starter contributions, gives no invented opponents, and uses the saved period dates', async () => {
    const result = await refreshSGScores('L')
    expect(result.final).toBe(true)
    expect(result.scores).toEqual([{ rosterId: '1', totalPoints: 10 }, { rosterId: '2', totalPoints: 20 }, { rosterId: '3', totalPoints: 0 }, { rosterId: '4', totalPoints: 0 }])
    expect(source.load.mock.calls[0][1].scoringWindow).toEqual({ startsAt: new Date(dates.scoringStartsAt), endsAt: new Date(dates.scoringEndsAt) })
    expect(db.teamWeekResult.upsert.mock.calls.every(([args]) => args.create.opponentRosterId === null && args.create.winLoss === null && args.create.status === 'final')).toBe(true)
  })
  it.each([{ missingPlayerIds: ['1'] }, { slateFinal: false }, { correctionsReady: false }, { sourceSnapshotReady: false }])('never marks incomplete source evidence final: %j', async incomplete => {
    source.load.mockResolvedValue({ ...(await source.load()), ...incomplete })
    expect((await refreshSGScores('L')).final).toBe(false)
    expect(db.teamWeekResult.upsert.mock.calls.every(([args]) => args.update.status === 'live')).toBe(true)
  })
  it('rejects source changes rather than committing stale results', async () => {
    db.survivorGuillotineLeague.updateMany.mockResolvedValue({ count: 0 })
    await expect(refreshSGScores('L')).rejects.toThrow('changed')
    expect(db.teamWeekResult.upsert).not.toHaveBeenCalled()
  })
  it('refuses to score imported rosters or a native league without lineup history', async () => {
    db.league.findUniqueOrThrow.mockResolvedValueOnce({ platform: 'sleeper', leagueVariant: 'survivor_guillotine' })
    await expect(refreshSGScores('L')).rejects.toThrow('imported')
    db.league.findUniqueOrThrow.mockResolvedValueOnce({ platform: 'allfantasy', leagueVariant: 'survivor_guillotine', settings: {} })
    await expect(refreshSGScores('L')).rejects.toThrow('lineup history')
    expect(source.load).not.toHaveBeenCalled()
  })
  it('applies the NBA first-N player-game cap to saved daily lineups, including a zero-point played game', async () => {
    db.survivorGuillotineLeague.findUniqueOrThrow.mockResolvedValue({ config: { ...config, sport: 'NBA', nbaScoring: 'capped_games', nbaGameCap: 2 }, currentPeriod: 1, revision: 4, periodCalendar: { 1: dates } })
    db.league.findUniqueOrThrow.mockResolvedValue({ sport: 'NBA', season: 2026, platform: 'allfantasy', leagueVariant: 'survivor_guillotine', settings: { lineup_history_version: 1 } })
    const p = { ...player('1', 'BENCH'), position: 'PG', sport: 'NBA' }
    db.survivorGuillotineDailyLineup.findMany.mockResolvedValue([{ rosterId: '1', gameDay: new Date('2026-09-01T00:00:00Z'), playerIds: ['1'] }])
    source.load.mockResolvedValue({ eligible: [p], missingPlayerIds: [], slateFinal: true, correctionsReady: true,
      contributions: [0, 5, 100].map((pts, i) => ({ player: p, stats: { pts }, gameId: `g${i}`, gameStartsAt: Date.parse(`2026-09-0${i + 1}T23:00:00Z`) })) })
    expect((await refreshSGScores('L')).scores[0].totalPoints).toBe(5)
    expect(source.load.mock.calls[0][1].includeBench).toBe(true)
  })
})

describe('scheduled provider health gate',()=>{
 it.each([{status:'failed',age:0},{status:'healthy',age:11*60_000},{status:'healthy',age:-60_000}])('withholds final scores during failed, stale, or future feed observations: %j',async state=>{
  vi.stubEnv('SG_PROVIDER_INGEST_ENABLED','true');db.sportsDataCache.findUnique.mockResolvedValue({data:{status:state.status,checkedAt:new Date(Date.now()-state.age).toISOString()}})
  const result=await refreshSGScores('L');expect(result.final).toBe(false);expect(result.scores[0].totalPoints).toBe(10);expect(result.providerHealth?.ready).toBe(false)
 })
 it('allows complete scoring after a fresh successful provider observation',async()=>{
  vi.stubEnv('SG_PROVIDER_INGEST_ENABLED','true');db.sportsDataCache.findUnique.mockResolvedValue({data:{status:'healthy',checkedAt:new Date().toISOString()}})
  expect((await refreshSGScores('L')).final).toBe(true);expect(source.load.mock.calls[0][1].requireAtomicNflSnapshot).toBe(true)
 })
})
