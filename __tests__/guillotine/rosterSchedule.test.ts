import { describe, expect, it } from 'vitest'
import { getAllNflSlots } from '@/lib/nfl-roster'
import { getAllNbaSlots } from '@/lib/nba-roster'
import {
  MAX_ROSTER_CHANGES,
  ROSTER_CHANGE_OPTIONS,
  applyRosterChange,
  benchSpots,
  describeLayout,
  describeRosterChange,
  dueRosterChanges,
  normalizeRosterSchedule,
  readRosterSchedule,
  readRosterScheduleState,
  rosterSpotsFromDefinitions,
  startingSpots,
  walkRosterSchedule,
  ROSTER_SCHEDULE_KEY,
  ROSTER_SCHEDULE_STATE_KEY,
  type RosterChange,
} from '@/lib/guillotine/rosterSchedule'

const LAYOUT = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6, IR: 1 }
const spots = rosterSpotsFromDefinitions(getAllNflSlots(), LAYOUT)
const change = (c: Partial<RosterChange> & Pick<RosterChange, 'kind'>): RosterChange => ({ id: `c${Math.random().toString(36).slice(2, 8)}`, week: 10, slot: null, count: 1, ...c })
const ctx = { layout: LAYOUT, spots, fromWeek: 2, toWeek: 17 }

describe('roster spots a schedule can change', () => {
  it('offers starting spots only: no bench, injured list, taxi or college spots', () => {
    const keys = spots.starters.map((s) => s.key)
    expect(keys).toEqual(expect.arrayContaining(['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DEF']))
    for (const never of ['BN', 'IR', 'TAXI', 'DEVY', 'C2C_QB', 'C2C_BN']) expect(keys).not.toContain(never)
    expect(spots.bench.key).toBe('BN')
  })

  it('reads another sport the same way', () => {
    const nba = rosterSpotsFromDefinitions(getAllNbaSlots(), { PG: 1, BN: 3 })
    expect(nba.bench.key).toBe('BN')
    expect(nba.starters.map((s) => s.key)).toContain('UTIL')
    expect(nba.starters.map((s) => s.key)).not.toContain('IL')
  })

  it('offers no change that takes a spot away from a team', () => {
    // Deliberate (see the file header): scoring counts whoever is stored as a starter, so a spot can only be
    // taken away once AllFantasy also benches the player in it.
    expect(ROSTER_CHANGE_OPTIONS.map((o) => o.value)).toEqual(['add_starter', 'add_bench', 'bench_to_starter'])
  })
})

describe('one change', () => {
  it("the owner's examples", () => {
    // "week 10, the SF position gets added plus 1 bench spot"
    const sf = applyRosterChange(LAYOUT, change({ kind: 'add_starter', slot: 'SUPERFLEX' }), spots)
    expect(sf.ok && sf.slots.SUPERFLEX).toBe(1)
    const bench = applyRosterChange(LAYOUT, change({ kind: 'add_bench' }), spots)
    expect(bench.ok && bench.slots.BN).toBe(7)
    // "week 11 a bench spot turns into a starting spot"
    const swap = applyRosterChange(LAYOUT, change({ kind: 'bench_to_starter', slot: 'WR' }), spots)
    expect(swap.ok && [swap.slots.BN, swap.slots.WR]).toEqual([5, 3])
  })

  it('a swap keeps the roster the same size, and an add grows it', () => {
    const size = (l: Record<string, number>) => startingSpots(l, spots) + benchSpots(l, spots)
    const run = (c: RosterChange) => {
      const r = applyRosterChange(LAYOUT, c, spots)
      if (!r.ok) throw new Error(r.reason)
      return size(r.slots) - size(LAYOUT)
    }
    expect(run(change({ kind: 'bench_to_starter', slot: 'RB' }))).toBe(0)
    expect(run(change({ kind: 'add_starter', slot: 'RB', count: 2 }))).toBe(2)
    expect(run(change({ kind: 'add_bench', count: 3 }))).toBe(3)
  })

  it('no change ever lowers the number of starting spots', () => {
    for (const option of ROSTER_CHANGE_OPTIONS) {
      const r = applyRosterChange(LAYOUT, change({ kind: option.value, slot: option.needsSlot ? 'WR' : null }), spots)
      expect(r.ok && startingSpots(r.slots, spots) >= startingSpots(LAYOUT, spots)).toBe(true)
    }
  })

  it('never mutates the layout it was given', () => {
    const before = JSON.stringify(LAYOUT)
    applyRosterChange(LAYOUT, change({ kind: 'bench_to_starter', slot: 'WR', count: 2 }), spots)
    expect(JSON.stringify(LAYOUT)).toBe(before)
  })

  it('refuses what the roster editor would refuse, and says why', () => {
    const tooMany = applyRosterChange({ ...LAYOUT, SUPERFLEX: 2 }, change({ kind: 'add_starter', slot: 'SUPERFLEX' }), spots)
    expect(!tooMany.ok && tooMany.reason).toMatch(/at most 2 Super Flex/)
    const benchFull = applyRosterChange({ ...LAYOUT, BN: 30 }, change({ kind: 'add_bench' }), spots)
    expect(!benchFull.ok && benchFull.reason).toMatch(/at most 30 bench spots/)
    const noBench = applyRosterChange({ ...LAYOUT, BN: 1 }, change({ kind: 'bench_to_starter', slot: 'WR', count: 2 }), spots)
    expect(!noBench.ok && noBench.reason).toMatch(/1 bench spot, so 2 cannot become starters/)
    const one = applyRosterChange({ ...LAYOUT, BN: 0 }, change({ kind: 'bench_to_starter', slot: 'WR' }), spots)
    expect(!one.ok && one.reason).toBe('the league has 0 bench spots, so 1 cannot become a starter.')
    const unknown = applyRosterChange(LAYOUT, change({ kind: 'add_starter', slot: 'GOALIE' }), spots)
    expect(unknown.ok).toBe(false)
  })

  it('a failed swap leaves nothing half done', () => {
    // The bench half would succeed; the starter half cannot (WR is at its maximum).
    const r = applyRosterChange({ ...LAYOUT, WR: 6 }, change({ kind: 'bench_to_starter', slot: 'WR' }), spots)
    expect(r.ok).toBe(false)
    expect('slots' in r).toBe(false)
  })
})

describe('a season of changes', () => {
  const season = [
    change({ id: 'w11', week: 11, kind: 'bench_to_starter', slot: 'WR' }),
    change({ id: 'w7', week: 7, kind: 'add_starter', slot: 'FLEX' }),
    change({ id: 'w10a', week: 10, kind: 'add_starter', slot: 'SUPERFLEX' }),
    change({ id: 'w10b', week: 10, kind: 'add_bench' }),
  ]

  it('runs in week order, and in the listed order inside a week', () => {
    const walk = walkRosterSchedule(LAYOUT, season, spots)
    expect(walk.steps.map((s) => s.change.id)).toEqual(['w7', 'w10a', 'w10b', 'w11'])
    expect(walk.slots).toMatchObject({ FLEX: 2, SUPERFLEX: 1, BN: 6, WR: 3 })
  })

  it('only the changes whose week has arrived are due, and a done one is never due again', () => {
    expect(dueRosterChanges(season, [], 6).map((c) => c.id)).toEqual([])
    expect(dueRosterChanges(season, [], 10).map((c) => c.id)).toEqual(['w7', 'w10a', 'w10b'])
    expect(dueRosterChanges(season, ['w7', 'w10a'], 12).map((c) => c.id)).toEqual(['w10b', 'w11'])
  })

  it('a change the layout cannot take is reported, and the rest still run', () => {
    const walk = walkRosterSchedule({ ...LAYOUT, SUPERFLEX: 2 }, season, spots)
    expect(walk.steps.find((s) => s.change.id === 'w10a')).toMatchObject({ ok: false })
    expect(walk.slots).toMatchObject({ FLEX: 2, SUPERFLEX: 2, BN: 6, WR: 3 })
  })
})

describe('saving a list', () => {
  it('accepts a valid list and returns it in running order', () => {
    const r = normalizeRosterSchedule(
      [
        { id: 'b', week: 11, kind: 'bench_to_starter', slot: 'WR', count: 1 },
        { id: 'a', week: 7, kind: 'add_starter', slot: 'FLEX', count: 1 },
      ],
      ctx,
    )
    expect(r.ok && r.value.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('drops the spot from a bench-only change', () => {
    const r = normalizeRosterSchedule([{ id: 'a', week: 5, kind: 'add_bench', slot: 'QB', count: 2 }], ctx)
    expect(r.ok && r.value[0]).toEqual({ id: 'a', week: 5, kind: 'add_bench', slot: null, count: 2 })
  })

  it.each([
    ['no spot', { id: 'a', week: 5, kind: 'add_starter', slot: null, count: 1 }, 'bad_change'],
    ['a count of 0', { id: 'a', week: 5, kind: 'add_bench', count: 0 }, 'bad_change'],
    ['a count of 4', { id: 'a', week: 5, kind: 'add_bench', count: 4 }, 'bad_change'],
    ['an unknown type', { id: 'a', week: 5, kind: 'double_roster', count: 1 }, 'bad_change'],
    ['taking a starting spot away', { id: 'a', week: 5, kind: 'remove_starter', slot: 'FLEX', count: 1 }, 'bad_change'],
    ['taking a bench spot away', { id: 'a', week: 5, kind: 'remove_bench', count: 1 }, 'bad_change'],
    ['a bench spot as a starter', { id: 'a', week: 5, kind: 'add_starter', slot: 'BN', count: 1 }, 'unknown_spot'],
    ['an injured-list spot', { id: 'a', week: 5, kind: 'add_starter', slot: 'IR', count: 1 }, 'unknown_spot'],
    ['a week already played', { id: 'a', week: 1, kind: 'add_bench', count: 1 }, 'bad_week'],
    ['a week after the season', { id: 'a', week: 18, kind: 'add_bench', count: 1 }, 'bad_week'],
  ])('refuses %s', (_name, row, error) => {
    expect(normalizeRosterSchedule([row], ctx)).toMatchObject({ ok: false, error })
  })

  it('a stored change sent back untouched keeps a week that is now being played', () => {
    const row = { id: 'waiting', week: 3, kind: 'add_bench', count: 1 }
    const playing = { ...ctx, fromWeek: 4 }
    expect(normalizeRosterSchedule([row], playing)).toMatchObject({ ok: false, error: 'bad_week' })
    expect(normalizeRosterSchedule([row], { ...playing, anyWeekIds: new Set(['waiting']) })).toMatchObject({ ok: true })
  })

  it('refuses two changes with one id, and a list that is too long', () => {
    const row = { id: 'a', week: 5, kind: 'add_bench', count: 1 }
    expect(normalizeRosterSchedule([row, { ...row, week: 6 }], ctx)).toMatchObject({ ok: false, error: 'duplicate_id' })
    const many = Array.from({ length: MAX_ROSTER_CHANGES + 1 }, (_, i) => ({ ...row, id: `c${i}` }))
    expect(normalizeRosterSchedule(many, ctx)).toMatchObject({ ok: false, error: 'too_many' })
  })

  it('refuses a list whose layouts stop being legal part-way through, naming the week', () => {
    const r = normalizeRosterSchedule(
      [
        { id: 'a', week: 4, kind: 'add_starter', slot: 'SUPERFLEX', count: 2 },
        { id: 'b', week: 9, kind: 'add_starter', slot: 'SUPERFLEX', count: 1 },
      ],
      ctx,
    )
    expect(r).toMatchObject({ ok: false, error: 'bad_layout' })
    expect(!r.ok && r.message).toMatch(/^Week 9: a league can have at most 2 Super Flex/)
  })

  it('an earlier change can make a later one legal', () => {
    const thin = { ...ctx, layout: { ...LAYOUT, BN: 0 } }
    const swap = { id: 'b', week: 9, kind: 'bench_to_starter', slot: 'WR', count: 1 }
    expect(normalizeRosterSchedule([swap], thin)).toMatchObject({ ok: false, error: 'bad_layout' })
    expect(normalizeRosterSchedule([swap, { id: 'a', week: 4, kind: 'add_bench', count: 1 }], thin)).toMatchObject({ ok: true })
  })

  it('says so when the season has no later week left', () => {
    const r = normalizeRosterSchedule([{ id: 'a', week: 17, kind: 'add_bench', count: 1 }], { ...ctx, fromWeek: 18, toWeek: 17 })
    expect(!r.ok && r.message).toMatch(/last week/)
  })
})

describe('reading what is stored', () => {
  it('reads a stored list, skipping anything malformed rather than throwing', () => {
    const settings = {
      [ROSTER_SCHEDULE_KEY]: [
        { id: 'ok', week: 10, kind: 'add_bench', count: 1 },
        { id: 'ok', week: 11, kind: 'add_bench', count: 1 },
        { week: 10, kind: 'add_bench', count: 1 },
        'nonsense',
        null,
      ],
    }
    expect(readRosterSchedule(settings).map((c) => c.id)).toEqual(['ok'])
    expect(readRosterSchedule(null)).toEqual([])
    expect(readRosterSchedule({ [ROSTER_SCHEDULE_KEY]: 'x' })).toEqual([])
  })

  it('reads the applied state, and a half-written run', () => {
    expect(readRosterScheduleState({})).toEqual({ done: [], skipped: [], pending: null })
    const state = readRosterScheduleState({
      [ROSTER_SCHEDULE_STATE_KEY]: { done: ['a', 7], skipped: [{ id: 'z', reason: 'why' }, 'junk'], pending: { week: 10, ids: ['b'], skipped: [{ id: 'c', reason: 'no bench' }], slots: { QB: 1, BN: 5, bad: -1 } } },
    })
    expect(state.done).toEqual(['a'])
    expect(state.skipped).toEqual([{ id: 'z', reason: 'why' }])
    expect(state.pending).toEqual({ week: 10, ids: ['b'], skipped: [{ id: 'c', reason: 'no bench' }], slots: { QB: 1, BN: 5 }, seatsBefore: [] })
    // No layout recorded = nothing to resume.
    expect(readRosterScheduleState({ [ROSTER_SCHEDULE_STATE_KEY]: { pending: { week: 10, ids: ['b'] } } }).pending).toBeNull()
  })
})

describe('the words', () => {
  it('describes each kind of change', () => {
    expect(describeRosterChange(change({ kind: 'add_starter', slot: 'SUPERFLEX' }), spots)).toBe('Add 1 Super Flex starting spot')
    expect(describeRosterChange(change({ kind: 'add_starter', slot: 'FLEX', count: 2 }), spots)).toBe('Add 2 Flex starting spots')
    expect(describeRosterChange(change({ kind: 'add_bench', count: 2 }), spots)).toBe('Add 2 bench spots')
    expect(describeRosterChange(change({ kind: 'bench_to_starter', slot: 'WR' }), spots)).toBe('Turn 1 bench spot into a Wide Receiver starting spot')
    expect(describeRosterChange(change({ kind: 'bench_to_starter', slot: 'RB', count: 2 }), spots)).toBe('Turn 2 bench spots into 2 Running Back starting spots')
  })

  it('sums a layout', () => {
    expect(describeLayout(LAYOUT, spots)).toBe('9 starters, 6 bench')
    expect(describeLayout({ QB: 1, BN: 0 }, spots)).toBe('1 starter, 0 bench')
  })
})
