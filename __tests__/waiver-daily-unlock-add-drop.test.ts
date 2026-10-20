/**
 * `free_agent_unlock_behavior: 'daily'` (the NBA/MLB/NHL default) means a player who is NOT on
 * waivers is a first-come free agent. The add/drop route used to ignore it: with no commissioner
 * daily schedule only FCFS or `instantFaAfterClear` allowed an immediate add, and every native
 * league for those sports was created with `instantFaAfterClear: false` — so a cleared free agent
 * came back WAIVER_REQUIRED forever.
 *
 * Players still on waivers (dropped inside the league's waiver period, or with a pending claim)
 * must still go through a claim. NFL ('after_waiver_run') is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findUnique: vi.fn() },
    roster: { findFirst: vi.fn() },
    leagueTeam: { findFirst: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    waiverClaim: { count: vi.fn(), findFirst: vi.fn() },
    waiverTransaction: { findFirst: vi.fn() },
  },
  waiverState: vi.fn(),
  executeAdd: vi.fn(),
  effective: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/waiver-wire', () => ({ getEffectiveLeagueWaiverSettings: m.effective }))
vi.mock('@/lib/waiver-wire/free-agent-service', () => ({ executeImmediateAddDrop: m.executeAdd }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ getLeagueWaiverState: m.waiverState }))
vi.mock('@/server/services/leagueActionGate', () => ({ assertLeagueActionGate: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: vi.fn() }))
vi.mock('@/lib/league/write-authority-server', () => ({ resolveWriteAuthorityEnvelope: vi.fn().mockResolvedValue(null) }))

import { POST } from '@/app/api/waiver-wire/leagues/[leagueId]/add-drop/route'
import { getEffectiveLeagueWaiverSettings } from '@/lib/waiver-wire/settings-service'
import { isImmediateAddAllowedToday } from '@/lib/waiver-wire/immediate-add-policy'

function req() {
  return new Request('http://x/api', { method: 'POST', body: JSON.stringify({ addPlayerId: 'p9' }) }) as never
}
async function call() {
  const res = await POST(req(), { params: Promise.resolve({ leagueId: 'L' }) })
  return { status: res.status, body: (await res.json()) as { code?: string; error?: string } }
}

const NBA_EFFECTIVE = { normalizedWaiverType: 'rolling', instantFaAfterClear: false, freeAgentUnlockBehavior: 'daily' }
const NFL_EFFECTIVE = { normalizedWaiverType: 'faab', instantFaAfterClear: false, freeAgentUnlockBehavior: 'after_waiver_run' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-20T15:00:00Z'))
  m.prisma.roster.findFirst.mockResolvedValue({ id: 'r1' })
  // No commissioner daily schedule in settings.
  m.prisma.league.findUnique.mockResolvedValue({ settings: {}, timezone: 'UTC', waiverHours: 24, sport: 'NBA', leagueVariant: null })
  m.prisma.waiverClaim.count.mockResolvedValue(0)
  m.prisma.waiverClaim.findFirst.mockResolvedValue(null)
  m.prisma.waiverTransaction.findFirst.mockResolvedValue(null)
  m.waiverState.mockResolvedValue(null)
  m.executeAdd.mockResolvedValue({ ok: true, transaction: { id: 't1' } })
  m.effective.mockResolvedValue(NBA_EFFECTIVE)
})

describe("add/drop for a 'daily' free-agent-unlock sport (no commissioner schedule)", () => {
  it('a cleared free agent is an instant first-come add', async () => {
    const r = await call()
    expect(r.status).toBe(200)
    expect(m.executeAdd).toHaveBeenCalledWith('L', 'r1', { addPlayerId: 'p9', dropPlayerId: null })
  })

  it('a player dropped inside the waiver period still needs a claim', async () => {
    m.prisma.waiverTransaction.findFirst.mockResolvedValue({ processedAt: new Date('2026-10-20T06:00:00Z') })
    const r = await call()
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('WAIVER_REQUIRED')
    expect(m.executeAdd).not.toHaveBeenCalled()
  })

  it('a player with a pending claim still needs a claim', async () => {
    m.prisma.waiverClaim.findFirst.mockResolvedValue({ id: 'c1' })
    const r = await call()
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('WAIVER_REQUIRED')
    expect(m.executeAdd).not.toHaveBeenCalled()
  })
})

describe("NFL ('after_waiver_run') is unchanged", () => {
  it('without FCFS or instant FA → WAIVER_REQUIRED with the same message, no extra lookups', async () => {
    m.effective.mockResolvedValue(NFL_EFFECTIVE)
    const r = await call()
    expect(r.status).toBe(409)
    expect(r.body).toEqual({
      ok: false,
      code: 'WAIVER_REQUIRED',
      error: 'This player must be claimed through waivers in this league.',
    })
    expect(m.executeAdd).not.toHaveBeenCalled()
    expect(m.prisma.waiverClaim.findFirst).not.toHaveBeenCalled()
    expect(m.prisma.waiverTransaction.findFirst).not.toHaveBeenCalled()
  })

  it('client policy: NFL rows stay on the claim flow, daily sports offer an instant Add', () => {
    expect(isImmediateAddAllowedToday({ waiverType: 'faab', instantFaAfterClear: false, freeAgentUnlockBehavior: 'after_waiver_run' })).toBe(false)
    expect(isImmediateAddAllowedToday({ waiverType: 'rolling', instantFaAfterClear: false, freeAgentUnlockBehavior: 'daily' })).toBe(true)
  })
})

describe('effective settings expose the free-agent unlock behaviour', () => {
  const row = (over: Record<string, unknown> = {}) => ({ leagueId: 'L', waiverType: 'rolling', instantFaAfterClear: false, ...over })

  it('NBA row → daily; NFL row → after_waiver_run', async () => {
    m.prisma.leagueWaiverSettings.findUnique.mockResolvedValue(row())
    m.prisma.league.findUnique.mockResolvedValue({ id: 'L', sport: 'NBA', leagueVariant: null, settings: {} })
    expect((await getEffectiveLeagueWaiverSettings('L')).freeAgentUnlockBehavior).toBe('daily')

    m.prisma.league.findUnique.mockResolvedValue({ id: 'L', sport: 'NFL', leagueVariant: null, settings: {} })
    expect((await getEffectiveLeagueWaiverSettings('L')).freeAgentUnlockBehavior).toBe('after_waiver_run')
  })

  it("an explicit league setting wins over the sport default", async () => {
    m.prisma.leagueWaiverSettings.findUnique.mockResolvedValue(row())
    m.prisma.league.findUnique.mockResolvedValue({
      id: 'L', sport: 'NBA', leagueVariant: null, settings: { waiver_free_agent_unlock_behavior: 'after_waiver_run' },
    })
    expect((await getEffectiveLeagueWaiverSettings('L')).freeAgentUnlockBehavior).toBe('after_waiver_run')
  })

  it('no row: NBA defaults expose all processing days; NFL stays null', async () => {
    m.prisma.leagueWaiverSettings.findUnique.mockResolvedValue(null)
    m.prisma.league.findUnique.mockResolvedValue({ id: 'L', sport: 'NBA', leagueVariant: null, settings: {} })
    const nba = await getEffectiveLeagueWaiverSettings('L')
    expect(nba.processingDays).toEqual([1, 3, 5])
    expect(nba.processingDayOfWeek).toBe(1)

    m.prisma.league.findUnique.mockResolvedValue({ id: 'L', sport: 'NFL', leagueVariant: null, settings: {} })
    const nfl = await getEffectiveLeagueWaiverSettings('L')
    expect(nfl.processingDays).toBeNull()
    expect(nfl.processingDayOfWeek).toBe(2)
  })
})
