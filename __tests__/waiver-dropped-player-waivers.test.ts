/**
 * A dropped player goes on waivers for the league's waiver period (`League.waiverHours`) and only
 * then becomes a free agent (lib/waiver-wire/dropped-player-waivers.ts).
 *
 * Before: the add/drop route checked the after-drop period only on a commissioner daily schedule or a
 * 'daily' free-agent-unlock sport. An instant-free-agent league (`instantFaAfterClear`, the column's
 * default) let anyone re-add a player the moment he was dropped. These pin the hold on that path,
 * the FCFS exemption, the dropping team's re-claim refusal and the claim order on him.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findUnique: vi.fn() },
    roster: { findFirst: vi.fn(), findMany: vi.fn() },
    redraftRoster: { findMany: vi.fn() },
    leagueTeam: { findFirst: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    redraftSeason: { findFirst: vi.fn(), count: vi.fn() },
    waiverClaim: { count: vi.fn(), findFirst: vi.fn() },
    waiverTransaction: { findFirst: vi.fn(), findMany: vi.fn() },
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
import {
  DROPPED_PLAYER_ON_WAIVERS_MESSAGE,
  activeDropHolds,
  droppedPlayerWaiverHours,
} from '@/lib/waiver-wire/dropped-player-waivers'
import { isImmediateAddAllowedToday, playerWaiverHoldUntil } from '@/lib/waiver-wire/immediate-add-policy'
import { PENDING_CLAIM_ON_PLAYER_MESSAGE } from '@/lib/waiver-wire/daily-schedule-gate'
import { PHASE_REASONS } from '@/lib/waiver-wire/season-phase-policy'
import { isOffseasonFreeAgencyAllowed } from '@/server/services/leagueLifecycleService'

const NOW = new Date('2026-10-20T15:00:00Z')

async function call(addPlayerId = 'p9') {
  const req = new Request('http://x/api', { method: 'POST', body: JSON.stringify({ addPlayerId }) }) as never
  const res = await POST(req, { params: Promise.resolve({ leagueId: 'L' }) })
  return { status: res.status, body: (await res.json()) as { code?: string; error?: string; onWaiversUntil?: string } }
}

/** An NFL-style FAAB league with instant free agents after clear — the path that never checked drops. */
const INSTANT_FA = { normalizedWaiverType: 'faab', instantFaAfterClear: true, freeAgentUnlockBehavior: 'after_waiver_run' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  m.gate.mockResolvedValue({ ok: true })
  m.prisma.roster.findFirst.mockResolvedValue({ id: 'r1' })
  m.prisma.league.findUnique.mockResolvedValue({ settings: {}, timezone: 'UTC', waiverHours: 24, lifecycleState: 'in_season' })
  m.prisma.leagueWaiverSettings.findUnique.mockResolvedValue(null)
  m.prisma.redraftSeason.findFirst.mockResolvedValue({ id: 's1', status: 'active' })
  m.prisma.redraftSeason.count.mockResolvedValue(0)
  m.prisma.waiverClaim.findFirst.mockResolvedValue(null)
  m.prisma.waiverTransaction.findMany.mockResolvedValue([])
  m.executeAdd.mockResolvedValue({ ok: true, transaction: { id: 't1' } })
  m.effective.mockResolvedValue(INSTANT_FA)
})

describe('the waiver period a dropped player sits in', () => {
  it('FCFS and a 0-hour period have none; any other type uses the league hours', () => {
    expect(droppedPlayerWaiverHours({ normalizedWaiverType: 'fcfs', waiverHours: 24 })).toBe(0)
    expect(droppedPlayerWaiverHours({ normalizedWaiverType: 'faab', waiverHours: 0 })).toBe(0)
    expect(droppedPlayerWaiverHours({ normalizedWaiverType: 'rolling', waiverHours: null })).toBe(0)
    expect(droppedPlayerWaiverHours({ normalizedWaiverType: 'reverse_standings', waiverHours: 48 })).toBe(48)
  })

  it('the latest drop decides, and a drop older than the period is no hold', () => {
    const holds = activeDropHolds(
      [
        { dropPlayerId: 'x', processedAt: new Date('2026-10-19T10:00:00Z'), rosterId: 'A' },
        { dropPlayerId: 'x', processedAt: new Date('2026-10-20T06:00:00Z'), rosterId: 'B' },
        { dropPlayerId: 'old', processedAt: new Date('2026-10-19T14:00:00Z'), rosterId: 'A' },
        { dropPlayerId: null, processedAt: NOW, rosterId: 'A' },
      ],
      NOW,
      24,
    )
    expect([...holds.keys()]).toEqual(['x'])
    expect(holds.get('x')).toMatchObject({ droppedByRosterId: 'B', until: new Date('2026-10-21T06:00:00Z') })
  })
})

describe('add/drop in an instant-free-agent league', () => {
  it('a player dropped inside the waiver period is refused as a free agent, with the time he clears', async () => {
    m.prisma.waiverTransaction.findMany.mockResolvedValue([
      { dropPlayerId: 'p9', processedAt: new Date('2026-10-20T06:00:00Z'), rosterId: 'r2' },
    ])
    const r = await call()
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'WAIVER_REQUIRED', error: DROPPED_PLAYER_ON_WAIVERS_MESSAGE, onWaiversUntil: '2026-10-21T06:00:00.000Z' })
    expect(m.executeAdd).not.toHaveBeenCalled()
    // Read only for this player, inside the period.
    expect(m.prisma.waiverTransaction.findMany.mock.calls[0][0].where).toMatchObject({
      leagueId: 'L',
      dropPlayerId: { in: ['p9'] },
      processedAt: { gte: new Date('2026-10-19T15:00:00Z') },
    })
  })

  it('positive control: once he has cleared he is a first-come add', async () => {
    m.prisma.waiverTransaction.findMany.mockResolvedValue([
      { dropPlayerId: 'p9', processedAt: new Date('2026-10-19T14:59:00Z'), rosterId: 'r2' },
    ])
    const r = await call()
    expect(r.status).toBe(200)
    expect(m.executeAdd).toHaveBeenCalledWith('L', 'r1', { addPlayerId: 'p9', dropPlayerId: null })
  })

  it('after he clears, a claim placed while he was on waivers keeps him off the free-agent list until the run', async () => {
    m.prisma.waiverTransaction.findMany.mockResolvedValue([
      { dropPlayerId: 'p9', processedAt: new Date('2026-10-19T14:59:00Z'), rosterId: 'r2' },
    ])
    m.prisma.waiverClaim.findFirst.mockResolvedValue({ id: 'c1' })
    const r = await call()
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'WAIVER_REQUIRED', error: PENDING_CLAIM_ON_PLAYER_MESSAGE })
    expect(m.prisma.waiverClaim.findFirst.mock.calls[0][0].where).toEqual({ leagueId: 'L', addPlayerId: 'p9', status: 'pending' })
    expect(m.executeAdd).not.toHaveBeenCalled()

    m.prisma.waiverClaim.findFirst.mockRejectedValue(new Error('db down'))
    expect((await call()).body.code).toBe('WAIVER_REQUIRED')
    expect(m.executeAdd).not.toHaveBeenCalled()
  })

  it('a failed read fails closed to a claim', async () => {
    m.prisma.waiverTransaction.findMany.mockRejectedValue(new Error('db down'))
    const r = await call()
    expect(r.body.code).toBe('WAIVER_REQUIRED')
    expect(m.executeAdd).not.toHaveBeenCalled()
  })
})

describe('FCFS leagues are exempt', () => {
  it('FCFS with a waiver period set: the dropped player is an instant add, and drops are never read', async () => {
    m.effective.mockResolvedValue({ ...INSTANT_FA, normalizedWaiverType: 'fcfs', instantFaAfterClear: false })
    m.prisma.waiverTransaction.findMany.mockResolvedValue([
      { dropPlayerId: 'p9', processedAt: new Date('2026-10-20T14:00:00Z'), rosterId: 'r2' },
    ])
    const r = await call()
    expect(r.status).toBe(200)
    expect(m.executeAdd).toHaveBeenCalled()
    expect(m.prisma.waiverTransaction.findMany).not.toHaveBeenCalled()
  })

  it('the free-agency-only preset (FCFS, 0 hours) as well', async () => {
    m.effective.mockResolvedValue({ ...INSTANT_FA, normalizedWaiverType: 'fcfs' })
    m.prisma.league.findUnique.mockResolvedValue({ settings: {}, timezone: 'UTC', waiverHours: 0, lifecycleState: 'in_season' })
    const r = await call()
    expect(r.status).toBe(200)
    expect(m.prisma.waiverTransaction.findMany).not.toHaveBeenCalled()
  })
})

describe('the waiver screen', () => {
  it('routes a held player to a claim until he clears, except in a first-come offseason', () => {
    const p = { onWaiversUntil: '2026-10-21T06:00:00.000Z' }
    expect(playerWaiverHoldUntil(p, null, NOW)?.toISOString()).toBe('2026-10-21T06:00:00.000Z')
    expect(playerWaiverHoldUntil(p, null, new Date('2026-10-21T06:00:01Z'))).toBeNull()
    expect(playerWaiverHoldUntil({}, null, NOW)).toBeNull()
    expect(
      playerWaiverHoldUntil(p, { phasePolicy: { phase: 'offseason', claimsAllowed: false, immediateAddsAllowed: true, firstComeAdds: true, code: 'offseason_fcfs', reason: 'x' } }, NOW),
    ).toBeNull()
  })
})

describe('season phase on the add/drop route', () => {
  const league = (over: Record<string, unknown>) =>
    m.prisma.league.findUnique.mockResolvedValue({ settings: {}, timezone: 'UTC', waiverHours: 24, lifecycleState: 'in_season', ...over })

  it('a closed offseason (the default) refuses with the reason, before the lifecycle gate', async () => {
    league({ lifecycleState: 'offseason' })
    const r = await call()
    expect(r.status).toBe(403)
    expect(r.body).toMatchObject({ code: 'LEAGUE_NOT_ACTIVE', error: PHASE_REASONS.offseason_closed, phaseCode: 'offseason_closed' })
    expect(m.gate).not.toHaveBeenCalled()
  })

  it('a first-come offseason: the gate is told, no waiver type or waiver period applies', async () => {
    league({ lifecycleState: 'completed' })
    m.prisma.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverEngineConfig: { offseason_waiver_rules: 'fcfs' } })
    // A FAAB league with no instant free agents, and the player dropped an hour ago: still an instant add.
    m.effective.mockResolvedValue({ ...INSTANT_FA, instantFaAfterClear: false })
    m.prisma.waiverTransaction.findMany.mockResolvedValue([
      { dropPlayerId: 'p9', processedAt: new Date('2026-10-20T14:00:00Z'), rosterId: 'r2' },
    ])
    const r = await call()
    expect(r.status).toBe(200)
    expect(m.gate).toHaveBeenCalledWith('L', 'u1', 'waiver_claim_submit', { rosterMove: 'free_agent_pickup', offseasonFreeAgency: true })
    expect(m.executeAdd).toHaveBeenCalledWith('L', 'r1', { addPlayerId: 'p9', dropPlayerId: null }, { offseasonFreeAgency: true })
    expect(m.effective).not.toHaveBeenCalled()
  })

  it('a dynasty offseason is not governed by the offseason rule', async () => {
    league({ lifecycleState: 'offseason', isDynasty: true })
    const r = await call()
    expect(r.status).toBe(200)
    expect(m.gate).toHaveBeenCalledWith('L', 'u1', 'waiver_claim_submit', { rosterMove: 'free_agent_pickup' })
  })

  it('locked playoffs refuse every add; alive-only refuses only an eliminated team', async () => {
    m.prisma.redraftSeason.findFirst.mockResolvedValue({ id: 's1', status: 'playoffs' })
    m.prisma.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverEngineConfig: { playoff_waiver_rules: 'locked' } })
    expect((await call()).body).toMatchObject({ code: 'LEAGUE_NOT_ACTIVE', error: PHASE_REASONS.playoffs_locked })

    m.prisma.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverEngineConfig: { playoff_waiver_rules: 'alive_only' } })
    m.prisma.roster.findMany.mockResolvedValue([{ id: 'r1', platformUserId: 'u1', redraftRosterId: 'rr1' }])
    m.prisma.redraftRoster.findMany.mockResolvedValue([{ id: 'rr1', ownerId: 'u1', isEliminated: true }])
    expect((await call()).body).toMatchObject({ code: 'LEAGUE_NOT_ACTIVE', error: PHASE_REASONS.playoffs_eliminated })
    expect(m.executeAdd).not.toHaveBeenCalled()

    m.prisma.redraftRoster.findMany.mockResolvedValue([{ id: 'rr1', ownerId: 'u1', isEliminated: false }])
    expect((await call()).status).toBe(200)
  })

  it('positive control: the playoffs with the default rule add as in season', async () => {
    m.prisma.redraftSeason.findFirst.mockResolvedValue({ id: 's1', status: 'playoffs' })
    expect((await call()).status).toBe(200)
  })

  it('the lifecycle gate lets only a free-agent pickup through an opened offseason', () => {
    expect(isOffseasonFreeAgencyAllowed('waiver_claim_submit', 'offseason', 'free_agent_pickup')).toBe(true)
    expect(isOffseasonFreeAgencyAllowed('waiver_claim_submit', 'pre_draft', 'free_agent_pickup')).toBe(true)
    expect(isOffseasonFreeAgencyAllowed('waiver_claim_submit', 'offseason', 'waiver_claim')).toBe(false)
    expect(isOffseasonFreeAgencyAllowed('trade_act', 'offseason', 'trade')).toBe(false)
    expect(isOffseasonFreeAgencyAllowed('waiver_claim_submit', 'in_season', 'free_agent_pickup')).toBe(false)
  })

  it('the screen: the phase decides the Add button when it changes anything', () => {
    const phase = (over: Record<string, unknown>) => ({ phase: 'offseason', claimsAllowed: false, immediateAddsAllowed: false, firstComeAdds: false, code: 'offseason_closed', reason: 'x', ...over }) as never
    expect(isImmediateAddAllowedToday({ waiverType: 'fcfs', phasePolicy: phase({}) })).toBe(false)
    expect(isImmediateAddAllowedToday({ waiverType: 'faab', phasePolicy: phase({ immediateAddsAllowed: true, firstComeAdds: true, code: 'offseason_fcfs' }) })).toBe(true)
    expect(isImmediateAddAllowedToday({ waiverType: 'faab', phasePolicy: phase({ phase: 'regular', immediateAddsAllowed: true, code: null }) })).toBe(false)
  })
})
