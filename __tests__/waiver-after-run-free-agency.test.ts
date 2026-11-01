/**
 * Sleeper-style free agency (`free_agency_mode: 'after_run'`, lib/waiver-wire/after-run-free-agency.ts):
 * on waivers until the league's run, then a first-come free agent, back on waivers once his game
 * starts until the next run. A dropped player serves the waiver period (#2719) and a pending claim
 * still wins at the run (#2728).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findUnique: vi.fn() },
    roster: { findFirst: vi.fn() },
    leagueTeam: { findFirst: vi.fn() },
    waiverClaim: { count: vi.fn(), findFirst: vi.fn() },
    waiverTransaction: { findFirst: vi.fn(), findMany: vi.fn() },
    draftSession: { findFirst: vi.fn() },
    sportsPlayer: { findFirst: vi.fn(), findMany: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
  },
  waiverState: vi.fn(),
  executeAdd: vi.fn(),
  effective: vi.fn(),
  kickoffs: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/waiver-wire', () => ({ getEffectiveLeagueWaiverSettings: m.effective }))
vi.mock('@/lib/waiver-wire/free-agent-service', () => ({ executeImmediateAddDrop: m.executeAdd }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ getLeagueWaiverState: m.waiverState }))
vi.mock('@/lib/waiver-wire/season-phase-gate', () => ({
  loadWaiverPhasePolicy: vi.fn().mockResolvedValue({ code: null, claimsAllowed: true, immediateAddsAllowed: true, firstComeAdds: false, reason: null }),
}))
vi.mock('@/lib/redraft/lineupLock', () => ({
  buildWeekKickoffMap: m.kickoffs,
  lockTeamLookupKeys: (_sport: string, team: string | null) => (team ? [String(team).toUpperCase()] : []),
}))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({
  loadLeagueWeekContext: vi.fn().mockResolvedValue({ season: 2026, week: 7 }),
}))
vi.mock('@/server/services/leagueActionGate', () => ({ assertLeagueActionGate: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: vi.fn() }))
vi.mock('@/lib/league/write-authority-server', () => ({ resolveWriteAuthorityEnvelope: vi.fn().mockResolvedValue(null) }))

import { POST } from '@/app/api/waiver-wire/leagues/[leagueId]/add-drop/route'
import {
  AFTER_RUN_AWAITING_FIRST_RUN_MESSAGE,
  AFTER_RUN_GAME_STARTED_MESSAGE,
  afterRunFreeAgencyState,
} from '@/lib/waiver-wire/after-run-free-agency'
import { computePreviousWaiverRunAtUtc } from '@/lib/waiver-wire/next-waiver-run'
import { isImmediateAddAllowedToday } from '@/lib/waiver-wire/immediate-add-policy'
import { hubWaiverEngineConfigPatch, parseHubWaiverOptions, readFreeAgencyMode } from '@/lib/waiver-wire/hub-waiver-options'
import { PENDING_CLAIM_ON_PLAYER_MESSAGE } from '@/lib/waiver-wire/daily-schedule-gate'
import { DROPPED_PLAYER_ON_WAIVERS_MESSAGE } from '@/lib/waiver-wire/dropped-player-waivers'

const d = (iso: string) => new Date(iso)

// NFL league: one run a week, Wednesday 10:00 UTC. "Now" is Friday 2026-10-23 15:00 UTC; the last
// scheduled run was Wednesday 2026-10-21 10:00.
const NOW = '2026-10-23T15:00:00Z'
const LAST_WED_RUN = '2026-10-21T10:00:00Z'
const AFTER_RUN = {
  normalizedWaiverType: 'faab',
  instantFaAfterClear: false,
  freeAgentUnlockBehavior: 'after_waiver_run',
  freeAgencyMode: 'after_run',
  processingDayOfWeek: 3,
  processingTimeUtc: '10:00',
  processingDays: null,
}

function req(body: Record<string, unknown> = { addPlayerId: 'p9' }) {
  return new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }) as never
}
async function call(body?: Record<string, unknown>) {
  const res = await POST(req(body), { params: Promise.resolve({ leagueId: 'L' }) })
  return { status: res.status, body: (await res.json()) as { code?: string; error?: string; onWaiversUntil?: string } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(d(NOW))
  m.prisma.roster.findFirst.mockResolvedValue({ id: 'r1', playerData: { players: [] } })
  m.prisma.league.findUnique.mockResolvedValue({ settings: {}, timezone: 'UTC', waiverHours: 48, sport: 'NFL', season: 2026, leagueVariant: null })
  m.prisma.waiverClaim.count.mockResolvedValue(0)
  m.prisma.waiverClaim.findFirst.mockResolvedValue(null)
  m.prisma.waiverTransaction.findFirst.mockResolvedValue(null)
  m.prisma.waiverTransaction.findMany.mockResolvedValue([])
  // Drafted in August: this season's runs count.
  m.prisma.draftSession.findFirst.mockResolvedValue({ completedAt: d('2026-08-30T20:00:00Z') })
  m.prisma.sportsPlayer.findFirst.mockResolvedValue({ team: 'KC' })
  m.prisma.redraftSeason.findFirst.mockResolvedValue({ season: 2026, currentWeek: 8 })
  // His game is Sunday — not started yet.
  m.kickoffs.mockResolvedValue({ byTeam: new Map([['KC', d('2026-10-25T17:00:00Z')]]), firstKickoff: null, warnings: [] })
  m.waiverState.mockResolvedValue({ lastRunAt: d(LAST_WED_RUN) })
  m.executeAdd.mockResolvedValue({ ok: true, transaction: { id: 't1' } })
  m.effective.mockResolvedValue(AFTER_RUN)
})

describe('afterRunFreeAgencyState (pure)', () => {
  const base = { now: d(NOW), lastRunAt: null, lastScheduledRunAt: null, seasonStartedAt: null, gameStartedAt: null }

  it('before any run, every player is on waivers', () => {
    expect(afterRunFreeAgencyState(base)).toEqual({ onWaivers: true, reason: 'awaiting_first_run', clearedAt: null })
  })

  it('a run before the draft is last season — still waiting for the first run', () => {
    const s = afterRunFreeAgencyState({ ...base, lastRunAt: d('2026-08-20T10:00:00Z'), seasonStartedAt: d('2026-08-30T20:00:00Z') })
    expect(s).toMatchObject({ onWaivers: true, reason: 'awaiting_first_run' })
  })

  it('after the run, an unclaimed player is a free agent — even when the processor wrote no run', () => {
    expect(afterRunFreeAgencyState({ ...base, lastScheduledRunAt: d(LAST_WED_RUN) })).toEqual({ onWaivers: false, clearedAt: d(LAST_WED_RUN) })
  })

  it('a game that started after the run puts him back on waivers', () => {
    const s = afterRunFreeAgencyState({ ...base, lastRunAt: d(LAST_WED_RUN), gameStartedAt: d('2026-10-23T00:15:00Z') })
    expect(s).toMatchObject({ onWaivers: true, reason: 'game_started' })
  })

  it('a game before the run does not, and the next run clears him', () => {
    expect(afterRunFreeAgencyState({ ...base, lastRunAt: d(LAST_WED_RUN), gameStartedAt: d('2026-10-19T00:15:00Z') }).onWaivers).toBe(false)
  })

  it('previous scheduled run: the Wednesday before, at the run time', () => {
    expect(computePreviousWaiverRunAtUtc(d(NOW), { processingDayOfWeek: 3, processingTimeUtc: '10:00' })).toEqual(d(LAST_WED_RUN))
    // Wednesday 09:00 — the run is later today, so the previous one is a week back.
    expect(computePreviousWaiverRunAtUtc(d('2026-10-21T09:00:00Z'), { processingDayOfWeek: 3, processingTimeUtc: '10:00' })).toEqual(
      d('2026-10-14T10:00:00Z'),
    )
    expect(computePreviousWaiverRunAtUtc(d(NOW), { processingDayOfWeek: 3, processingTimeUtc: null })).toBeNull()
  })
})

describe('add/drop under "Waivers until each run, then free agents"', () => {
  it('before the run, an add becomes a claim', async () => {
    m.waiverState.mockResolvedValue(null)
    m.prisma.draftSession.findFirst.mockResolvedValue({ completedAt: d('2026-10-22T20:00:00Z') }) // drafted after Wednesday's run
    const r = await call()
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'WAIVER_REQUIRED', error: AFTER_RUN_AWAITING_FIRST_RUN_MESSAGE })
    expect(m.executeAdd).not.toHaveBeenCalled()
  })

  it('after the run, an unclaimed player is an instant add', async () => {
    const r = await call()
    expect(r.status).toBe(200)
    expect(m.executeAdd).toHaveBeenCalledWith('L', 'r1', { addPlayerId: 'p9', dropPlayerId: null })
  })

  it('a player whose game has started is locked on waivers until the next run', async () => {
    m.kickoffs.mockResolvedValue({ byTeam: new Map([['KC', d('2026-10-23T00:15:00Z')]]), firstKickoff: null, warnings: [] })
    const r = await call()
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'WAIVER_REQUIRED', error: AFTER_RUN_GAME_STARTED_MESSAGE })
    expect(m.executeAdd).not.toHaveBeenCalled()
  })

  it("last week's game counts too: a Thursday game still holds him after the week rolls, until the run", async () => {
    vi.setSystemTime(d('2026-10-20T15:00:00Z')) // Tuesday; last run Wednesday the 14th
    m.waiverState.mockResolvedValue({ lastRunAt: d('2026-10-14T10:00:00Z') })
    m.kickoffs.mockImplementation(async (_db: unknown, args: { week: number }) =>
      args.week === 7
        ? { byTeam: new Map([['KC', d('2026-10-16T00:15:00Z')]]), firstKickoff: null, warnings: [] }
        : { byTeam: new Map([['KC', d('2026-10-25T17:00:00Z')]]), firstKickoff: null, warnings: [] },
    )
    const r = await call()
    expect(r.body).toMatchObject({ code: 'WAIVER_REQUIRED', error: AFTER_RUN_GAME_STARTED_MESSAGE })
  })

  it('a pending claim on him still wins at the run (#2728): no first-come add beats it', async () => {
    m.prisma.waiverClaim.findFirst.mockResolvedValue({ id: 'c1' })
    const r = await call()
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'WAIVER_REQUIRED', error: PENDING_CLAIM_ON_PLAYER_MESSAGE })
    expect(m.executeAdd).not.toHaveBeenCalled()
  })

  it('a dropped player serves the waiver period (#2719) even after the run', async () => {
    m.prisma.waiverTransaction.findMany.mockResolvedValue([{ dropPlayerId: 'p9', processedAt: d('2026-10-23T09:00:00Z'), rosterId: 'r2' }])
    const r = await call()
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'WAIVER_REQUIRED', error: DROPPED_PLAYER_ON_WAIVERS_MESSAGE, onWaiversUntil: '2026-10-25T09:00:00.000Z' })
  })

  it('an unreadable state fails closed: a claim, never a free add', async () => {
    m.waiverState.mockRejectedValue(new Error('db down'))
    const r = await call()
    expect(r.body.code).toBe('WAIVER_REQUIRED')
    expect(m.executeAdd).not.toHaveBeenCalled()
  })

  it('an FCFS league is unchanged by the mode', async () => {
    m.effective.mockResolvedValue({ ...AFTER_RUN, normalizedWaiverType: 'fcfs' })
    m.waiverState.mockResolvedValue(null)
    const r = await call()
    expect(r.status).toBe(200)
    expect(m.kickoffs).not.toHaveBeenCalled()
  })

  it('standard mode is untouched: no after-run lookups', async () => {
    m.effective.mockResolvedValue({ ...AFTER_RUN, freeAgencyMode: 'standard' })
    const r = await call()
    expect(r.body.code).toBe('WAIVER_REQUIRED')
    expect(m.prisma.draftSession.findFirst).not.toHaveBeenCalled()
  })
})

describe('the commissioner option', () => {
  it('validates in the settings patch and writes the engine key', () => {
    const ok = parseHubWaiverOptions({ waiverFreeAgencyMode: 'after_run' }, { budget: 100 })
    expect(ok).toEqual({ ok: true, options: { freeAgencyMode: 'after_run' } })
    expect(hubWaiverEngineConfigPatch(ok.ok ? ok.options : {})).toEqual({ free_agency_mode: 'after_run' })
    expect(parseHubWaiverOptions({ waiverFreeAgencyMode: 'sleeper' }, { budget: 100 })).toEqual({ ok: false, error: 'Invalid waiverFreeAgencyMode' })
    expect(parseHubWaiverOptions({ waiverFreeAgencyMode: true }, { budget: 100 }).ok).toBe(false)
  })

  it('reads anything else as standard', () => {
    expect(readFreeAgencyMode('after_run')).toBe('after_run')
    expect(readFreeAgencyMode(undefined)).toBe('standard')
    expect(readFreeAgencyMode('weird')).toBe('standard')
  })

  it('the screens offer the Add button and let the server decide', () => {
    expect(isImmediateAddAllowedToday({ waiverType: 'faab', instantFaAfterClear: false, freeAgencyMode: 'after_run' })).toBe(true)
    expect(isImmediateAddAllowedToday({ waiverType: 'faab', instantFaAfterClear: false, freeAgencyMode: 'standard' })).toBe(false)
  })
})
