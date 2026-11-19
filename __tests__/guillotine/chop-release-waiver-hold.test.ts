/**
 * A Guilly chop releases the chopped team's players into the fair process, like a drop
 * (lib/waiver-wire/dropped-player-waivers.ts header). The chop writes no `WaiverTransaction`
 * (lib/guillotine/nativeGuillotineWeek.ts stamps `droppedAt` and lists `GuillotineWaiverRelease` rows), and
 * the after-drop hold read drop transactions only — so in an instant-free-agent league a chopped team's best
 * player was a first-come add the moment the chop landed, ahead of everyone's bids. The hold now reads the
 * release rows as drops at `availableAt`. The waiver RUN still does not defer claims on them: they settle in
 * the blind FAAB run. Harness: __tests__/waiver-dropped-player-waivers.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type ReleaseRow = { leagueId: string; playerId: string; availableAt: Date; eliminatedRosterId: string }

const m = vi.hoisted(() => ({
  releases: [] as ReleaseRow[],
  prisma: {
    league: { findUnique: vi.fn() },
    roster: { findFirst: vi.fn(), findMany: vi.fn() },
    redraftRoster: { findMany: vi.fn() },
    leagueTeam: { findFirst: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    redraftSeason: { findFirst: vi.fn(), count: vi.fn() },
    waiverClaim: { count: vi.fn(), findFirst: vi.fn() },
    waiverTransaction: { findFirst: vi.fn(), findMany: vi.fn() },
    guillotineWaiverRelease: { findMany: vi.fn() },
  },
  executeAdd: vi.fn(),
  effective: vi.fn(),
  gate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/waiver-wire', () => ({ getEffectiveLeagueWaiverSettings: m.effective }))
vi.mock('@/lib/waiver-wire/free-agent-service', () => ({ executeImmediateAddDrop: m.executeAdd }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ getLeagueWaiverState: vi.fn().mockResolvedValue(null) }))
vi.mock('@/server/services/leagueActionGate', () => ({ assertLeagueActionGate: m.gate }))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: vi.fn() }))
vi.mock('@/lib/league/write-authority-server', () => ({ resolveWriteAuthorityEnvelope: vi.fn().mockResolvedValue(null) }))

import { POST } from '@/app/api/waiver-wire/leagues/[leagueId]/add-drop/route'
import { DROPPED_PLAYER_ON_WAIVERS_MESSAGE, loadDroppedPlayerHolds } from '@/lib/waiver-wire/dropped-player-waivers'
import { dailyUnlockImmediateAddRefusal } from '@/lib/waiver-wire/daily-schedule-gate'

const NOW = new Date('2026-10-20T15:00:00Z')
const CHOP = new Date('2026-10-20T11:00:00Z') // four hours ago
const H = 3_600_000

async function call(addPlayerId = 'star') {
  const req = new Request('http://x/api', { method: 'POST', body: JSON.stringify({ addPlayerId }) }) as never
  const res = await POST(req, { params: Promise.resolve({ leagueId: 'L' }) })
  return { status: res.status, body: (await res.json()) as { code?: string; error?: string; onWaiversUntil?: string } }
}

const INSTANT_FA = { normalizedWaiverType: 'faab', instantFaAfterClear: true, freeAgentUnlockBehavior: 'after_waiver_run' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  m.gate.mockResolvedValue({ ok: true })
  m.prisma.roster.findFirst.mockResolvedValue({ id: 'r1' })
  m.prisma.league.findUnique.mockResolvedValue({ settings: {}, timezone: 'UTC', waiverHours: 24, lifecycleState: 'in_season', guillotineMode: true })
  m.prisma.leagueWaiverSettings.findUnique.mockResolvedValue(null)
  m.prisma.redraftSeason.findFirst.mockResolvedValue({ id: 's1', status: 'active' })
  m.prisma.redraftSeason.count.mockResolvedValue(0)
  m.prisma.waiverClaim.findFirst.mockResolvedValue(null)
  // No manager ever dropped him: the chop is the only release.
  m.prisma.waiverTransaction.findMany.mockResolvedValue([])
  m.prisma.waiverTransaction.findFirst.mockResolvedValue(null)
  m.releases = [{ leagueId: 'L', playerId: 'star', availableAt: CHOP, eliminatedRosterId: 'rr-chopped' }]
  m.prisma.guillotineWaiverRelease.findMany.mockImplementation(
    async ({ where }: { where: { leagueId: string; availableAt: { gte: Date }; playerId?: { in: string[] } } }) =>
      m.releases.filter(
        (r) => r.leagueId === where.leagueId && r.availableAt >= where.availableAt.gte && (!where.playerId || where.playerId.in.includes(r.playerId)),
      ),
  )
  m.executeAdd.mockResolvedValue({ ok: true, transaction: { id: 't1' } })
  m.effective.mockResolvedValue(INSTANT_FA)
})

describe('a chopped player in an instant-free-agent league', () => {
  it('is on waivers like a dropped player: refused as a free agent, with the time he clears', async () => {
    const r = await call()
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('WAIVER_REQUIRED')
    expect(r.body.error).toBe(DROPPED_PLAYER_ON_WAIVERS_MESSAGE)
    expect(r.body.onWaiversUntil).toBe(new Date(CHOP.getTime() + 24 * H).toISOString())
    expect(m.executeAdd).not.toHaveBeenCalled()
  })

  it('positive control: once the waiver period after the chop has passed, he is a first-come add', async () => {
    m.releases = [{ leagueId: 'L', playerId: 'star', availableAt: new Date(NOW.getTime() - 25 * H), eliminatedRosterId: 'rr-chopped' }]
    const r = await call()
    expect(r.body.code).toBeUndefined()
    expect(m.executeAdd).toHaveBeenCalledTimes(1)
  })

  it('a player nobody chopped or dropped is still a first-come add', async () => {
    const r = await call('someone-else')
    expect(r.body.code).toBeUndefined()
    expect(m.executeAdd).toHaveBeenCalledTimes(1)
  })

  it('an FCFS league holds nobody, chopped or dropped — the same as a drop there', async () => {
    m.effective.mockResolvedValue({ normalizedWaiverType: 'fcfs', instantFaAfterClear: true, freeAgentUnlockBehavior: 'after_waiver_run' })
    const r = await call()
    expect(r.body.code).toBeUndefined()
    expect(m.executeAdd).toHaveBeenCalledTimes(1)
  })

  it('an unreadable release table falls back to drops alone rather than refusing every add', async () => {
    m.prisma.guillotineWaiverRelease.findMany.mockRejectedValue(new Error('down'))
    const r = await call()
    expect(r.body.code).toBeUndefined()
  })
})

describe('the daily free-agent unlock path (NBA / MLB / NHL default)', () => {
  it('refuses a chopped player inside the waiver period, and lets him go after it', async () => {
    expect(await dailyUnlockImmediateAddRefusal('L', 'star', NOW)).not.toBeNull()
    expect(await dailyUnlockImmediateAddRefusal('L', 'star', new Date(CHOP.getTime() + 25 * H))).toBeNull()
  })
})

describe('the hold itself', () => {
  it('reads a chop release as a drop by the chopped team, tagged as a chop', async () => {
    const holds = await loadDroppedPlayerHolds('L', 24, { now: NOW })
    expect(holds.get('star')).toEqual({
      playerId: 'star', droppedAt: CHOP, until: new Date(CHOP.getTime() + 24 * H), droppedByRosterId: 'rr-chopped', source: 'chop_release',
    })
  })

  it('a later manager drop of the same player decides, as between two drops', async () => {
    const later = new Date(NOW.getTime() - H)
    m.prisma.waiverTransaction.findMany.mockResolvedValue([{ dropPlayerId: 'star', processedAt: later, rosterId: 'r7' }])
    const hold = (await loadDroppedPlayerHolds('L', 24, { now: NOW })).get('star')
    expect(hold?.droppedByRosterId).toBe('r7')
    expect(hold?.source).toBeUndefined()
  })

  it('the waiver run leaves chop releases out, so bids on them still settle in the blind FAAB run', async () => {
    const holds = await loadDroppedPlayerHolds('L', 24, { now: NOW, playerIds: ['star'], includeChopReleases: false })
    expect(holds.size).toBe(0)
    expect(m.prisma.guillotineWaiverRelease.findMany).not.toHaveBeenCalled()
  })
})
