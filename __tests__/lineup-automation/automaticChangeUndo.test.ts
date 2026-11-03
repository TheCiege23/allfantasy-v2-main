/**
 * Undo an automatic lineup change (phase 12): the automatic save records where everyone sat, and undo
 * puts them back — through the REAL lineup engine — only while the lineup is untouched since. Harness
 * after __tests__/inactive-manager/lineupEngineOwnerReturn.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnyArgs = Record<string, any>

const h = vi.hoisted(() => {
  const state = {
    league: {} as Record<string, any>,
    roster: {} as Record<string, any>,
    template: { slots: [] } as Record<string, any>,
    lockedPlayerIds: [] as string[],
    audit: [] as Array<Record<string, any>>,
    leagueAudit: [] as Array<Record<string, any>>,
    commissioners: new Set<string>(),
  }
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const tx = {
    roster: {
      update: async (args: AnyArgs) => { state.roster.playerData = args.data.playerData; return state.roster },
      updateMany: async (args: AnyArgs) => {
        if (!same(state.roster.playerData, args.where.playerData.equals)) return { count: 0 }
        state.roster.playerData = args.data.playerData
        return { count: 1 }
      },
    },
    automationAuditLog: { create: async (args: AnyArgs) => { state.audit.push({ ...args.data, createdAt: new Date() }); return args.data } },
    afRosterLineupAssignment: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
  }
  const prisma = {
    league: { findUnique: async () => state.league },
    roster: {
      findFirst: async (args: AnyArgs) =>
        args?.where?.platformUserId === 'member2' ? { id: 'af-roster-2' } : args?.where?.platformUserId && args.where.platformUserId !== state.roster.platformUserId ? null : state.roster,
      findUnique: async () => state.roster,
      findMany: async () => [state.roster],
    },
    leagueTeam: { findMany: async () => [{ platformUserId: 'owner', teamName: 'Owner FC' }] },
    automationAuditLog: {
      findFirst: async (args: AnyArgs) => state.audit.find((r) => r.id === args.where.id) ?? null,
      findMany: async () => [...state.audit].reverse().map((r) => ({ ...r, entityId: r.entityId })),
    },
    leagueAuditLog: { findMany: async () => state.leagueAudit.map((r) => ({ entityId: r.entityId })) },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  }
  return { state, prisma }
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: vi.fn(async () => h.state.template) }))
vi.mock('@/lib/sport-defaults/LeagueVariantRegistry', () => ({ getFormatTypeForVariant: vi.fn(() => 'standard') }))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: vi.fn(async () => false) }))
vi.mock('@/lib/roster-lineup-engine/rosterMoveHistory', async (orig) => ({ ...(await orig<Record<string, unknown>>()), recordAfRosterMoveHistory: vi.fn(async () => {}) }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({
  resolveFullLineupLockContext: vi.fn(async () => ({ locked: false, lockedPlayerIds: h.state.lockedPlayerIds, policy: 'per_player', perPlayerReasons: {} })),
  upsertAfLineupLockState: vi.fn(async () => {}),
}))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/inactive-manager/inactiveManagerService', () => ({ endInactiveManagerModeOnOwnerSave: vi.fn(async () => true) }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: vi.fn(async (_l: string, u: string) => h.state.commissioners.has(u)) }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn(async (row: AnyArgs) => { h.state.leagueAudit.push(row) }) }))

import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import { lineupLayout, readAutomaticChangeUndo, restoreLineupLayout } from '@/lib/lineup-automation/automaticChangeUndo'
import { readAutomaticChanges, undoAutomaticChange } from '@/lib/lineup-automation/automaticChangeUndoService'

const tslot = (slotName: string, allowedPositions: string[], starterCount: number, slotOrder: number, extra: AnyArgs = {}) => ({
  slotName, allowedPositions, starterCount, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: allowedPositions.length > 1, slotOrder, ...extra,
})
const LEAGUE = {
  id: 'league-1', platform: 'manual', leagueVariant: null, lifecycleState: 'in_season', lockAllMoves: false, sport: 'NFL', leagueType: 'redraft', settings: {},
  irAllowOut: true, irAllowCovid: true, irAllowSuspended: true, irAllowNA: true, irAllowDNR: true, irAllowDoubtful: false,
  taxiSlots: 0, taxiAllowNonRookies: false, taxiYearsLimit: null, guillotineMode: false, bestBallMode: false, isDynasty: false, keeperPhaseActive: false,
}
const pd = (starter: string, bench: string[]) => ({
  lineup_sections: { starters: [{ id: starter, position: 'QB', slotIndex: 0 }], bench: bench.map((id) => ({ id, position: 'QB' })), ir: [], taxi: [], devy: [] },
  starters: [starter],
})
const BEFORE = pd('qb1', ['qb2'])

beforeEach(() => {
  vi.clearAllMocks()
  h.state.league = { ...LEAGUE }
  h.state.template = { templateId: 'nfl', name: 'nfl', formatType: 'standard', slots: [tslot('QB', ['QB'], 1, 0), tslot('BN', ['*'], 0, 1, { benchCount: 6 })] }
  h.state.roster = { id: 'af-roster-1', leagueId: 'league-1', platformUserId: 'owner', playerData: BEFORE, redraftRosterId: null }
  h.state.lockedPlayerIds = []
  h.state.audit = []
  h.state.leagueAudit = []
  h.state.commissioners = new Set(['commish'])
})

async function automaticSave() {
  const r = await persistRosterLineupWithEngine({
    leagueId: 'league-1', rosterId: 'af-roster-1', actorUserId: 'owner', expectedOwnerUserId: 'owner', expectedStarters: ['qb1'],
    nextPlayerData: pd('qb2', ['qb1']), season: 2026, week: 3, source: 'system',
    automationAudit: { id: 'auto-1', action: 'fill_empty_starters.filled', message: 'Started qb2.', metadata: { week: 3 } },
  })
  expect(r).toEqual({ ok: true })
}

const starter = () => lineupLayout(h.state.roster.playerData).starters.map((s) => s.id)

describe('automatic lineup change undo — pure', () => {
  it('round-trips a layout and keeps player details from the current lineup', () => {
    const now = { lineup_sections: { starters: [{ id: 'b', position: 'QB', slotIndex: 0, injury: 'Q' }], bench: [{ id: 'a', position: 'QB' }], ir: [], taxi: [], devy: [] } }
    const r = restoreLineupLayout(now, lineupLayout(BEFORE).starters.length ? { starters: [{ id: 'a', slot: 0 }], bench: ['b'], ir: [], taxi: [], devy: [] } : lineupLayout(BEFORE))
    if (!r.ok) throw new Error(r.reason)
    expect(lineupLayout(r.nextPlayerData)).toEqual({ starters: [{ id: 'a', slot: 0 }], bench: ['b'], ir: [], taxi: [], devy: [] })
    expect((r.nextPlayerData.lineup_sections as AnyArgs).bench[0]).toMatchObject({ id: 'b', injury: 'Q' })
    expect((r.nextPlayerData.lineup_sections as AnyArgs).bench[0].slotIndex).toBeUndefined()
  })

  it('refuses when the players on the team are not the same', () => {
    expect(restoreLineupLayout(pd('qb1', ['qb3']), lineupLayout(BEFORE))).toEqual({ ok: false, reason: 'players_changed' })
    expect(restoreLineupLayout(BEFORE, lineupLayout(BEFORE))).toEqual({ ok: false, reason: 'nothing_to_undo' })
  })

  it('reads only a well-formed undo', () => {
    expect(readAutomaticChangeUndo(null)).toBeNull()
    expect(readAutomaticChangeUndo({ undo: { layout: { starters: [{ id: 1 }] }, afterHash: 'x', season: 1, week: 1 } })).toBeNull()
  })
})

describe('automatic lineup change undo — through the lineup engine', () => {
  it('the automatic save records where everyone sat', async () => {
    await automaticSave()
    // The fingerprint matches the lineup as stored, even after a JSON round trip.
    h.state.roster.playerData = JSON.parse(JSON.stringify(h.state.roster.playerData))
    expect((await readAutomaticChanges('league-1', 'owner')).ok && (await readAutomaticChanges('league-1', 'owner') as AnyArgs).rows[0].undoable).toBe(true)
    expect(starter()).toEqual(['qb2'])
    expect(readAutomaticChangeUndo(h.state.audit[0]!.metadata)).toMatchObject({ layout: lineupLayout(BEFORE), season: 2026, week: 3 })
    expect(h.state.audit[0]!.metadata.week).toBe(3)
  })

  it('the owner undoes it: players back, logged, and offered no second time', async () => {
    await automaticSave()
    const log = await readAutomaticChanges('league-1', 'owner')
    expect(log).toMatchObject({ ok: true, rows: [{ id: 'auto-1', undoable: true, undone: false }] })
    expect(await undoAutomaticChange('league-1', 'owner', 'auto-1')).toMatchObject({ ok: true })
    expect(starter()).toEqual(['qb1'])
    expect(h.state.leagueAudit).toEqual([expect.objectContaining({ actionType: 'automatic_lineup_change.undone', entityId: 'auto-1', metadata: expect.objectContaining({ by: 'owner' }) })])
    expect(await readAutomaticChanges('league-1', 'owner')).toMatchObject({ rows: [{ undoable: false, undone: true }] })
    expect(await undoAutomaticChange('league-1', 'owner', 'auto-1')).toMatchObject({ ok: false, status: 409 })
  })

  it('refuses once the lineup was changed since, and leaves it alone', async () => {
    await automaticSave()
    // Saved again since: same placement, but not the lineup the automation wrote.
    h.state.roster.playerData = { ...h.state.roster.playerData, lineup_updated_at: '2026-10-30T00:00:00Z' }
    expect(await undoAutomaticChange('league-1', 'owner', 'auto-1')).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/changed since/) })
    expect(starter()).toEqual(['qb2'])
  })

  it("refuses when a moved player's game has started", async () => {
    await automaticSave()
    h.state.lockedPlayerIds = ['qb2']
    expect(await undoAutomaticChange('league-1', 'owner', 'auto-1')).toMatchObject({ ok: false, status: 403 })
    expect(starter()).toEqual(['qb2'])
  })

  it('the commissioner may undo it; another member may not', async () => {
    await automaticSave()
    expect(await undoAutomaticChange('league-1', 'stranger', 'auto-1')).toMatchObject({ ok: false, status: 403 })
    // A member with a team of their own still cannot undo someone else's.
    expect(await undoAutomaticChange('league-1', 'member2', 'auto-1')).toMatchObject({ ok: false, status: 403 })
    expect(starter()).toEqual(['qb2'])
    expect(await undoAutomaticChange('league-1', 'commish', 'auto-1')).toMatchObject({ ok: true })
    expect(starter()).toEqual(['qb1'])
    expect(h.state.leagueAudit[0]!.metadata.by).toBe('commissioner')
  })
})
