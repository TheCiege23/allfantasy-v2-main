// @vitest-environment node
/**
 * "If the Survivor trade check can't run": allow (default) or hold for the commissioner. Plus the
 * played-player lock in a week with no council, read through the real hook, and the cross-league
 * Rooks vs Vets lookup.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: {
    league: { findUnique: vi.fn() },
    roster: { findMany: vi.fn() },
    survivorPlayer: { findMany: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    survivorTribalCouncil: { findFirst: vi.fn() },
    redraftRosterPlayer: { findMany: vi.fn() },
    sportsGame: { findMany: vi.fn() },
    redraftTradeProposal: { updateMany: vi.fn() },
    survivorAuditEntry: { create: vi.fn(), findMany: vi.fn() },
    redraftSeason: { findMany: vi.fn() },
    redraftRoster: { findMany: vi.fn() },
  },
  kickoffs: vi.fn(),
  plan: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/redraft/lineupLock', () => ({
  buildWeekKickoffMap: h.kickoffs,
  lockTeamLookupKeys: (_sport: string, team: string | null | undefined) => (team ? [team.toUpperCase()] : []),
}))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ getActiveEffectsForRoster: async () => [] }))
vi.mock('@/lib/survivor/survivorFullSeasonPlan', () => ({ readSurvivorFullSeasonPlan: h.plan }))

import { checkSurvivorTradeRules } from '@/lib/survivor/survivorTradeRuleHook'
import { holdRedraftProposalForCommissioner, survivorHeldRedraftProposalIds } from '@/lib/survivor/survivorTradeCheckHold'
import { loadCastawayExperience } from '@/lib/survivor/survivorExperienceService'

const MONDAY_LATE = new Date('2026-11-10T06:00:00Z') // Tue 01:00 ET: the week's games are done
const input = {
  leagueId: 'L1',
  rosterIds: ['rd-a', 'rd-b'],
  rosterIdSpace: 'redraft' as const,
  players: [{ playerId: 'p1', playerName: null, fromRosterId: 'rd-a' }],
  now: MONDAY_LATE,
}

function survivorLeague(governance: Record<string, unknown>) {
  h.db.league.findUnique.mockResolvedValue({ survivorMode: true, sport: 'NFL', season: 2026, language: 'en', settings: { tribalCouncilDay: 'Tuesday', tribalCouncilTime: '20:00', survivorGovernance: { tradeRulesEnabled: true, crossTribeTrades: 'allowed', ...governance } } })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.db.roster.findMany.mockResolvedValue([{ id: 'ra', redraftRosterId: 'rd-a', platformUserId: 'ua' }, { id: 'rb', redraftRosterId: 'rd-b', platformUserId: 'ub' }])
  h.db.survivorPlayer.findMany.mockResolvedValue([{ userId: 'ua', redraftRosterId: 'ra', tribeId: 'scorps' }, { userId: 'ub', redraftRosterId: 'rb', tribeId: 'scorps' }])
  h.db.survivorGameState.findUnique.mockResolvedValue({ currentWeek: 9, phase: 'pre_merge', mergeTriggeredAt: null })
  h.db.survivorTribalCouncil.findFirst.mockResolvedValue(null)
  h.db.redraftRosterPlayer.findMany.mockResolvedValue([{ playerId: 'p1', playerName: 'Jalen Hurts', team: 'PHI' }])
  h.kickoffs.mockResolvedValue({ byTeam: new Map([['PHI', new Date('2026-11-08T18:00:00Z')]]), firstKickoff: null, warnings: [] })
  h.plan.mockReturnValue(null)
  h.db.sportsGame.findMany.mockResolvedValue([])
})

describe('when the check cannot run', () => {
  it('allows the trade by default (the old behaviour)', async () => {
    survivorLeague({})
    h.db.roster.findMany.mockRejectedValue(new Error('db blip'))
    expect(await checkSurvivorTradeRules(input)).toEqual({ ok: true, skipped: 'error' })
  })

  it('holds it for the commissioner when the league chose that — never refused', async () => {
    survivorLeague({ tradeCheckFailureMode: 'hold' })
    h.db.roster.findMany.mockRejectedValue(new Error('db blip'))
    expect(await checkSurvivorTradeRules(input)).toEqual({ ok: true, skipped: 'error', holdForCommissioner: true })
  })

  it('retries the league read once; a second failure falls back to allow (the setting is unknowable)', async () => {
    h.db.league.findUnique.mockRejectedValueOnce(new Error('blip')).mockResolvedValueOnce({ survivorMode: false, settings: {} })
    expect(await checkSurvivorTradeRules(input)).toEqual({ ok: true, skipped: 'not_survivor' })
    h.db.league.findUnique.mockRejectedValue(new Error('down'))
    expect(await checkSurvivorTradeRules(input)).toEqual({ ok: true, skipped: 'error' })
  })

  it('a check that RUNS is unaffected by the hold setting', async () => {
    survivorLeague({ tradeCheckFailureMode: 'hold' })
    h.db.survivorTribalCouncil.findFirst.mockImplementation(async (args: { where: { closedAt: unknown } }) => (args.where.closedAt === null ? null : { id: 'c9' }))
    expect(await checkSurvivorTradeRules(input)).toMatchObject({ ok: true, bypassed: false })
  })
})

describe('played-player lock, week with no council', () => {
  const plan = { startWeek: 1, endWeek: 17, eliminationWeeks: [2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15] } // week 9: no council

  it('lifts once the week’s last game is final', async () => {
    survivorLeague({})
    h.plan.mockReturnValue(plan)
    h.db.sportsGame.findMany.mockResolvedValue([{ startTime: new Date('2026-11-08T18:00:00Z'), status: 'final' }, { startTime: new Date('2026-11-10T01:15:00Z'), status: 'final' }])
    expect(await checkSurvivorTradeRules(input)).toMatchObject({ ok: true })
    expect(h.db.sportsGame.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ sport: 'NFL', season: 2026, week: 9 }) }))
  })

  it('holds while the last game is still live, and when no game rows exist (until the week advances)', async () => {
    survivorLeague({})
    h.plan.mockReturnValue(plan)
    h.db.sportsGame.findMany.mockResolvedValue([{ startTime: new Date('2026-11-10T01:15:00Z'), status: 'in_progress' }])
    expect(await checkSurvivorTradeRules(input)).toMatchObject({ ok: false, code: 'SURVIVOR_PLAYED_LOCK' })
    h.db.sportsGame.findMany.mockResolvedValue([])
    expect(await checkSurvivorTradeRules(input)).toMatchObject({ ok: false, code: 'SURVIVOR_PLAYED_LOCK' })
  })

  it('a council week still waits for Tribal, whatever the finals say', async () => {
    survivorLeague({})
    h.plan.mockReturnValue({ ...plan, eliminationWeeks: [...plan.eliminationWeeks, 9] })
    h.db.sportsGame.findMany.mockResolvedValue([{ startTime: new Date('2026-11-10T01:15:00Z'), status: 'final' }])
    expect(await checkSurvivorTradeRules(input)).toMatchObject({ ok: false, code: 'SURVIVOR_PLAYED_LOCK' })
    expect(h.db.sportsGame.findMany).not.toHaveBeenCalled()
  })
})

describe('the hold itself', () => {
  it('switches the proposal to commissioner review and marks it for the sweep', async () => {
    h.db.redraftTradeProposal.updateMany.mockResolvedValue({ count: 1 })
    h.db.survivorAuditEntry.create.mockResolvedValue({})
    await holdRedraftProposalForCommissioner({ leagueId: 'L1', proposalId: 'p1', actorUserId: 'u1' })
    expect(h.db.redraftTradeProposal.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', status: 'pending' }, data: { vetoMode: 'commissioner' } })
    expect(h.db.survivorAuditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'trade_check_held', relatedEntityId: 'p1', relatedEntityType: 'redraft_trade_proposal' }) })
  })

  it('never throws when the database is still down', async () => {
    h.db.redraftTradeProposal.updateMany.mockRejectedValue(new Error('down'))
    h.db.survivorAuditEntry.create.mockRejectedValue(new Error('down'))
    await expect(holdRedraftProposalForCommissioner({ leagueId: 'L1', proposalId: 'p1' })).resolves.toBeUndefined()
    h.db.survivorAuditEntry.findMany.mockRejectedValue(new Error('down'))
    expect(await survivorHeldRedraftProposalIds()).toEqual([])
  })

  it('lists marked proposal ids once each', async () => {
    h.db.survivorAuditEntry.findMany.mockResolvedValue([{ relatedEntityId: 'p1' }, { relatedEntityId: 'p1' }, { relatedEntityId: null }, { relatedEntityId: 'p2' }])
    expect(await survivorHeldRedraftProposalIds()).toEqual(['p1', 'p2'])
  })
})

describe('Rooks vs Vets: the cross-league lookup', () => {
  beforeEach(() => {
    h.db.league.findUnique.mockResolvedValue({ season: 2026 })
    h.db.redraftSeason.findMany.mockResolvedValue([])
    h.db.survivorPlayer.findMany.mockResolvedValue([{ userId: 'u2' }])
  })

  it('is off by default: no other league is read', async () => {
    const r = await loadCastawayExperience('L1', ['u1', 'u2'], {})
    expect(r.u2).toEqual({ experience: 'rookie', source: 'default' })
    expect(h.db.survivorPlayer.findMany).not.toHaveBeenCalled()
  })

  it('on: a Survivor season in another league makes a veteran; the query excludes this league; manual still wins', async () => {
    const r = await loadCastawayExperience('L1', ['u1', 'u2'], { u1: 'veteran' }, undefined, { crossLeague: true })
    expect(r).toEqual({ u1: { experience: 'veteran', source: 'manual' }, u2: { experience: 'veteran', source: 'platform' } })
    const where = h.db.survivorPlayer.findMany.mock.calls[0][0].where
    expect(where.leagueId).toEqual({ not: 'L1' })
    expect(where.league.survivorMode).toBe(true)
    // Privacy: only user ids are selected, never a league id.
    expect(h.db.survivorPlayer.findMany.mock.calls[0][0].select).toEqual({ userId: true })
  })
})
