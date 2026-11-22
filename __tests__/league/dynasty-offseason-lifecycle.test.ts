import { beforeEach, describe, expect, it, vi } from 'vitest'
// These tests isolate their own waiver/lifecycle behavior; the pre-draft policy has its own route tests.
vi.mock('@/lib/waiver-wire/season-phase-gate', () => ({
  loadWaiverPhasePolicy: async () => ({ phase: 'regular', claimsAllowed: true, immediateAddsAllowed: true, firstComeAdds: false, code: null, reason: null }),
  loadWaiverRunPhaseGate: async () => () => null,
}))


/**
 * A dynasty league trades, adds, drops and claims between the championship and its rookie draft.
 * The lifecycle table locks `offseason` and `pre_draft` for everyone; the dynasty family is granted
 * the four player actions on top of it — `pre_draft` only before a year-two-plus draft, never before
 * a brand-new league's startup draft. Redraft and keeper leagues keep the table exactly.
 */

const m = vi.hoisted(() => ({
  prisma: {
    league: { findUnique: vi.fn() },
    roster: { findFirst: vi.fn() },
    leagueTeam: { findFirst: vi.fn() },
    draftSession: { count: vi.fn() },
    redraftSeason: { count: vi.fn() },
  },
  executeAdd: vi.fn(),
  effective: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/server/services/permissionService', () => ({
  canViewLeague: vi.fn().mockResolvedValue(true),
  isElevatedCommissioner: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/lib/waiver-wire', () => ({ getEffectiveLeagueWaiverSettings: m.effective }))
vi.mock('@/lib/waiver-wire/free-agent-service', () => ({ executeImmediateAddDrop: m.executeAdd }))
vi.mock('@/lib/waiver-wire/daily-schedule-gate', () => ({
  loadDailyTransactionPolicy: vi.fn().mockResolvedValue(null),
  dailyScheduleImmediateAddRefusal: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({
  assertRosterTransactionsAllowed: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: vi.fn() }))
vi.mock('@/lib/league/write-authority-server', () => ({ resolveWriteAuthorityEnvelope: vi.fn().mockResolvedValue(null) }))

import {
  DYNASTY_OFFSEASON_MOVE_ACTIONS,
  assertLifecycleActionAllowed,
  getAllowedActions,
  isActionAllowed,
} from '@/server/services/leagueLifecycleService'
import { POST as addDrop } from '@/app/api/waiver-wire/leagues/[leagueId]/add-drop/route'

const DYNASTY = { dynastyFamily: true, hasPriorSeason: true }
const STARTUP = { dynastyFamily: true, hasPriorSeason: false }
const REDRAFT = { dynastyFamily: false, hasPriorSeason: true }
const MOVES = [...DYNASTY_OFFSEASON_MOVE_ACTIONS]

describe('lifecycle permission map — dynasty offseason moves', () => {
  it('covers trades, roster edits, waiver claims and waiver runs', () => {
    expect(MOVES.sort()).toEqual(['roster_edit', 'trade_act', 'waiver_claim_submit', 'waiver_process_run'])
  })

  it('dynasty: all four are allowed in the offseason', () => {
    for (const action of MOVES) expect(isActionAllowed(action, 'offseason', { league: DYNASTY })).toBe(true)
  })

  it('dynasty: allowed in pre_draft before a year-two-plus (rookie) draft', () => {
    for (const action of MOVES) expect(isActionAllowed(action, 'pre_draft', { league: DYNASTY })).toBe(true)
  })

  it('dynasty: still refused before a brand-new league’s startup draft', () => {
    for (const action of MOVES) expect(isActionAllowed(action, 'pre_draft', { league: STARTUP })).toBe(false)
  })

  it('redraft / keeper: unchanged — refused in offseason and pre_draft', () => {
    for (const action of MOVES) {
      expect(isActionAllowed(action, 'offseason', { league: REDRAFT })).toBe(false)
      expect(isActionAllowed(action, 'pre_draft', { league: REDRAFT })).toBe(false)
      // No context at all is the table, exactly as before.
      expect(isActionAllowed(action, 'offseason')).toBe(false)
    }
  })

  it('dynasty grant reaches no other phase and no other action', () => {
    for (const state of ['setup', 'drafting', 'completed', 'renewal_pending', 'archived'] as const) {
      for (const action of MOVES) expect(isActionAllowed(action, state, { league: DYNASTY })).toBe(false)
    }
    expect(isActionAllowed('settings_edit_scoring', 'offseason', { league: DYNASTY })).toBe(false)
    expect(isActionAllowed('draft_pick', 'pre_draft', { league: DYNASTY })).toBe(false)
  })

  it('the allowed-actions snapshot lists them for a dynasty league only', () => {
    const row = { lifecycleState: 'offseason' as const, locked: false, emergencyPaused: false }
    expect(getAllowedActions(row, DYNASTY).actions).toEqual(expect.arrayContaining(MOVES))
    expect(getAllowedActions(row, REDRAFT).actions).not.toContain('trade_act')
    expect(getAllowedActions(row).actions).not.toContain('trade_act')
  })
})

function leagueRow(lifecycleState: string, leagueType: string, isDynasty = leagueType === 'dynasty') {
  return {
    id: 'L',
    userId: 'owner',
    lifecycleState,
    locked: false,
    emergencyPaused: false,
    lifecycleMetadata: null,
    settings: null,
    status: null,
    leagueType,
    isDynasty,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.prisma.draftSession.count.mockResolvedValue(1)
  m.prisma.redraftSeason.count.mockResolvedValue(1)
  m.prisma.roster.findFirst.mockResolvedValue({ id: 'r1' })
  m.effective.mockResolvedValue({ normalizedWaiverType: 'fcfs', instantFaAfterClear: false })
  m.executeAdd.mockResolvedValue({ ok: true, transaction: { id: 't1' } })
})

describe('assertLifecycleActionAllowed — loads the league context itself', () => {
  it('dynasty offseason trade is allowed; redraft offseason trade is refused', async () => {
    m.prisma.league.findUnique.mockResolvedValueOnce(leagueRow('offseason', 'dynasty'))
    expect(await assertLifecycleActionAllowed('L', 'trade_act', 'u1')).toEqual({ ok: true })

    m.prisma.league.findUnique.mockResolvedValueOnce(leagueRow('offseason', 'redraft'))
    expect(await assertLifecycleActionAllowed('L', 'trade_act', 'u1')).toMatchObject({
      ok: false,
      err: { code: 'LIFECYCLE_BLOCKED' },
    })
    // Offseason needs no prior-season read.
    expect(m.prisma.draftSession.count).not.toHaveBeenCalled()
  })

  it('legacy isDynasty rows count as dynasty', async () => {
    m.prisma.league.findUnique.mockResolvedValueOnce(leagueRow('offseason', 'redraft', true))
    expect(await assertLifecycleActionAllowed('L', 'waiver_claim_submit', 'u1')).toEqual({ ok: true })
  })

  it('pre_draft: allowed once the league has finished a draft or season, refused before its first', async () => {
    m.prisma.league.findUnique.mockResolvedValueOnce(leagueRow('pre_draft', 'devy'))
    expect(await assertLifecycleActionAllowed('L', 'trade_act', 'u1')).toEqual({ ok: true })

    m.prisma.draftSession.count.mockResolvedValue(0)
    m.prisma.redraftSeason.count.mockResolvedValue(0)
    m.prisma.league.findUnique.mockResolvedValueOnce(leagueRow('pre_draft', 'dynasty'))
    expect(await assertLifecycleActionAllowed('L', 'trade_act', 'u1')).toMatchObject({
      ok: false,
      err: { code: 'LIFECYCLE_BLOCKED' },
    })
  })

  it('a locked dynasty league is still locked in the offseason', async () => {
    m.prisma.league.findUnique.mockResolvedValueOnce({ ...leagueRow('offseason', 'dynasty'), locked: true })
    expect(await assertLifecycleActionAllowed('L', 'trade_act', 'u1')).toMatchObject({
      ok: false,
      err: { code: 'LEAGUE_LOCKED' },
    })
  })
})

describe('POST /api/waiver-wire/leagues/[leagueId]/add-drop — through the real action gate', () => {
  async function call() {
    const req = new Request('http://x/api', { method: 'POST', body: JSON.stringify({ addPlayerId: 'p9' }) })
    const res = await addDrop(req as never, { params: Promise.resolve({ leagueId: 'L' }) })
    return { status: res.status, body: (await res.json()) as { code?: string; error?: string } }
  }

  it('a dynasty manager can add a free agent in the offseason', async () => {
    m.prisma.league.findUnique.mockResolvedValue(leagueRow('offseason', 'dynasty'))
    const r = await call()
    expect(r.status).toBe(200)
    expect(m.executeAdd).toHaveBeenCalledWith('L', 'r1', { addPlayerId: 'p9', dropPlayerId: null })
  })

  it('a redraft manager is still refused in the offseason, and nothing is written', async () => {
    m.prisma.league.findUnique.mockResolvedValue(leagueRow('offseason', 'redraft'))
    const r = await call()
    expect(r.status).not.toBe(200)
    expect(r.body.code).toBe('LEAGUE_NOT_ACTIVE')
    expect(r.body.error).toMatch(/not allowed in lifecycle state "offseason"/)
    expect(m.executeAdd).not.toHaveBeenCalled()
  })
})
