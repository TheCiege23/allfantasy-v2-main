/**
 * Conditional and protected picks against the league's rows: the offer check, the record a settled
 * trade writes, a reversal's undo, and the settlement inside the rookie draft's pick consumption.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type PickRow = { id: string; leagueId: string; pickSeason: number; round: number; originalRosterId: string; currentOwnerId: string; status: string; traded?: boolean; usedInDraftSessionId?: string | null }

const m = vi.hoisted(() => ({
  settings: {} as Record<string, any>,
  rows: [] as Array<{ id: string; leagueId: string; pickSeason: number; round: number; originalRosterId: string; currentOwnerId: string; status: string; traded?: boolean; usedInDraftSessionId?: string | null }>,
  ownerPlan: true,
  seeds: [] as string[],
  db: {} as Record<string, any>,
}))

const sql = (s: TemplateStringsArray) => s.join('?')
const key = (w: any) => w.leagueId_pickSeason_round_originalRosterId

Object.assign(m.db, {
  league: { findUnique: vi.fn(async () => ({ id: 'L', name: 'Dynasty One', userId: 'owner', platform: 'manual', leagueType: 'dynasty', isDynasty: true, season: 2026, settings: structuredClone(m.settings) })) },
  roster: { findMany: vi.fn(async () => [{ id: 'rA', platformUserId: 'uA' }, { id: 'rB', platformUserId: 'uB' }, { id: 'rC', platformUserId: 'uC' }]) },
  redraftRoster: {
    findMany: vi.fn(async ({ where }: any) =>
      where?.id?.in?.some((x: string) => x.startsWith('seed-'))
        ? where.id.in.map((x: string) => ({ ownerId: x.replace('seed-', 'u') }))
        : [{ id: 't-rA', teamName: 'Alpha', ownerName: 'a' }, { id: 't-rB', teamName: 'Bravo', ownerName: 'b' }, { id: 't-rC', teamName: 'Charlie', ownerName: 'c' }],
    ),
  },
  // The newest season is 2026; a lookup by season finds only that one, so the playoff field read for a 2027 draft is 2026's.
  redraftSeason: { findFirst: vi.fn(async ({ where }: any) => (where?.season == null || where.season === 2026 ? { id: 's2026', season: 2026, status: 'complete' } : null)) },
  draftSession: { findFirst: vi.fn(async () => null) },
  redraftPlayoffSeed: { findMany: vi.fn(async () => m.seeds.map((r) => ({ rosterId: `seed-${r}` }))) },
  dynastyLeagueConfig: { findUnique: vi.fn(async () => ({ rookieDraftRounds: 4, futurePicksYearsOut: 3 })) },
  futureDraftPick: {
    findMany: vi.fn(async ({ where }: any) => m.rows.filter((r) => (where.status == null || r.status === where.status) && (where.pickSeason == null || (typeof where.pickSeason === 'number' ? r.pickSeason === where.pickSeason : where.pickSeason.in.includes(r.pickSeason))))),
    findUnique: vi.fn(async ({ where }: any) => {
      const k = key(where)
      return m.rows.find((r) => r.pickSeason === k.pickSeason && r.round === k.round && r.originalRosterId === k.originalRosterId) ?? null
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const k = key(where)
      const hit = m.rows.find((r) => r.pickSeason === k.pickSeason && r.round === k.round && r.originalRosterId === k.originalRosterId)
      if (hit) Object.assign(hit, update)
      else m.rows.push({ id: `new-${m.rows.length}`, ...create })
      return {}
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      for (const r of m.rows) if ((where.id?.in ? where.id.in.includes(r.id) : r.pickSeason === where.pickSeason && r.status === where.status)) Object.assign(r, data)
      return {}
    }),
  },
  $executeRaw: vi.fn(async (s: TemplateStringsArray, ...v: unknown[]) => {
    const q = sql(s)
    m.settings.pick_terms ??= {}
    if (q.includes('#-')) delete m.settings.pick_terms[v[1] as string]
    else m.settings.pick_terms[v[3] as string] = JSON.parse(v[4] as string)
    return 1
  }),
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/stat-corrections/applyStatCorrections', () => ({ ownerHasAfCommissionerPlan: vi.fn(async () => m.ownerPlan) }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({ hasAfCommissionerPlan: vi.fn(async () => true) }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: vi.fn(async () => false) }))
vi.mock('@/lib/dispersal-draft/nativeDispersal', () => ({ seasonTeamsByRoster: vi.fn(async () => new Map([['rA', 't-rA'], ['rB', 't-rB'], ['rC', 't-rC']])) }))
vi.mock('@/lib/live-draft-engine/createNextLeagueDraft', () => ({
  draftRosterIdForOwner: (ownerId: string, rosters: Array<{ id: string; platformUserId: string }>) => rosters.find((r) => r.platformUserId === ownerId)?.id ?? null,
}))

import { checkOfferPickTerms, clearPickTermsForTrade, recordSettledPickTerms } from '@/lib/league-trade-engine/pickTermsService'
import { consumeNativeFuturePicksForDraft } from '@/lib/league-trade-engine/nativeFuturePicks'

const NOW = new Date('2027-04-01T00:00:00Z')
const pick = (round: number, original: string, holder: string, season = 2027): PickRow => ({ id: `p-${season}-${round}-${original}`, leagueId: 'L', pickSeason: season, round, originalRosterId: original, currentOwnerId: holder, status: 'active', traded: holder !== original })
const slotOrder = (ids: string[]) => ids.map((rosterId, i) => ({ slot: i + 1, rosterId, displayName: rosterId }))
const consume = (order = ['rA', 'rB', 'rC']) =>
  consumeNativeFuturePicksForDraft(m.db as never, { leagueId: 'L', season: 2027, draftSessionId: 'D', rounds: 4, slotOrder: slotOrder(order) as never, now: NOW })
const termed = (id: string, terms: unknown) => {
  m.settings.pick_terms ??= {}
  m.settings.pick_terms[id] = { terms, tradeId: 'T1', setAt: 'x', result: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.settings = { pick_terms_rule: { enabled: true } }
  m.rows = []
  m.ownerPlan = true
  m.seeds = []
})

describe('an offer', () => {
  const asset = (terms: unknown, ref = 'fdp:2027:2:rA') => ({ itemType: 'future_pick' as const, itemReference: ref, fromRosterId: 'rA', toRosterId: 'rB', metadata: { pickTerms: terms } })

  it('stores valid terms in the settlement’s shape, with a label every history reader shows', async () => {
    const [a] = await checkOfferPickTerms('L', [asset({ kind: 'protected', top: 1, ifProtected: 'stays', junk: true })])
    expect(a!.metadata).toEqual({ pickTerms: { kind: 'protected', top: 1, ifProtected: 'stays' }, pickLabel: '2027 2nd (Alpha), top-1 protected (if it lands 1–1, it stays with Alpha)' })
  })

  it('leaves an offer without terms untouched and reads nothing', async () => {
    const plain = [{ itemType: 'player' as const, itemReference: 'p1', fromRosterId: 'rA', toRosterId: 'rB' }]
    expect(await checkOfferPickTerms('L', plain)).toBe(plain)
    expect(m.db.league.findUnique).not.toHaveBeenCalled()
  })

  it('refuses terms the league would not settle', async () => {
    m.settings.pick_terms_rule = { enabled: false }
    await expect(checkOfferPickTerms('L', [asset({ kind: 'protected', top: 1, ifProtected: 'stays' })])).rejects.toMatchObject({ code: 'PICK_TERMS_OFF' })
    m.settings.pick_terms_rule = { enabled: true }
    m.ownerPlan = false
    await expect(checkOfferPickTerms('L', [asset({ kind: 'protected', top: 1, ifProtected: 'stays' })])).rejects.toMatchObject({ code: 'PICK_TERMS_PLAN' })
    m.ownerPlan = true
    await expect(checkOfferPickTerms('L', [asset({ kind: 'protected', top: 3, ifProtected: 'stays' })])).rejects.toMatchObject({ code: 'PICK_TERMS_INVALID' })
    await expect(checkOfferPickTerms('L', [{ ...asset({ kind: 'protected', top: 1, ifProtected: 'stays' }), itemReference: 'p1' }])).rejects.toMatchObject({ code: 'PICK_TERMS_NOT_A_PICK' })
    termed('fdp:2027:2:rA', { kind: 'protected', top: 1, ifProtected: 'stays' })
    await expect(checkOfferPickTerms('L', [asset({ kind: 'protected', top: 2, ifProtected: 'stays' })])).rejects.toMatchObject({ code: 'PICK_TERMS_ALREADY' })
  })
})

describe('the settled trade and its undo', () => {
  it('records the terms on the pick, and a reversal takes back only this trade’s', async () => {
    await recordSettledPickTerms(m.db as never, { leagueId: 'L', tradeId: 'T9', now: NOW, assets: [{ itemType: 'future_pick', itemReference: 'fdp:2027:1:rA', fromRosterId: 'rA', toRosterId: 'rB', metadata: { pickTerms: { kind: 'protected', top: 1, ifProtected: 'stays' } } }] })
    termed('fdp:2028:1:rC', { kind: 'protected', top: 1, ifProtected: 'stays' })
    expect(m.settings.pick_terms['fdp:2027:1:rA']).toMatchObject({ tradeId: 'T9', terms: { kind: 'protected', top: 1 }, result: null })
    await clearPickTermsForTrade(m.db as never, { leagueId: 'L', tradeId: 'T9' })
    expect(Object.keys(m.settings.pick_terms)).toEqual(['fdp:2028:1:rC'])
  })
})

describe('the rookie draft', () => {
  it('a protected pick that lands inside its protection stays; outside it, it conveys', async () => {
    m.rows = [pick(1, 'rA', 'rB')]
    termed('fdp:2027:1:rA', { kind: 'protected', top: 1, ifProtected: 'stays' })
    expect(await consume(['rA', 'rB', 'rC'])).toEqual([])
    expect(m.settings.pick_terms['fdp:2027:1:rA'].result).toMatchObject({ outcome: 'protected' })

    m.rows = [pick(1, 'rA', 'rB')]
    termed('fdp:2027:1:rA', { kind: 'protected', top: 1, ifProtected: 'stays' })
    const traded = await consume(['rB', 'rA', 'rC'])
    expect(traded.map((t) => [t.round, t.originalRosterId, t.newRosterId])).toEqual([[1, 'rA', 'rB']])
    expect(m.settings.pick_terms['fdp:2027:1:rA'].result).toMatchObject({ outcome: 'conveyed' })
  })

  it('a protection that rolls over hands over next season’s same-round pick instead', async () => {
    m.rows = [pick(1, 'rA', 'rB')]
    termed('fdp:2027:1:rA', { kind: 'protected', top: 1, ifProtected: 'rolls_over' })
    expect(await consume()).toEqual([])
    expect(m.rows.find((r) => r.pickSeason === 2028)).toMatchObject({ round: 1, originalRosterId: 'rA', currentOwnerId: 'rB', status: 'active' })
    expect(m.settings.pick_terms['fdp:2027:1:rA'].result).toMatchObject({ outcome: 'protected_rolled_over' })
  })

  it('a rollover the original team can no longer give leaves the protection standing', async () => {
    m.rows = [pick(1, 'rA', 'rB'), pick(1, 'rA', 'rC', 2028)]
    termed('fdp:2027:1:rA', { kind: 'protected', top: 1, ifProtected: 'rolls_over' })
    expect(await consume()).toEqual([])
    expect(m.rows.find((r) => r.pickSeason === 2028)!.currentOwnerId).toBe('rC')
    expect(m.settings.pick_terms['fdp:2027:1:rA'].result).toMatchObject({ outcome: 'protected', note: 'The rollover pick was no longer the original team’s to give.' })
  })

  it('a met condition conveys the other round instead, and spends that pick', async () => {
    m.rows = [pick(2, 'rA', 'rB')]
    m.seeds = ['A', 'C'] // Bravo missed the playoffs
    termed('fdp:2027:2:rA', { kind: 'conditional', teamRosterId: 'rB', event: 'misses_playoffs', effect: 'becomes_round', round: 1 })
    const traded = await consume()
    expect(traded.map((t) => [t.round, t.originalRosterId, t.newRosterId])).toEqual([[1, 'rA', 'rB']])
    expect(m.rows.find((r) => r.round === 1 && r.originalRosterId === 'rA')).toMatchObject({ status: 'used', currentOwnerId: 'rB', usedInDraftSessionId: 'D' })
    expect(m.settings.pick_terms['fdp:2027:2:rA'].result).toMatchObject({ outcome: 'became_round', round: 1 })
  })

  it('an unmet condition conveys the pick as it is; a "does not convey" condition keeps it home', async () => {
    m.rows = [pick(2, 'rA', 'rB')]
    m.seeds = ['B']
    termed('fdp:2027:2:rA', { kind: 'conditional', teamRosterId: 'rB', event: 'misses_playoffs', effect: 'becomes_round', round: 1 })
    expect((await consume()).map((t) => t.round)).toEqual([2])
    expect(m.settings.pick_terms['fdp:2027:2:rA'].result.outcome).toBe('condition_not_met')

    m.rows = [pick(2, 'rA', 'rB')]
    termed('fdp:2027:2:rA', { kind: 'conditional', teamRosterId: 'rB', event: 'makes_playoffs', effect: 'does_not_convey' })
    expect(await consume()).toEqual([])
    expect(m.settings.pick_terms['fdp:2027:2:rA'].result.outcome).toBe('did_not_convey')
  })

  it('a swap the original team cannot make, or a missing playoff field, conveys the base pick and says why', async () => {
    m.rows = [pick(2, 'rA', 'rB'), pick(1, 'rA', 'rC')]
    m.seeds = ['A']
    termed('fdp:2027:2:rA', { kind: 'conditional', teamRosterId: 'rB', event: 'misses_playoffs', effect: 'becomes_round', round: 1 })
    expect((await consume()).map((t) => [t.round, t.newRosterId]).sort()).toEqual([[1, 'rC'], [2, 'rB']])
    expect(m.settings.pick_terms['fdp:2027:2:rA'].result).toMatchObject({ outcome: 'conveyed_unjudged', note: 'The original team no longer held that round’s pick.' })

    m.rows = [pick(2, 'rA', 'rB')]
    m.seeds = []
    termed('fdp:2027:2:rA', { kind: 'conditional', teamRosterId: 'rB', event: 'misses_playoffs', effect: 'becomes_round', round: 1 })
    expect((await consume()).map((t) => t.round)).toEqual([2])
    expect(m.settings.pick_terms['fdp:2027:2:rA'].result.outcome).toBe('conveyed_unjudged')
  })

  it('a pick back with its original team settles as returned, and a draft with no terms changes nothing', async () => {
    m.rows = [pick(1, 'rA', 'rA')]
    termed('fdp:2027:1:rA', { kind: 'protected', top: 1, ifProtected: 'stays' })
    expect(await consume()).toEqual([])
    expect(m.settings.pick_terms['fdp:2027:1:rA'].result.outcome).toBe('returned')

    m.settings = {}
    m.rows = [pick(3, 'rC', 'rA')]
    expect((await consume()).map((t) => [t.round, t.originalRosterId, t.newRosterId])).toEqual([[3, 'rC', 'rA']])
    expect(m.db.$executeRaw).toHaveBeenCalledTimes(1)
  })
})
