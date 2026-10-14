/**
 * Per-day waiver modes enforced at transaction time:
 * - add/drop route: Locked → refused; Free agents → instant (unless still in the after-drop hold);
 *   a waiver day → claim required; Waivers → Free agents → instant only after today's run clears;
 *   no schedule → the league's existing FCFS / instant-FA rule, unchanged.
 * - claims: a Locked day refuses claims with a clear message.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findUnique: vi.fn() },
    roster: { findFirst: vi.fn() },
    leagueTeam: { findFirst: vi.fn() },
    waiverClaim: { count: vi.fn() },
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
import { loadDailyTransactionPolicy } from '@/lib/waiver-wire/daily-schedule-gate'
import { assertDailyScheduleAllowsClaim } from '@/lib/waiver-wire/waiver-validation'
import {
  DAILY_BEFORE_CLEAR_MESSAGE,
  DAILY_DROP_HOLD_MESSAGE,
  DAILY_LOCKED_MESSAGE,
  DAILY_WAIVER_DAY_MESSAGE,
  DAILY_WAIVER_SCHEDULE_SETTINGS_KEY,
  defaultDailyWaiverSchedule,
} from '@/lib/waivers/dailyWaiverSchedule'

// Mon locked, Tue free agents, Wed waivers → FA at 03:00 UTC, Thu rolling.
const SCHEDULE = {
  ...defaultDailyWaiverSchedule(),
  enabled: true,
  processHour: 3,
  days: { ...defaultDailyWaiverSchedule().days, mon: 'locked', tue: 'free_agents', wed: 'waivers_then_fa', thu: 'rolling' },
}

let leagueSettings: Record<string, unknown>

function req() {
  return new Request('http://x/api', { method: 'POST', body: JSON.stringify({ addPlayerId: 'p9' }) }) as never
}
async function call() {
  const res = await POST(req(), { params: Promise.resolve({ leagueId: 'L' }) })
  return { status: res.status, body: (await res.json()) as { code?: string; error?: string } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  leagueSettings = { [DAILY_WAIVER_SCHEDULE_SETTINGS_KEY]: SCHEDULE }
  m.prisma.roster.findFirst.mockResolvedValue({ id: 'r1' })
  m.prisma.league.findUnique.mockImplementation(async () => ({ settings: leagueSettings, timezone: 'UTC', waiverHours: 24 }))
  m.prisma.waiverClaim.count.mockResolvedValue(0)
  m.prisma.waiverTransaction.findFirst.mockResolvedValue(null)
  m.waiverState.mockResolvedValue(null)
  m.executeAdd.mockResolvedValue({ ok: true, transaction: { id: 't1' } })
  m.effective.mockResolvedValue({ normalizedWaiverType: 'rolling', instantFaAfterClear: false })
})

describe('add/drop under the daily schedule', () => {
  it('Locked day → refused with the schedule message, nothing executed', async () => {
    vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
    const r = await call()
    expect(r.status).toBe(403)
    expect(r.body).toMatchObject({ code: 'LEAGUE_NOT_ACTIVE', error: DAILY_LOCKED_MESSAGE })
    expect(m.executeAdd).not.toHaveBeenCalled()
  })

  it('Free-agents day → instant add even though the league type is rolling', async () => {
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
    const r = await call()
    expect(r.status).toBe(200)
    expect(m.executeAdd).toHaveBeenCalledWith('L', 'r1', { addPlayerId: 'p9', dropPlayerId: null })
    expect(m.effective).not.toHaveBeenCalled()
  })

  it('Free-agents day, player dropped inside the waiver period → claim required', async () => {
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
    m.prisma.waiverTransaction.findFirst.mockResolvedValue({ processedAt: new Date('2026-10-13T06:00:00Z') })
    const r = await call()
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'WAIVER_REQUIRED', error: DAILY_DROP_HOLD_MESSAGE })
    expect(m.executeAdd).not.toHaveBeenCalled()
  })

  it('Waiver-type day → claim required', async () => {
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))
    const r = await call()
    expect(r.body).toMatchObject({ code: 'WAIVER_REQUIRED', error: DAILY_WAIVER_DAY_MESSAGE })
  })

  it('Waivers → Free agents: claim required before the run clears, instant after', async () => {
    vi.setSystemTime(new Date('2026-10-14T02:00:00Z'))
    expect((await call()).body).toMatchObject({ code: 'WAIVER_REQUIRED', error: DAILY_BEFORE_CLEAR_MESSAGE })
    vi.setSystemTime(new Date('2026-10-14T08:00:00Z'))
    m.prisma.waiverClaim.count.mockResolvedValue(3)
    m.waiverState.mockResolvedValue({ lastRunAt: new Date('2026-10-14T03:01:00Z') })
    expect((await call()).status).toBe(200)
    expect(m.executeAdd).toHaveBeenCalledTimes(1)
  })

  it('no schedule → the existing rule (rolling, no instant FA → waivers)', async () => {
    leagueSettings = {}
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
    const r = await call()
    expect(r.body.code).toBe('WAIVER_REQUIRED')
    expect(m.effective).toHaveBeenCalled()
    m.effective.mockResolvedValue({ normalizedWaiverType: 'fcfs', instantFaAfterClear: false })
    expect((await call()).status).toBe(200)
  })
})

describe('claims under the daily schedule', () => {
  it('a Locked day refuses claims; other days accept them', async () => {
    vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
    const locked = await loadDailyTransactionPolicy('L')
    expect(assertDailyScheduleAllowsClaim(locked?.policy)).toEqual({ ok: false, message: DAILY_LOCKED_MESSAGE })
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
    expect(assertDailyScheduleAllowsClaim((await loadDailyTransactionPolicy('L'))?.policy)).toEqual({ ok: true })
    leagueSettings = {}
    expect(await loadDailyTransactionPolicy('L')).toBeNull()
    expect(assertDailyScheduleAllowsClaim(null)).toEqual({ ok: true })
  })
})
