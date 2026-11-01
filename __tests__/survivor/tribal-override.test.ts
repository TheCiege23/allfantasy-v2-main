/**
 * The commissioner's "change a Tribal result" (lib/survivor/survivorTribalOverride.ts).
 *
 * The old override wrote the new name and the new manager's playerState and nothing else, so the
 * manager who was wrongly voted out stayed eliminated, released, on the jury and out of their tribe.
 * These tests pin the whole change: the wrong manager reinstated (state, tribe, chats, jury, roster,
 * season roster flag, counts), the old elimination record retired so the normal elimination runs for
 * the right manager, and the guards (latest council only, open council, finale, same player, not at
 * this council, tie).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, any>
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }))
const resolveElimination = vi.hoisted(() => vi.fn(async () => ({ ok: true })))

const matches = (row: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([k, v]) => {
    if (k === 'roster') return true // only used as a season filter on redraftRosterPlayer; the fake keeps one season
    if (k === 'leagueId_userId') return row.leagueId === v.leagueId && row.userId === v.userId
    if (k === 'tribeId_rosterId') return row.tribeId === v.tribeId && row.rosterId === v.rosterId
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('not' in v) return v.not === null ? row[k] != null : row[k] !== v.not
      if ('in' in v) return v.in.includes(row[k])
    }
    return row[k] === v
  })

function table(name: string) {
  const rows = () => (db.tables[name] ??= [])
  return {
    findFirst: vi.fn(async ({ where, orderBy }: Row = {}) => {
      let list = rows().filter((r) => matches(r, where))
      if (Array.isArray(orderBy)) list = [...list].sort((a, b) => b.week - a.week || b.councilNumber - a.councilNumber)
      else if (orderBy?.droppedAt === 'desc' || orderBy?.createdAt === 'desc') list = [...list].reverse()
      return list[0] ?? null
    }),
    findUnique: vi.fn(async ({ where }: Row) => rows().find((r) => matches(r, where)) ?? null),
    findMany: vi.fn(async ({ where }: Row = {}) => rows().filter((r) => matches(r, where))),
    count: vi.fn(async ({ where }: Row = {}) => rows().filter((r) => matches(r, where)).length),
    update: vi.fn(async ({ where, data }: Row) => {
      const row = rows().find((r) => matches(r, where))
      if (row) Object.assign(row, data)
      return row
    }),
    updateMany: vi.fn(async ({ where, data }: Row) => {
      const list = rows().filter((r) => matches(r, where))
      for (const r of list) Object.assign(r, data)
      return { count: list.length }
    }),
    deleteMany: vi.fn(async ({ where }: Row) => {
      const before = rows().length
      db.tables[name] = rows().filter((r) => !matches(r, where))
      return { count: before - db.tables[name]!.length }
    }),
    create: vi.fn(async ({ data }: Row) => (rows().push({ ...data }), data)),
    upsert: vi.fn(async ({ where, create }: Row) => {
      const row = rows().find((r) => matches(r, where))
      if (!row) rows().push({ ...create })
      return row ?? create
    }),
  }
}

const fake = vi.hoisted(() => ({} as Record<string, any>))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: fake }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: (_l: string, work: (tx: unknown) => unknown) => work(fake) }))
vi.mock('@/lib/survivor/survivorEliminationService', () => ({ resolveElimination }))

import { overrideTribalResult, readTribalOverrideTarget } from '@/lib/survivor/survivorTribalOverride'

const L = 'L1'
function seed(opts: { resolved?: boolean; activeCouncilId?: string | null; phase?: string; claimed?: boolean } = {}) {
  db.tables = {}
  for (const name of ['survivorTribalCouncil', 'survivorGameState', 'survivorPlayer', 'survivorAuditEntry', 'survivorTribe', 'roster', 'survivorJuryMember',
    'survivorTribeMember', 'survivorChatChannel', 'redraftRoster', 'redraftRosterPlayer']) fake[name] = table(name)
  const resolved = opts.resolved ?? true
  db.tables.survivorTribalCouncil = [
    { id: 'c-old', leagueId: L, week: 2, councilNumber: 1, eliminatedUserId: 'u-x', eliminatedName: 'Old', attendingTribeId: 'tA', isTie: false, status: 'closed', auditLog: null },
    { id: 'c1', leagueId: L, week: 3, councilNumber: 1, eliminatedUserId: 'u-wrong', eliminatedName: 'Wrong', attendingTribeId: 'tA', isTie: false, status: 'closed', auditLog: null },
  ]
  db.tables.survivorGameState = [{ leagueId: L, phase: opts.phase ?? 'pre_merge', activeCouncilId: opts.activeCouncilId ?? null, mergeTriggeredAt: null, activePlayerCount: 0, exilePlayerCount: 0 }]
  db.tables.survivorPlayer = [
    { id: 'p1', leagueId: L, userId: 'u-wrong', displayName: 'Wrong', playerState: resolved ? 'exile' : 'active', tribeId: 'tA', redraftRosterId: 'r-wrong', isJuryMember: resolved, eliminatedWeek: resolved ? 3 : null },
    { id: 'p2', leagueId: L, userId: 'u-right', displayName: 'Right', playerState: 'active', tribeId: 'tA', redraftRosterId: 'r-right' },
    { id: 'p3', leagueId: L, userId: 'u-other', displayName: 'Other Tribe', playerState: 'active', tribeId: 'tB', redraftRosterId: 'r-other' },
  ]
  db.tables.survivorTribe = [{ id: 'tA', leagueId: L, isActive: true, isMerged: false }]
  db.tables.roster = [{ id: 'r-wrong', leagueId: L, playerData: { players: [] }, redraftRosterId: 'rr-wrong' }]
  db.tables.redraftRoster = [{ id: 'rr-wrong', leagueId: L, seasonId: 's1', isEliminated: resolved }]
  db.tables.redraftRosterPlayer = resolved
    ? [
        { id: 'rp1', rosterId: 'rr-wrong', playerId: 'p-a', droppedAt: new Date() },
        { id: 'rp2', rosterId: 'rr-wrong', playerId: 'p-b', droppedAt: new Date() },
        ...(opts.claimed ? [{ id: 'rp3', rosterId: 'rr-thief', playerId: 'p-b', droppedAt: null }] : []),
      ]
    : []
  db.tables.survivorJuryMember = resolved ? [{ leagueId: L, rosterId: 'r-wrong' }] : []
  db.tables.survivorChatChannel = [
    { id: 'ch-tribe', leagueId: L, isArchived: false, channelType: 'tribe', tribeId: 'tA', memberUserIds: ['u-right'], readOnlyUserIds: [] },
    { id: 'ch-exile', leagueId: L, isArchived: false, channelType: 'exile', tribeId: null, memberUserIds: resolved ? ['u-wrong'] : [], readOnlyUserIds: [] },
  ]
  db.tables.survivorAuditEntry = resolved
    ? [
        { leagueId: L, action: 'roster_released', relatedEntityId: 'r-wrong', data: { councilId: 'c1', releasedPlayerIds: ['p-a', 'p-b'] }, createdAt: new Date() },
        { leagueId: L, action: 'player_eliminated', relatedEntityId: 'c1', data: {} },
      ]
    : []
}

const run = (over: Partial<Parameters<typeof overrideTribalResult>[0]> = {}) =>
  overrideTribalResult({ leagueId: L, councilId: 'c1', eliminateUserId: 'u-right', actorUserId: 'commish', notes: 'wrong votes counted', ...over })
const player = (userId: string) => db.tables.survivorPlayer!.find((p) => p.userId === userId)!

beforeEach(() => {
  vi.clearAllMocks()
  resolveElimination.mockResolvedValue({ ok: true })
})

describe('changing a carried-out Tribal result', () => {
  it('reinstates the wrong manager completely and votes out the right one the normal way', async () => {
    seed()
    const result = await run()
    expect(result).toMatchObject({ ok: true, reinstatedUserId: 'u-wrong', eliminatedUserId: 'u-right', restoredPlayerIds: ['p-a', 'p-b'], claimedElsewherePlayerIds: [], eliminationApplied: true })

    const wrong = player('u-wrong')
    expect(wrong).toMatchObject({ playerState: 'active', eliminatedWeek: null, tribeId: 'tA', canAccessTribeChat: true, canAccessExileChat: false, isJuryMember: false })
    expect(db.tables.survivorJuryMember).toEqual([])
    expect(db.tables.survivorTribeMember).toEqual([{ tribeId: 'tA', rosterId: 'r-wrong' }])
    expect(db.tables.survivorChatChannel!.find((c) => c.id === 'ch-tribe')!.memberUserIds).toEqual(['u-right', 'u-wrong'])
    expect(db.tables.survivorChatChannel!.find((c) => c.id === 'ch-exile')!.memberUserIds).toEqual([])
    expect(db.tables.redraftRosterPlayer!.every((r) => r.droppedAt === null)).toBe(true)
    expect(db.tables.redraftRoster![0]!.isEliminated).toBe(false)
    expect(db.tables.roster![0]!.playerData.players).toEqual(['p-a', 'p-b'])
    expect(db.tables.survivorGameState![0]!.activePlayerCount).toBe(3)

    const council = db.tables.survivorTribalCouncil!.find((c) => c.id === 'c1')!
    expect(council).toMatchObject({ eliminatedUserId: 'u-right', eliminatedRosterId: 'r-right', eliminatedName: 'Right' })
    expect(council.auditLog).toMatchObject({ commissionerOverride: true, overriddenFromUserId: 'u-wrong' })
    // The old elimination record is retired so resolveElimination runs again, for the right manager.
    expect(db.tables.survivorAuditEntry!.some((e) => e.action === 'player_eliminated')).toBe(false)
    expect(db.tables.survivorAuditEntry!.some((e) => e.action === 'player_eliminated_overridden')).toBe(true)
    expect(resolveElimination).toHaveBeenCalledWith(L, 'c1', 'commish')
    expect(db.tables.survivorAuditEntry!.map((e) => e.action)).toEqual(expect.arrayContaining(['elimination_reversed', 'tribal_result_overridden']))
  })

  it('a released player another team claimed since stays with that team, and is reported', async () => {
    seed({ claimed: true })
    const result = await run()
    expect(result).toMatchObject({ ok: true, restoredPlayerIds: ['p-a'], claimedElsewherePlayerIds: ['p-b'] })
    expect(db.tables.redraftRosterPlayer!.find((r) => r.id === 'rp2')!.droppedAt).not.toBeNull()
    expect(db.tables.roster![0]!.playerData.players).toEqual(['p-a'])
  })

  it('when the right manager’s elimination cannot run yet, says so (the change can be retried)', async () => {
    seed()
    resolveElimination.mockResolvedValueOnce({ ok: false, status: 409, code: 'roster_missing', error: 'Link this manager to their league roster before resolving elimination.' } as never)
    const result = await run()
    expect(result).toMatchObject({ ok: true, eliminationApplied: false, eliminationError: expect.stringContaining('Link this manager') })
  })
})

describe('changing a result that has not been carried out', () => {
  it('only repoints the council; nothing to undo, and the normal resolution eliminates the right manager later', async () => {
    seed({ resolved: false, activeCouncilId: 'c1' })
    const result = await run()
    expect(result).toMatchObject({ ok: true, reinstatedUserId: null, eliminationApplied: true, restoredPlayerIds: [] })
    expect(resolveElimination).not.toHaveBeenCalled()
    expect(player('u-wrong').playerState).toBe('active')
    expect(db.tables.survivorTribalCouncil!.find((c) => c.id === 'c1')!.eliminatedUserId).toBe('u-right')
  })
})

describe('guards', () => {
  it.each([
    ['an earlier council', { councilId: 'c-old', eliminateUserId: 'u-right' }, {}, 'not_latest'],
    ['the same manager', { eliminateUserId: 'u-wrong' }, { resolved: false }, 'same_player'],
    ['a manager from another tribe', { eliminateUserId: 'u-other' }, {}, 'not_at_council'],
    ['a manager who is not active (or not in the cast)', { eliminateUserId: 'u-gone' }, {}, 'not_active'],
    ['while another council is open', {}, { activeCouncilId: 'c-next' }, 'council_open'],
    ['after the finale started', {}, { phase: 'finale' }, 'season_over'],
  ])('refuses %s, changing nothing', async (_label, over, seedOpts, code) => {
    seed(seedOpts as never)
    const before = JSON.stringify(db.tables)
    const result = await run(over as never)
    expect(result).toMatchObject({ ok: false, code })
    expect(JSON.stringify(db.tables)).toBe(before)
    expect(resolveElimination).not.toHaveBeenCalled()
  })

  it('refuses a tied council', async () => {
    seed()
    db.tables.survivorTribalCouncil!.find((c) => c.id === 'c1')!.isTie = true
    expect(await run()).toMatchObject({ ok: false, code: 'tie_unresolved' })
  })
})

describe('what the form offers', () => {
  it('the latest council, who it names, whether it was carried out, and the active managers at it', async () => {
    seed()
    expect(await readTribalOverrideTarget(L)).toEqual({
      councilId: 'c1', week: 3, eliminatedUserId: 'u-wrong', eliminatedName: 'Wrong', resolved: true,
      candidates: [{ userId: 'u-right', name: 'Right' }],
    })
  })
})
