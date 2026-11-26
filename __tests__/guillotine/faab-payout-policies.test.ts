/**
 * Who gets a chopped team's unspent FAAB, and how much of it (owner's request, 2026-11-25): split evenly, to the
 * week's highest scorer, to the lowest scorer who survived, or to one team at a time in waiver order — all of it
 * or a share (lib/guillotine/faabOnChop.ts + faabOnChopApply.ts).
 *
 * The money rules these tests hold:
 *   - every dollar taken is handed out, and no dollar is created or lost;
 *   - a chop pays ONCE, whatever is retried — and with a share, the balance alone cannot prove that, so the
 *     payout's own marker has to;
 *   - the commissioner's preview names the team the chop will pay.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; faabRemaining: number | null; waiverPriority?: number | null }
type Event = { id: string; leagueId: string; eventType: string; metadata: Record<string, unknown> }
const rows = new Map<string, Row>()
let events: Event[] = []
const locks: string[] = []

const tx = {
  $queryRaw: vi.fn(async (_strings: TemplateStringsArray, leagueId: string) => {
    locks.push(leagueId)
    return []
  }),
  roster: {
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.flatMap((id) => (rows.has(id) ? [{ ...rows.get(id)! }] : []))),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; faabRemaining?: number }; data: { faabRemaining: number } }) => {
      const row = rows.get(where.id)
      if (!row || (where.faabRemaining !== undefined && row.faabRemaining !== where.faabRemaining)) return { count: 0 }
      row.faabRemaining = data.faabRemaining
      return { count: 1 }
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { faabRemaining: { increment: number } } }) => {
      const row = rows.get(where.id)!
      row.faabRemaining = (row.faabRemaining ?? 0) + data.faabRemaining.increment
      return row
    }),
  },
  guillotineEventLog: {
    findFirst: vi.fn(async ({ where }: { where: { leagueId: string; eventType: string; metadata: { path: string[]; equals: unknown } } }) =>
      events.find((e) => e.leagueId === where.leagueId && e.eventType === where.eventType && e.metadata[where.metadata.path[0]!] === where.metadata.equals) ?? null),
    findMany: vi.fn(async ({ where }: { where: { leagueId: string; eventType: string } }) => events.filter((e) => e.leagueId === where.leagueId && e.eventType === where.eventType)),
    create: vi.fn(async ({ data }: { data: Omit<Event, 'id'> }) => {
      const event = { id: `e${events.length + 1}`, ...data }
      events.push(event)
      return event
    }),
  },
}
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }))
vi.mock('@/lib/league/faabMirror', () => ({ copyGenericFaabToRedraft: vi.fn(async () => undefined) }))

import {
  FAAB_ON_CHOP_OPTIONS,
  describeFaabPayout,
  distributeChoppedFaab,
  faabTakenFromChopped,
  movesChoppedFaab,
  readFaabOnChop,
  readFaabOnChopPercent,
  splitChoppedFaab,
  type FaabOnChop,
  type FaabSurvivor,
} from '@/lib/guillotine/faabOnChop'
import { paidInTurnSoFar, redistributeChoppedFaab } from '@/lib/guillotine/faabOnChopApply'
import { buildChopPreview } from '@/lib/guillotine/chopPreview'
import { DEFAULT_ADVANCED } from '@/lib/guillotine/chopSchedule'
import { GUILLOTINE_PAID_RULE_FIELDS, normalizeGuillotineRulesPatch, paidFieldsChanged, type GuillotineRules } from '@/lib/guillotine/guillotineRules'

function seed(list: Row[]) {
  rows.clear()
  for (const r of list) rows.set(r.id, { ...r })
}
const balances = () => Object.fromEntries([...rows.values()].map((r) => [r.id, r.faabRemaining]))
const total = () => [...rows.values()].reduce((sum, r) => sum + (r.faabRemaining ?? 0), 0)
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)

beforeEach(() => {
  vi.clearAllMocks()
  events = []
  locks.length = 0
})

const FIELD: FaabSurvivor[] = [
  { rosterId: 'a', faab: 100, weekPoints: 140, waiverPriority: 3 },
  { rosterId: 'b', faab: 80, weekPoints: 110, waiverPriority: 1 },
  { rosterId: 'c', faab: 60, weekPoints: 95, waiverPriority: 2 },
]

describe('the setting', () => {
  it('reads each rule, and anything else as keep', () => {
    for (const o of FAAB_ON_CHOP_OPTIONS) expect(readFaabOnChop({ guillotineFaabOnChop: o.value })).toBe(o.value)
    expect(FAAB_ON_CHOP_OPTIONS.map((o) => o.value)).toEqual(['keep', 'split', 'top_scorer', 'low_scorer', 'waiver_order'])
    expect(readFaabOnChop({ guillotineFaabOnChop: 'burn' })).toBe('keep')
    expect(readFaabOnChop(null)).toBe('keep')
    expect(movesChoppedFaab('keep')).toBe(false)
    for (const p of ['split', 'top_scorer', 'low_scorer', 'waiver_order'] as const) expect(movesChoppedFaab(p)).toBe(true)
  })

  it('the share defaults to all of it; only a whole number from 1 to 100 is read', () => {
    expect(readFaabOnChopPercent({})).toBe(100)
    expect(readFaabOnChopPercent({ guillotineFaabOnChopPercent: 50 })).toBe(50)
    for (const bad of [0, 101, 33.5, '50', -5, null]) expect(readFaabOnChopPercent({ guillotineFaabOnChopPercent: bad })).toBe(100)
  })

  it('a share is whole dollars, rounded down, and never more than the team has', () => {
    expect(faabTakenFromChopped(120, 100)).toBe(120)
    expect(faabTakenFromChopped(120, 50)).toBe(60)
    expect(faabTakenFromChopped(101, 50)).toBe(50)
    expect(faabTakenFromChopped(3, 25)).toBe(0)
    expect(faabTakenFromChopped(null, 50)).toBe(0)
    expect(faabTakenFromChopped(-40, 50)).toBe(0)
  })
})

describe('who gets it (distributeChoppedFaab)', () => {
  it('🛑 every rule hands out every dollar of the pool', () => {
    for (const policy of ['split', 'top_scorer', 'low_scorer', 'waiver_order'] as const) {
      for (const pool of [1, 7, 100, 333]) {
        const d = distributeChoppedFaab(policy, pool, FIELD)
        expect(sum(d.shares), `${policy} ${pool}`).toBe(pool)
        expect(d.pool).toBe(pool)
        expect(d.applied).toBe(policy)
        expect([...d.shares.values()].every((n) => Number.isInteger(n) && n >= 0)).toBe(true)
      }
    }
  })

  it('split is the even split it always was', () => {
    expect(distributeChoppedFaab('split', 100, FIELD).shares).toEqual(splitChoppedFaab(100, FIELD).shares)
  })

  it('the highest scorer takes all of it; the lowest surviving scorer takes all of it', () => {
    expect([...distributeChoppedFaab('top_scorer', 90, FIELD).shares]).toEqual([['a', 90]])
    expect([...distributeChoppedFaab('low_scorer', 90, FIELD).shares]).toEqual([['c', 90]])
  })

  it('a tie for the top score shares it, the odd dollar to the team with less FAAB', () => {
    const tied = [{ ...FIELD[0]! }, { ...FIELD[1]!, weekPoints: 140 }, FIELD[2]!]
    expect(Object.fromEntries(distributeChoppedFaab('top_scorer', 91, tied).shares)).toEqual({ a: 45, b: 46 })
  })

  it('waiver order: the earliest priority first, then the next team each chop, round and round', () => {
    const paid: string[] = []
    const received = new Map<string, number>()
    for (let chop = 0; chop < 7; chop += 1) {
      const d = distributeChoppedFaab('waiver_order', 50, FIELD.map((s) => ({ ...s, received: received.get(s.rosterId) ?? 0 })))
      const [who] = [...d.shares.keys()]
      expect(d.shares.get(who!)).toBe(50)
      paid.push(who!)
      received.set(who!, (received.get(who!) ?? 0) + 1)
    }
    // Priorities are b=1, c=2, a=3.
    expect(paid).toEqual(['b', 'c', 'a', 'b', 'c', 'a', 'b'])
  })

  it('waiver order skips a team that is gone: the line is whoever is still alive', () => {
    const afterBChopped = FIELD.filter((s) => s.rosterId !== 'b').map((s) => ({ ...s, received: s.rosterId === 'c' ? 1 : 0 }))
    expect([...distributeChoppedFaab('waiver_order', 40, afterBChopped).shares.keys()]).toEqual(['a'])
  })

  it('a league that keeps no waiver order still pays in turn, by roster id', () => {
    const none = FIELD.map((s) => ({ ...s, waiverPriority: null }))
    expect([...distributeChoppedFaab('waiver_order', 40, none).shares.keys()]).toEqual(['a'])
    expect([...distributeChoppedFaab('waiver_order', 40, none.map((s) => ({ ...s, received: s.rosterId === 'a' ? 1 : 0 }))).shares.keys()]).toEqual(['b'])
  })

  it('🛑 a scorer rule with no score to read falls back to an even split and says so, rather than pick by nothing', () => {
    const unscored = FIELD.map((s) => ({ ...s, weekPoints: null }))
    const d = distributeChoppedFaab('top_scorer', 90, unscored)
    expect(d.applied).toBe('split')
    expect(Object.fromEntries(d.shares)).toEqual({ a: 30, b: 30, c: 30 })
  })

  it('keep, an empty pool, or nobody to pay moves nothing', () => {
    expect(distributeChoppedFaab('keep', 100, FIELD)).toEqual({ pool: 0, shares: new Map(), applied: 'keep' })
    for (const policy of ['split', 'top_scorer', 'low_scorer', 'waiver_order'] as const) {
      expect(distributeChoppedFaab(policy, 0, FIELD).pool).toBe(0)
      expect(distributeChoppedFaab(policy, 100, []).pool).toBe(0)
    }
  })

  it('is the same answer every time for the same field (a retry pays the same team)', () => {
    const shuffled = [FIELD[2]!, FIELD[0]!, FIELD[1]!]
    for (const policy of ['split', 'top_scorer', 'low_scorer', 'waiver_order'] as const) {
      expect(Object.fromEntries(distributeChoppedFaab(policy, 77, shuffled).shares)).toEqual(Object.fromEntries(distributeChoppedFaab(policy, 77, FIELD).shares))
    }
  })

  it('says who was paid, in words', () => {
    const base = { pool: 120, survivors: 3, choppedCount: 1 }
    expect(describeFaabPayout({ ...base, applied: 'split', recipients: [] })).toBe("The chopped team's $120 of unspent FAAB was split among the 3 teams still alive: about $40 each.")
    expect(describeFaabPayout({ ...base, applied: 'top_scorer', recipients: ['Alpha'] })).toBe("The chopped team's $120 of unspent FAAB went to Alpha, for the week's highest score.")
    expect(describeFaabPayout({ ...base, applied: 'low_scorer', recipients: ['Alpha', 'Bravo'], choppedCount: 2 })).toBe("The chopped teams' $120 of unspent FAAB went to Alpha and Bravo, shared evenly, the lowest score to survive the week.")
    expect(describeFaabPayout({ ...base, applied: 'waiver_order', recipients: ['Bravo'] })).toBe("The chopped team's $120 of unspent FAAB went to Bravo, next in waiver order.")
  })
})

describe('the payout (redistributeChoppedFaab)', () => {
  const league = [
    { id: 'chopped', faabRemaining: 120 },
    { id: 'a', faabRemaining: 100, waiverPriority: 3 },
    { id: 'b', faabRemaining: 80, waiverPriority: 1 },
    { id: 'c', faabRemaining: 60, waiverPriority: 2 },
  ]
  const weekPoints = new Map([['a', 140], ['b', 110], ['c', 95], ['chopped', 70]])
  const pay = (over: Record<string, unknown> = {}, week = 5) =>
    redistributeChoppedFaab({
      choppedRosterIds: ['chopped'],
      survivorRosterIds: ['a', 'b', 'c'],
      weekPoints,
      record: { leagueId: 'L1', key: `s1:${week}`, weekOrPeriod: week },
      ...over,
    })

  it('the highest scorer is paid the whole balance, and the chopped team is left with none', async () => {
    seed(league)
    const r = await pay({ policy: 'top_scorer' })
    expect(r).toMatchObject({ pool: 120, applied: 'top_scorer', recorded: true })
    expect(balances()).toEqual({ chopped: 0, a: 220, b: 80, c: 60 })
    expect(Object.fromEntries(r!.taken)).toEqual({ chopped: 120 })
  })

  it('the lowest surviving scorer is paid, not the team that was chopped', async () => {
    seed(league)
    await pay({ policy: 'low_scorer' })
    expect(balances()).toEqual({ chopped: 0, a: 100, b: 80, c: 180 })
  })

  it('🛑 a share: half is passed on, half stays with the chopped team, and no dollar appears or vanishes', async () => {
    seed(league)
    const before = total()
    const r = await pay({ policy: 'split', percent: 50 })
    expect(r).toMatchObject({ pool: 60, perTeam: 20, survivors: 3 })
    expect(balances()).toEqual({ chopped: 60, a: 120, b: 100, c: 80 })
    expect(total()).toBe(before)
    // What undo gives back is what was taken, not the whole balance.
    expect(Object.fromEntries(r!.taken)).toEqual({ chopped: 60 })
  })

  it('🛑 a retried chop pays nothing a second time, even though the chopped team still holds money', async () => {
    seed(league)
    await pay({ policy: 'top_scorer', percent: 50 })
    expect(balances()).toEqual({ chopped: 60, a: 160, b: 80, c: 60 })
    // The same chop, run again: without the marker this would take half of the remaining $60.
    expect(await pay({ policy: 'top_scorer', percent: 50 })).toBeNull()
    expect(await pay({ policy: 'top_scorer', percent: 50 })).toBeNull()
    expect(balances()).toEqual({ chopped: 60, a: 160, b: 80, c: 60 })
    expect(events.filter((e) => e.eventType === 'faab_split').length).toBe(1)
  })

  it('[control] the marker is what stops it: with the marker gone (an undone chop), the same chop pays again', async () => {
    seed(league)
    await pay({ policy: 'top_scorer', percent: 50 })
    events = []
    expect(await pay({ policy: 'top_scorer', percent: 50 })).toMatchObject({ pool: 30 })
    expect(balances()).toEqual({ chopped: 30, a: 190, b: 80, c: 60 })
  })

  it('🛑 a share without a record of the chop is refused: nothing would stop the second take', async () => {
    seed(league)
    await expect(redistributeChoppedFaab({ choppedRosterIds: ['chopped'], survivorRosterIds: ['a', 'b', 'c'], policy: 'split', percent: 50 })).rejects.toThrow(/record of the chop/)
    expect(balances()).toEqual({ chopped: 120, a: 100, b: 80, c: 60 })
  })

  it('the payout takes the league lock and writes its own event, with what undo needs', async () => {
    seed(league)
    await pay({ policy: 'low_scorer', percent: 75 })
    expect(locks).toEqual(['L1'])
    expect(events).toEqual([
      {
        id: 'e1',
        leagueId: 'L1',
        eventType: 'faab_split',
        metadata: { key: 's1:5', weekOrPeriod: 5, choppedRosterIds: ['chopped'], pool: 90, shares: { c: 90 }, taken: { chopped: 90 }, policy: 'low_scorer', applied: 'low_scorer', percent: 75 },
      },
    ])
  })

  it('waiver order pays the next team each chop, reading who was paid from the payouts themselves', async () => {
    seed([...league, { id: 'chopped2', faabRemaining: 40 }, { id: 'chopped3', faabRemaining: 10 }])
    await pay({ policy: 'waiver_order' }, 5)
    await pay({ policy: 'waiver_order', choppedRosterIds: ['chopped2'] }, 6)
    await pay({ policy: 'waiver_order', choppedRosterIds: ['chopped3'] }, 7)
    // b (priority 1) gets week 5's $120, c (2) gets week 6's $40, a (3) gets week 7's $10.
    expect(balances()).toMatchObject({ a: 110, b: 200, c: 100, chopped: 0, chopped2: 0, chopped3: 0 })
    expect(Object.fromEntries(await paidInTurnSoFar(tx as never, 'L1'))).toEqual({ a: 1, b: 1, c: 1 })
  })

  it('a balance spent between the read and the write is not paid out', async () => {
    seed(league)
    tx.roster.findMany.mockImplementationOnce(async () => [{ id: 'chopped', faabRemaining: 200 }, ...league.slice(1)])
    expect(await pay({ policy: 'top_scorer' })).toBeNull()
    expect(balances()).toEqual({ chopped: 120, a: 100, b: 80, c: 60 })
    expect(events).toEqual([])
  })

  it('keep moves nothing and writes nothing', async () => {
    seed(league)
    expect(await pay({ policy: 'keep' })).toBeNull()
    expect(balances()).toEqual({ chopped: 120, a: 100, b: 80, c: 60 })
    expect(events).toEqual([])
  })

  it('[control] called the old way (no rule, no record) it is still the even split, and still idempotent by the balance', async () => {
    seed(league)
    const r = await redistributeChoppedFaab({ choppedRosterIds: ['chopped'], survivorRosterIds: ['a', 'b', 'c'] })
    expect(r).toMatchObject({ pool: 120, applied: 'split', recorded: false })
    expect(balances()).toEqual({ chopped: 0, a: 140, b: 120, c: 100 })
    expect(await redistributeChoppedFaab({ choppedRosterIds: ['chopped'], survivorRosterIds: ['a', 'b', 'c'] })).toBeNull()
    expect(events).toEqual([])
    expect(locks).toEqual([])
  })
})

describe('the commissioner’s chop preview names the team the chop will pay', () => {
  const preview = (faabOnChop: FaabOnChop, over: Record<string, unknown> = {}) =>
    buildChopPreview({
      week: 5, weekState: 'live', eliminationStartWeek: 1, eliminationEndWeek: 18, teamsPerChop: 1, advanced: DEFAULT_ADVANCED,
      endgame: { format: 'last_team_standing', threshold: 1 }, tiebreakerOrder: ['season_points'], dangerMarginPoints: 10,
      faabOnChop, rosterReleaseTiming: 'next_waiver_run', previousWeek: [], draftSlotByRoster: new Map(), blockers: [],
      teams: [
        { rosterId: 'a', name: 'Alpha', periodPoints: 140, seasonPointsCumul: 140, faab: 100, playerCount: 9, waiverPriority: 3 },
        { rosterId: 'b', name: 'Bravo', periodPoints: 110, seasonPointsCumul: 110, faab: 80, playerCount: 9, waiverPriority: 1 },
        { rosterId: 'c', name: 'Charlie', periodPoints: 95, seasonPointsCumul: 95, faab: 60, playerCount: 9, waiverPriority: 2 },
        { rosterId: 'z', name: 'Zulu', periodPoints: 70, seasonPointsCumul: 70, faab: 120, playerCount: 9, waiverPriority: 4 },
      ],
      ...over,
    } as Parameters<typeof buildChopPreview>[0])
  const change = (p: ReturnType<typeof preview>) => Object.fromEntries(p.rows.map((r) => [r.rosterId, r.faabChange]))

  it('each rule shows who gains and what the chopped team loses', () => {
    expect(change(preview('split'))).toEqual({ z: -120, c: 40, b: 40, a: 40 })
    expect(preview('split').faab).toEqual({ mode: 'split', pool: 120, note: '$120 is shared by the 3 survivors.' })
    expect(change(preview('top_scorer'))).toEqual({ z: -120, c: null, b: null, a: 120 })
    expect(preview('top_scorer').faab).toEqual({ mode: 'top_scorer', pool: 120, note: "$120 goes to Alpha, the week's highest score so far." })
    expect(change(preview('low_scorer'))).toEqual({ z: -120, c: 120, b: null, a: null })
    expect(preview('low_scorer').faab?.note).toBe('$120 goes to Charlie, the lowest score still alive.')
    expect(change(preview('waiver_order'))).toEqual({ z: -120, c: null, b: 120, a: null })
    expect(preview('waiver_order').faab?.note).toBe('$120 goes to Bravo, next in waiver order.')
  })

  it('a share shows what is passed on and what leaves with the chopped team', () => {
    const p = preview('top_scorer', { faabOnChopPercent: 25 })
    expect(change(p)).toEqual({ z: -30, c: null, b: null, a: 30 })
    expect(p.faab).toEqual({ mode: 'top_scorer', pool: 30, note: "$30 goes to Alpha, the week's highest score so far. $90 leaves with the chopped team." })
  })

  it('[control] keep is unchanged: nothing moves', () => {
    const p = preview('keep')
    expect(Object.values(change(p)).every((n) => n === null)).toBe(true)
    expect(p.faab).toEqual({ mode: 'keep', pool: 120, note: '$120 leaves the league with the chopped team.' })
  })
})

describe('the rules a commissioner saves', () => {
  const bounds = { startWeek: 1, seasonWeeks: 18 }
  const CURRENT = { faabOnChop: 'keep', faabOnChopPercent: 100 } as GuillotineRules

  it('each new rule and the share are accepted; nonsense is refused with the field named', () => {
    for (const v of ['top_scorer', 'low_scorer', 'waiver_order']) {
      expect(normalizeGuillotineRulesPatch({ faabOnChop: v }, bounds)).toEqual({ ok: true, value: { faabOnChop: v } })
    }
    expect(normalizeGuillotineRulesPatch({ faabOnChopPercent: 50 }, bounds)).toEqual({ ok: true, value: { faabOnChopPercent: 50 } })
    expect(normalizeGuillotineRulesPatch({ faabOnChop: 'richest' }, bounds)).toMatchObject({ ok: false, error: { field: 'faabOnChop' } })
    for (const bad of [0, 101, 12.5, 'half']) {
      expect(normalizeGuillotineRulesPatch({ faabOnChopPercent: bad }, bounds), String(bad)).toMatchObject({ ok: false, error: { field: 'faabOnChopPercent' } })
    }
  })

  it('both are AF Commissioner rules; anyone may put them back to the defaults', () => {
    expect(GUILLOTINE_PAID_RULE_FIELDS.has('faabOnChop')).toBe(true)
    expect(GUILLOTINE_PAID_RULE_FIELDS.has('faabOnChopPercent')).toBe(true)
    expect(paidFieldsChanged({ faabOnChop: 'top_scorer', faabOnChopPercent: 50 }, CURRENT)).toEqual(['faabOnChop', 'faabOnChopPercent'])
    const lapsed = { faabOnChop: 'waiver_order', faabOnChopPercent: 25 } as GuillotineRules
    expect(paidFieldsChanged({ faabOnChop: 'keep', faabOnChopPercent: 100 }, lapsed)).toEqual([])
  })
})
