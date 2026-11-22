/**
 * The roster-limit warning on a drop or a claim (lib/waiver-wire/lineup-fill-warning.ts): a move that
 * leaves a starting slot unfillable answers LINEUP_WARNING once; a confirmed retry goes through.
 * A warning, never a block.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  executeAdd: vi.fn(),
  createClaim: vi.fn(),
  effective: vi.fn(),
  prisma: {
    league: { findUnique: vi.fn(), findFirst: vi.fn() },
    roster: { findFirst: vi.fn() },
    leagueTeam: { findFirst: vi.fn() },
    sportsPlayer: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/server/services/leagueActionGate', () => ({ assertLeagueActionGate: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: vi.fn() }))
vi.mock('@/lib/league/write-authority-server', () => ({ resolveWriteAuthorityEnvelope: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/waiver-wire/free-agent-service', () => ({ executeImmediateAddDrop: m.executeAdd }))
vi.mock('@/lib/waiver-wire/season-phase-gate', () => ({
  loadWaiverPhasePolicy: vi.fn().mockResolvedValue({ code: null, claimsAllowed: true, immediateAddsAllowed: true, firstComeAdds: false, reason: null }),
}))
vi.mock('@/lib/waiver-wire/daily-schedule-gate', () => ({
  loadDailyTransactionPolicy: vi.fn().mockResolvedValue(null),
  dailyScheduleImmediateAddRefusal: vi.fn().mockResolvedValue(null),
  dailyUnlockImmediateAddRefusal: vi.fn().mockResolvedValue(null),
  PENDING_CLAIM_ON_PLAYER_MESSAGE: 'pending',
}))
vi.mock('@/lib/waiver-wire', () => ({
  createClaim: m.createClaim,
  getClaimsByRoster: vi.fn().mockResolvedValue([]),
  getEffectiveLeagueWaiverSettings: m.effective,
  getPendingClaims: vi.fn().mockResolvedValue([]),
  getProcessedClaimsAndTransactions: vi.fn().mockResolvedValue({ claims: [], transactions: [] }),
}))
vi.mock('@/lib/waiver-wire/process-engine', () => ({ processWaiverClaimsForLeague: vi.fn() }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: vi.fn().mockResolvedValue('member') }))
vi.mock('@/lib/ai/action-validation', () => ({ validateAiActionExecution: vi.fn(() => ({ ok: true })) }))
vi.mock('@/lib/waiver-wire/commissioner-claim-override', () => ({ mergeCommissionerOverrides: vi.fn((x) => x ?? {}) }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: vi.fn(() => false) }))
vi.mock('@/lib/league-notifications/realtimeHint', () => ({ publishLeagueRealtimeHint: vi.fn() }))

import { POST as addDrop } from '@/app/api/waiver-wire/leagues/[leagueId]/add-drop/route'
import { POST as submitClaim } from '@/app/api/waiver-wire/leagues/[leagueId]/claims/route'
import {
  lineupFillWarningForMove,
  loadLineupFillWarning,
  positionTokens,
  startingSlotFill,
} from '@/lib/waiver-wire/lineup-fill-warning'
import { confirmLineupWarning, isLineupWarningResponse, lineupWarningSlotNames } from '@/lib/waiver-wire/lineup-warning-prompt'

// QB, RB, WR, TE, FLEX, K — and one kicker on the roster.
const SETTINGS = { roster: { config: { sections: [{ slots: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1, K: 1, BN: 4, IR: 1 } }] } } }
const POSITIONS: Record<string, string> = { qb: 'QB', rb1: 'RB', rb2: 'RB', wr1: 'WR', te1: 'TE', k1: 'K', fa_k: 'K', fa_wr: 'WR', hurt: 'WR' }
const ROSTER = { players: ['qb', 'rb1', 'rb2', 'wr1', 'te1', 'k1'] }

const params = { params: Promise.resolve({ leagueId: 'L1' }) }
const body = (b: unknown) => ({ json: async () => b }) as never

beforeEach(() => {
  vi.clearAllMocks()
  m.prisma.roster.findFirst.mockResolvedValue({ id: 'R1', playerData: ROSTER })
  m.prisma.league.findUnique.mockResolvedValue({ sport: 'NFL', settings: SETTINGS, leagueVariant: null })
  m.prisma.sportsPlayer.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => ({ id, position: POSITIONS[id] ?? null })),
  )
  m.effective.mockResolvedValue({ normalizedWaiverType: 'fcfs', instantFaAfterClear: false })
  m.executeAdd.mockResolvedValue({ ok: true, transaction: { id: 'T1' } })
  m.createClaim.mockResolvedValue({ id: 'C1' })
})

describe('startingSlotFill (pure)', () => {
  const caps = (o: Record<string, number>) => new Map(Object.entries(o))
  const p = (id: string, pos: string) => ({ id, positions: positionTokens(pos) })

  it('a full lineup fills every slot', () => {
    const r = startingSlotFill({ sport: 'NFL', starterCapacities: caps({ QB: 1, RB: 1, FLX: 1 }), players: [p('a', 'QB'), p('b', 'RB'), p('c', 'WR')] })
    expect(r).toEqual({ slots: 3, filled: 3, unfilledSlots: [] })
  })

  it('a maximum matching, not a greedy fill: the flex never strands a dedicated slot', () => {
    // Two RBs and a TE across RB, FLEX, TE: only one assignment fills all three.
    const r = startingSlotFill({ sport: 'NFL', starterCapacities: caps({ FLX: 1, RB: 1, TE: 1 }), players: [p('te', 'TE'), p('r1', 'RB'), p('r2', 'RB')] })
    expect(r.filled).toBe(3)
  })

  it('names the slot left empty', () => {
    const r = startingSlotFill({ sport: 'NFL', starterCapacities: caps({ QB: 1, K: 1 }), players: [p('a', 'QB')] })
    expect(r).toEqual({ slots: 2, filled: 1, unfilledSlots: ['K'] })
  })

  it('reads dual eligibility ("G-F", "SS,2B") and the DST alias', () => {
    expect(positionTokens('G-F')).toEqual(['G', 'F'])
    expect(positionTokens('SS,2B')).toEqual(['SS', '2B'])
    expect(positionTokens('DST')).toEqual(['DEF'])
  })

  it('warns only when a move makes it WORSE', () => {
    const c = caps({ QB: 1, K: 1 })
    const qb = p('qb', 'QB')
    const k = p('k', 'K')
    expect(lineupFillWarningForMove({ sport: 'NFL', starterCapacities: c, before: [qb, k], after: [qb] })?.unfilledSlots).toEqual(['K'])
    // Already short a kicker: dropping a bench WR leaves it exactly as short — no nagging.
    expect(lineupFillWarningForMove({ sport: 'NFL', starterCapacities: c, before: [qb, p('w', 'WR')], after: [qb] })).toBeNull()
    expect(lineupFillWarningForMove({ sport: 'NFL', starterCapacities: c, before: [qb, k], after: [qb, k] })).toBeNull()
  })
})

describe('loadLineupFillWarning', () => {
  it('dropping the only kicker warns', async () => {
    const w = await loadLineupFillWarning({ leagueId: 'L1', rosterId: 'R1', addPlayerId: 'fa_wr', dropPlayerId: 'k1' })
    expect(w).toMatchObject({ code: 'STARTERS_UNFILLABLE', unfilledSlots: ['K'] })
  })

  it('swapping kicker for kicker, or dropping depth, does not', async () => {
    expect(await loadLineupFillWarning({ leagueId: 'L1', rosterId: 'R1', addPlayerId: 'fa_k', dropPlayerId: 'k1' })).toBeNull()
    // rb2 sits in FLEX, but the added WR covers it.
    expect(await loadLineupFillWarning({ leagueId: 'L1', rosterId: 'R1', addPlayerId: 'fa_wr', dropPlayerId: 'rb2' })).toBeNull()
  })

  it('an IR player cannot start, so he does not cover a slot', async () => {
    m.prisma.roster.findFirst.mockResolvedValue({
      id: 'R1',
      playerData: { players: ['qb', 'rb1', 'wr1', 'te1', 'k1', 'hurt'], ir: ['hurt'] },
    })
    // FLEX was already empty (the WR is on IR): dropping the only RB empties RB too.
    const w = await loadLineupFillWarning({ leagueId: 'L1', rosterId: 'R1', addPlayerId: null, dropPlayerId: 'rb1' })
    expect(w?.unfilledSlots.sort()).toEqual(['FLX', 'RB'])
  })

  it('a player with no position on file means "could not verify": no warning', async () => {
    m.prisma.sportsPlayer.findMany.mockResolvedValue([{ id: 'k1', position: null }])
    expect(await loadLineupFillWarning({ leagueId: 'L1', rosterId: 'R1', dropPlayerId: 'k1' })).toBeNull()
  })

  it('a failed read is no warning, never a throw', async () => {
    m.prisma.roster.findFirst.mockRejectedValue(new Error('db down'))
    expect(await loadLineupFillWarning({ leagueId: 'L1', rosterId: 'R1', dropPlayerId: 'k1' })).toBeNull()
  })
})

describe('add/drop: the warning and the confirm path', () => {
  it('asks first: 409 LINEUP_WARNING, nothing moves', async () => {
    const res = await addDrop(body({ addPlayerId: 'fa_wr', dropPlayerId: 'k1' }), params)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json).toMatchObject({ ok: false, code: 'LINEUP_WARNING', warning: { unfilledSlots: ['K'] } })
    expect(m.executeAdd).not.toHaveBeenCalled()
  })

  it('a confirmed retry goes through — it is not a block', async () => {
    const res = await addDrop(body({ addPlayerId: 'fa_wr', dropPlayerId: 'k1', confirmLineupWarning: true }), params)
    expect(res.status).toBe(200)
    expect(m.executeAdd).toHaveBeenCalledWith('L1', 'R1', { addPlayerId: 'fa_wr', dropPlayerId: 'k1' })
  })

  it('an add with no drop is never warned', async () => {
    const res = await addDrop(body({ addPlayerId: 'fa_wr' }), params)
    expect(res.status).toBe(200)
    expect(m.prisma.sportsPlayer.findMany).not.toHaveBeenCalled()
  })
})

describe('claims: the warning and the confirm path', () => {
  it('asks first: 409 LINEUP_WARNING, no claim created', async () => {
    const res = await submitClaim(body({ addPlayerId: 'fa_wr', dropPlayerId: 'k1' }), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'LINEUP_WARNING', warning: { unfilledSlots: ['K'] } })
    expect(m.createClaim).not.toHaveBeenCalled()
  })

  it('a confirmed claim is created', async () => {
    const res = await submitClaim(body({ addPlayerId: 'fa_wr', dropPlayerId: 'k1', confirmLineupWarning: true }), params)
    expect(res.status).toBe(200)
    expect(m.createClaim).toHaveBeenCalled()
  })
})

describe('the screens’ confirm prompt', () => {
  const t = (key: string, vars: Record<string, string>) => `${key}:${vars.slots}`
  const warning = { code: 'LINEUP_WARNING', warning: { unfilledSlots: ['K', 'FLX', 'K'] } }

  it('recognises the response and names the slots as a manager reads them', () => {
    expect(isLineupWarningResponse(warning)).toBe(true)
    expect(isLineupWarningResponse({ code: 'WAIVER_REQUIRED' })).toBe(false)
    expect(lineupWarningSlotNames(warning)).toBe('K, FLEX')
  })

  it('returns the manager’s answer', () => {
    const asked: string[] = []
    expect(confirmLineupWarning(warning, t, (msg) => (asked.push(msg), true))).toBe(true)
    expect(confirmLineupWarning(warning, t, () => false)).toBe(false)
    expect(asked).toEqual(['waiverFa.lineupWarning:K, FLEX'])
    expect(confirmLineupWarning(warning, t, null)).toBe(false)
  })
})
