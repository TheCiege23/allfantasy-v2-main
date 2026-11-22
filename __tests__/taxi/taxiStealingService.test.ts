/** Taxi stealing — claims, protection, the hourly run, Commish OS and Chimmy (lib/taxi/taxiStealingService.ts). */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { rosterId: string; playerId: string; playerName: string; position: string; team: string; slotType: string; droppedAt: null; acquisitionType?: string }

const m = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  rosters: [] as Array<{ id: string; platformUserId: string; playerData: Record<string, unknown> }>,
  players: [] as Array<{ rosterId: string; playerId: string; playerName: string; position: string; team: string; slotType: string; droppedAt: null; acquisitionType?: string }>,
  commissioners: new Set<string>(),
  ownerPlan: true,
  platform: 'manual',
  persist: { ok: true } as { ok: true } | { ok: false; error: string },
  prisma: {} as Record<string, any>,
  persistCalls: [] as any[],
}))

const sql = (s: TemplateStringsArray) => s.join('?')
const pd = (taxi: string[], bench: string[] = []) => ({ lineup_sections: { starters: [], bench: bench.map((id) => ({ id })), ir: [], taxi: taxi.map((id) => ({ id })), devy: [] } })

Object.assign(m.prisma, {
  league: { findUnique: vi.fn(async () => ({ id: 'L', name: 'Dynasty One', userId: 'owner', platform: m.platform, leagueType: 'dynasty', isDynasty: true, settings: structuredClone(m.settings) })) },
  redraftSeason: { findFirst: vi.fn(async () => ({ id: 's1', season: 2026, currentWeek: 9 })) },
  roster: {
    findMany: vi.fn(async ({ where }: any) => structuredClone(where?.id?.in ? m.rosters.filter((r) => where.id.in.includes(r.id)) : m.rosters)),
    findUnique: vi.fn(async ({ where }: any) => structuredClone(m.rosters.find((r) => r.id === where.id) ?? null)),
    update: vi.fn(async ({ where, data }: any) => {
      m.rosters.find((r) => r.id === where.id)!.playerData = data.playerData
      return {}
    }),
  },
  redraftRoster: { findMany: vi.fn(async () => m.rosters.map((r) => ({ id: `t-${r.id}`, teamName: r.id === 'rA' ? 'Alpha' : r.id === 'rB' ? 'Bravo' : 'Charlie', ownerName: 'x' }))) },
  redraftRosterPlayer: {
    findMany: vi.fn(async ({ where }: any) => m.players.filter((p) => where.rosterId.in.includes(p.rosterId) && where.playerId.in.includes(p.playerId))),
    findFirst: vi.fn(async ({ where }: any) => m.players.find((p) => p.rosterId === where.rosterId && p.playerId === where.playerId) ?? null),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const hit = m.players.filter((p) => p.rosterId === where.rosterId && p.playerId === where.playerId)
      for (const p of hit) Object.assign(p, data)
      return { count: hit.length }
    }),
  },
  appUser: { findUnique: vi.fn(async ({ where }: any) => ({ id: where.id, email: null, username: null })) },
  userProfile: { findUnique: vi.fn(async () => null) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(m.prisma)),
  $queryRaw: vi.fn(async (s: TemplateStringsArray) => {
    const q = sql(s)
    if (q.includes('SELECT settings FROM leagues')) return [{ settings: structuredClone(m.settings) }]
    if (q.includes('SELECT id FROM leagues')) return (m.settings.taxi_steal_claims as any[] | undefined)?.some((c) => c.status === 'open') ? [{ id: 'L' }] : []
    throw new Error(`unexpected query ${q}`)
  }),
  $executeRaw: vi.fn(async (s: TemplateStringsArray, ...values: unknown[]) => {
    if (!sql(s).includes('UPDATE leagues')) throw new Error('unexpected write')
    m.settings[values[0] as string] = JSON.parse(values[1] as string)
    return 1
  }),
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: vi.fn(async (_l: string, u: string) => m.commissioners.has(u)) }))
vi.mock('@/lib/stat-corrections/applyStatCorrections', () => ({ ownerHasAfCommissionerPlan: vi.fn(async () => m.ownerPlan) }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({ hasAfCommissionerPlan: vi.fn(async () => true) }))
vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({ isOrphanPlatformUserId: (id: string) => id.startsWith('orphan') }))
vi.mock('@/lib/dispersal-draft/nativeDispersal', async () => {
  const real = await vi.importActual<typeof import('@/lib/dispersal-draft/nativeDispersal')>('@/lib/dispersal-draft/nativeDispersal')
  return { ...real, seasonTeamsByRoster: vi.fn(async () => new Map(m.rosters.map((r) => [r.id, `t-${r.id}`]))) }
})
vi.mock('@/lib/roster-lineup-engine/lineupService', () => ({
  persistRosterLineupWithEngine: vi.fn(async (input: any) => {
    m.persistCalls.push(input)
    if (m.persist.ok) m.rosters.find((r) => r.id === input.rosterId)!.playerData = input.nextPlayerData
    return m.persist
  }),
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn(async () => undefined) }))

import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import {
  claimTaxiPlayer,
  protectTaxiPlayer,
  readTaxiStealingForChimmy,
  readTaxiStealTasks,
  readTaxiStealView,
  releaseTaxiPlayer,
  runTaxiStealResolution,
  withdrawTaxiClaim,
} from '@/lib/taxi/taxiStealingService'

const T0 = new Date('2026-10-27T12:00:00Z')
const LATER = new Date('2026-10-29T13:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  m.settings = { inviteCode: 'KEEP-ME', taxi_stealing: { enabled: true, protectHours: 48, claimsPerSeason: 1 } }
  m.rosters = [
    { id: 'rA', platformUserId: 'userA', playerData: pd(['p1', 'p2'], ['b1']) },
    { id: 'rB', platformUserId: 'userB', playerData: pd([], ['b2']) },
    { id: 'rC', platformUserId: 'userC', playerData: pd(['p3']) },
  ]
  m.players = [
    { rosterId: 't-rA', playerId: 'p1', playerName: 'Rookie One', position: 'WR', team: 'KC', slotType: 'TAXI', droppedAt: null },
    { rosterId: 't-rA', playerId: 'p2', playerName: 'Rookie Two', position: 'RB', team: 'DET', slotType: 'TAXI', droppedAt: null },
    { rosterId: 't-rC', playerId: 'p3', playerName: 'Rookie Three', position: 'TE', team: 'SF', slotType: 'TAXI', droppedAt: null },
  ] satisfies Row[]
  m.commissioners = new Set(['comm'])
  m.ownerPlan = true
  m.platform = 'manual'
  m.persist = { ok: true }
  m.persistCalls = []
})

const claims = () => (m.settings.taxi_steal_claims as any[]) ?? []

describe('claiming', () => {
  it('opens a claim with the window’s deadline and tells the owner', async () => {
    const r = await claimTaxiPlayer('L', 'userB', { playerId: 'p1' }, T0)
    expect(r.ok).toBe(true)
    expect(claims()).toEqual([expect.objectContaining({ playerId: 'p1', playerName: 'Rookie One', fromRosterId: 'rA', toRosterId: 'rB', status: 'open', season: 2026, deadline: '2026-10-29T12:00:00.000Z' })])
    expect(m.settings.inviteCode).toBe('KEEP-ME')
    expect(vi.mocked(dispatchNotification).mock.calls.map((c) => [c[0].userIds[0], c[0].title])).toEqual([['userA', 'Bravo claimed Rookie One off your taxi squad']])
  })

  it('refuses what the rule refuses', async () => {
    expect(await claimTaxiPlayer('L', 'userA', { playerId: 'p1' }, T0)).toMatchObject({ ok: false, code: 'OWN_PLAYER' })
    expect(await claimTaxiPlayer('L', 'userB', { playerId: 'b1' }, T0)).toMatchObject({ ok: false, code: 'NOT_ON_TAXI' })
    expect(await claimTaxiPlayer('L', 'stranger', { playerId: 'p1' }, T0)).toMatchObject({ ok: false, status: 403 })
    expect((await claimTaxiPlayer('L', 'userB', { playerId: 'p1' }, T0)).ok).toBe(true)
    expect(await claimTaxiPlayer('L', 'userC', { playerId: 'p1' }, T0)).toMatchObject({ ok: false, code: 'ALREADY_CLAIMED' })
    expect(await claimTaxiPlayer('L', 'userB', { playerId: 'p3' }, T0)).toMatchObject({ ok: false, code: 'NO_CLAIMS_LEFT' })
    expect(claims()).toHaveLength(1)
  })

  it('takes no claims while the rule is off or the owner’s plan has lapsed, or outside native leagues', async () => {
    m.settings.taxi_stealing = { enabled: false }
    expect(await claimTaxiPlayer('L', 'userB', { playerId: 'p1' }, T0)).toMatchObject({ ok: false, code: 'RULE_OFF' })
    m.settings.taxi_stealing = { enabled: true }
    m.ownerPlan = false
    expect(await claimTaxiPlayer('L', 'userB', { playerId: 'p1' }, T0)).toMatchObject({ ok: false, status: 403 })
    m.ownerPlan = true
    m.platform = 'sleeper'
    expect(await claimTaxiPlayer('L', 'userB', { playerId: 'p1' }, T0)).toMatchObject({ ok: false, status: 400 })
    expect(claims()).toEqual([])
  })
})

describe('answering a claim', () => {
  beforeEach(async () => {
    await claimTaxiPlayer('L', 'userB', { playerId: 'p1' }, T0)
    vi.mocked(dispatchNotification).mockClear()
  })
  const id = () => claims()[0].id

  it('the owner protects the player with an ordinary lineup save that names the protection', async () => {
    expect(await protectTaxiPlayer('L', 'userB', { claimId: id() }, T0)).toMatchObject({ ok: false, status: 403 })
    const r = await protectTaxiPlayer('L', 'userA', { claimId: id() }, T0)
    expect(r.ok).toBe(true)
    expect(m.persistCalls).toEqual([expect.objectContaining({ rosterId: 'rA', actorUserId: 'userA', source: 'user_save', taxiProtection: ['p1'], season: 2026, week: 9 })])
    const sections = (m.persistCalls[0].nextPlayerData as any).lineup_sections
    expect(sections.taxi.map((x: any) => x.id)).toEqual(['p2'])
    expect(sections.bench.map((x: any) => x.id)).toEqual(['b1', 'p1'])
    expect(claims()[0]).toMatchObject({ status: 'protected' })
    expect(vi.mocked(dispatchNotification).mock.calls.map((c) => [c[0].userIds[0], c[0].title])).toEqual([
      ['userA', 'You kept Rookie One'],
      ['userB', 'Alpha protected Rookie One'],
    ])
  })

  it('a lineup save the league refuses leaves the claim open, with the reason', async () => {
    m.persist = { ok: false, error: 'Your bench is full.' }
    expect(await protectTaxiPlayer('L', 'userA', { claimId: id() }, T0)).toEqual({ ok: false, status: 409, error: 'Your bench is full.', code: 'LINEUP_REFUSED' })
    expect(claims()[0].status).toBe('open')
  })

  it('the owner may let the player go now, which moves them to the claimer’s bench', async () => {
    const r = await releaseTaxiPlayer('L', 'userA', { claimId: id() }, T0)
    expect(r).toMatchObject({ ok: true, claim: { status: 'stolen' } })
    expect(m.players.find((p) => p.playerId === 'p1')).toMatchObject({ rosterId: 't-rB', slotType: 'BENCH', acquisitionType: 'taxi_steal' })
    const lineup = (rid: string) => (m.rosters.find((r) => r.id === rid)!.playerData as any).lineup_sections
    expect(lineup('rA').taxi.map((x: any) => x.id)).toEqual(['p2'])
    expect(lineup('rB').bench.map((x: any) => x.id)).toEqual(['b2', 'p1'])
    expect(vi.mocked(dispatchNotification).mock.calls.map((c) => c[0].title).sort()).toEqual(['Rookie One is yours', 'Rookie One moved to Bravo'])
  })

  it('the claimer may withdraw, and a withdrawn claim does not count', async () => {
    expect(await withdrawTaxiClaim('L', 'userA', { claimId: id() }, T0)).toMatchObject({ ok: false, status: 403 })
    expect(await withdrawTaxiClaim('L', 'userB', { claimId: id() }, T0)).toMatchObject({ ok: true, claim: { status: 'withdrawn' } })
    expect((await claimTaxiPlayer('L', 'userB', { playerId: 'p3' }, T0)).ok).toBe(true)
  })
})

describe('the hourly run', () => {
  it('moves the player once the window closes, and only then', async () => {
    await claimTaxiPlayer('L', 'userB', { playerId: 'p1' }, T0)
    expect(await runTaxiStealResolution({ now: T0 })).toMatchObject({ stolen: 0, voided: 0 })
    expect(m.players.find((p) => p.playerId === 'p1')!.rosterId).toBe('t-rA')
    expect(await runTaxiStealResolution({ now: LATER })).toMatchObject({ leagues: 1, stolen: 1, voided: 0, failures: [] })
    expect(m.players.find((p) => p.playerId === 'p1')!.rosterId).toBe('t-rB')
    expect(claims()[0].status).toBe('stolen')
    // A second run finds nothing open and moves nothing.
    expect(await runTaxiStealResolution({ now: LATER })).toMatchObject({ leagues: 0, stolen: 0 })
  })

  it('a player who left the taxi squad meanwhile ends the claim with nothing moved', async () => {
    await claimTaxiPlayer('L', 'userB', { playerId: 'p1' }, T0)
    m.rosters.find((r) => r.id === 'rA')!.playerData = pd(['p2'], ['b1', 'p1'])
    expect(await runTaxiStealResolution({ now: LATER })).toMatchObject({ stolen: 0, voided: 1 })
    expect(m.players.find((p) => p.playerId === 'p1')!.rosterId).toBe('t-rA')
    expect(claims()[0]).toMatchObject({ status: 'void', note: 'The player left the taxi squad before the window closed.' })
  })
})

describe('the views', () => {
  it('a team sees other teams’ taxi players, the claims on its own and its own claims', async () => {
    await claimTaxiPlayer('L', 'userB', { playerId: 'p1' }, T0)
    const asB = await readTaxiStealView('L', 'userB')
    const asA = await readTaxiStealView('L', 'userA')
    if (!asB.ok || !asB.view.supported || !asA.ok || !asA.view.supported) throw new Error('expected a view')
    expect(asB.view.available.map((p) => [p.playerId, p.ownerTeam, p.claimed])).toEqual([['p1', 'Alpha', true], ['p2', 'Alpha', false], ['p3', 'Charlie', false]])
    expect(asB.view.myTeam).toEqual({ rosterId: 'rB', teamName: 'Bravo', claimsLeft: 0 })
    expect(asB.view.mine).toEqual([expect.objectContaining({ player: 'Rookie One', owner: 'Alpha' })])
    expect(asA.view.againstMe).toEqual([expect.objectContaining({ player: 'Rookie One', claimer: 'Bravo' })])
    expect(asA.view.available.map((p) => p.playerId)).toEqual(['p3'])
    expect(await readTaxiStealView('L', 'stranger')).toEqual({ ok: false, status: 403 })
  })

  it('lists each team’s taxi count for a commissioner only — the settings page’s over-the-limit warning', async () => {
    const asComm = await readTaxiStealView('L', 'comm')
    const asB = await readTaxiStealView('L', 'userB')
    if (!asComm.ok || !asComm.view.supported || !asB.ok || !asB.view.supported) throw new Error('expected a view')
    expect(asComm.view.taxiHeld).toEqual([{ teamName: 'Alpha', count: 2 }, { teamName: 'Bravo', count: 0 }, { teamName: 'Charlie', count: 1 }])
    expect(asB.view.taxiHeld).toEqual([])
  })

  it('Commish OS lists open claims, elevated once one is past its window; Chimmy knows the rule and the claims', async () => {
    expect(await readTaxiStealTasks('L', T0)).toEqual([])
    expect(await readTaxiStealingForChimmy('L')).toContain('Taxi stealing is on')
    await claimTaxiPlayer('L', 'userB', { playerId: 'p1' }, T0)
    const [task] = await readTaxiStealTasks('L', T0)
    expect(task).toMatchObject({ title: 'A taxi steal claim is open', priority: 'standard' })
    expect(task!.description).toContain('Bravo claimed Rookie One from Alpha')
    expect((await readTaxiStealTasks('L', LATER))[0]!.priority).toBe('elevated')
    expect(await readTaxiStealingForChimmy('L')).toContain('Open claims: Bravo on Rookie One (Alpha')
    m.settings.taxi_stealing = { enabled: false }
    expect(await readTaxiStealingForChimmy('L')).toBeNull()
  })
})
