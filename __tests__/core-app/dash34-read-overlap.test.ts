// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/observability/rootTiming', () => ({ recordCompletedSpan: vi.fn() }))
vi.mock('@/lib/injuries/injurySyncState', () => ({ readInjurySyncFreshness: async () => null }))
vi.mock('@/lib/player-values/latestPlayerValueSnapshots', () => ({ loadLatestPlayerValueSnapshots: async () => [] }))
const { db, live } = vi.hoisted(() => {
  const rows = () => ({ findMany: vi.fn(async (): Promise<any[]> => []) })
  return { db: { leagueTeam: rows(), league: rows(), guillotineRosterState: rows(),
    guillotineElimination: rows(), roster: rows(), sportsPlayer: rows(), sportsInjury: rows(), sportsGame: rows() },
    live: vi.fn(async (): Promise<any> => null) }
})
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/core-app/currentSleeperRoster', () => ({ currentSleeperRoster: live }))
import { getDash34Data, mapWithConcurrency } from '@/lib/core-app/dash34'
const league = (id: string) => ({ id, name: 'League', platform: 'sleeper', platformLeagueId: id,
  sport: 'NFL', status: 'in_season', hasUnifiedRecord: true, lastSyncedAt: null })
const team = (id: string) => ({ leagueId: id, id: `team-${id}`, platformUserId: `owner-${id}`, externalId: '1' })
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => { vi.clearAllMocks(); for (const model of Object.values(db)) model.findMany.mockResolvedValue([]); live.mockResolvedValue(null) })
describe('Core summary critical path', () => {
  it('starts format, chop and shared feed reads while teams are pending', async () => {
    const pending = gate<any[]>()
    db.leagueTeam.findMany.mockReturnValueOnce(pending.promise)
    const result = getDash34Data('user-fixture', [league('L1')])
    try {
      await vi.waitFor(() => expect(db.leagueTeam.findMany).toHaveBeenCalled())
      expect(db.league.findMany).toHaveBeenCalledTimes(1)
      expect(db.guillotineRosterState.findMany).toHaveBeenCalledTimes(1)
      expect(db.sportsInjury.findMany).toHaveBeenCalledTimes(1)
    } finally { pending.resolve([]); await result }
  })
  it('starts the owned roster and live provider while elimination is pending', async () => {
    const pending = gate<any[]>()
    db.leagueTeam.findMany.mockResolvedValue([team('L1')])
    db.guillotineElimination.findMany.mockReturnValueOnce(pending.promise)
    const result = getDash34Data('user-fixture', [league('L1')])
    try {
      await vi.waitFor(() => expect(db.guillotineElimination.findMany).toHaveBeenCalled())
      expect(db.roster.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ leagueId: 'L1', platformUserId: { in: ['owner-L1', '1', 'user-fixture'] } }] } }))
      expect(live).toHaveBeenCalledWith('L1', expect.objectContaining({ platformUserId: 'owner-L1' }))
    } finally { pending.resolve([]); await result }
  })
  it('keeps the eight-league provider bound and waits for authoritative reads', async () => {
    const leagues = Array.from({ length: 18 }, (_, i) => league(`L${i}`))
    db.leagueTeam.findMany.mockResolvedValue(leagues.map(l => team(l.id)))
    const pending = gate<null>(); let running = 0; let peak = 0
    live.mockImplementation(async () => { running++; peak = Math.max(peak, running); try { return await pending.promise } finally { running-- } })
    let finished = false
    const result = getDash34Data('user-fixture', leagues).then(value => { finished = true; return value })
    try {
      await vi.waitFor(() => expect(live).toHaveBeenCalledTimes(8))
      expect(finished).toBe(false); expect(peak).toBe(8)
    } finally { pending.resolve(null); await result }
    expect(live).toHaveBeenCalledTimes(18); expect(peak).toBe(8)
  })
  it('starts the ninth league as soon as one of the first eight finishes, not after all eight', async () => {
    const leagues = Array.from({ length: 9 }, (_, i) => league(`L${i}`))
    db.leagueTeam.findMany.mockResolvedValue(leagues.map(l => team(l.id)))
    const first = gate<null>(); const rest = gate<null>()
    live.mockImplementation(async (id: string) => (id === 'L0' ? first.promise : rest.promise))
    const result = getDash34Data('user-fixture', leagues)
    try {
      await vi.waitFor(() => expect(live).toHaveBeenCalledTimes(8))
      expect(live).not.toHaveBeenCalledWith('L8', expect.anything())
      first.resolve(null)
      // L1–L7 are still pending: the old lockstep batches would not start L8 here.
      await vi.waitFor(() => expect(live).toHaveBeenCalledWith('L8', expect.anything()))
    } finally { first.resolve(null); rest.resolve(null); await result }
  })
  it('mapWithConcurrency returns results in input order whatever order they finish in', async () => {
    const delays = [30, 5, 20, 1, 10]
    const out = await mapWithConcurrency(delays, 2, (ms) => new Promise<number>((r) => setTimeout(() => r(ms), ms)))
    expect(out).toEqual(delays)
    expect(await mapWithConcurrency([], 8, async () => 1)).toEqual([])
  })
  it('reports a failed shared feed without replacing unknown status with a stale designation', async () => {
    const error = new Error('fixture outage'); const report = vi.fn()
    db.sportsInjury.findMany.mockRejectedValueOnce(error)
    await getDash34Data('user-fixture', [league('L1')], new Date(), { onReadError: report })
    expect(report).toHaveBeenCalledWith('injury-feed', error)
  })
})
