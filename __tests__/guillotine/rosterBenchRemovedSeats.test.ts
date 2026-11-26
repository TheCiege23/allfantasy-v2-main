import { describe, expect, it } from 'vitest'
import { planBenchForRemovedSeats, unseatableStarters, withoutStarterSeats } from '@/lib/guillotine/rosterBenchRemovedSeats'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'

/** A real league's seat order (measured, see lib/guillotine/rosterSeatRemap.ts). */
const BEFORE = ['K', 'QB', 'RB1', 'RB2', 'TE', 'WR1', 'WR2', 'DEF', 'FLEX']
const NO_FLEX = ['K', 'QB', 'RB1', 'RB2', 'TE', 'WR1', 'WR2', 'DEF']
const ONE_RB = ['K', 'QB', 'RB', 'TE', 'WR1', 'WR2', 'DEF', 'FLEX']

const capacities = (slots: Record<string, number>) => resolveRedraftRosterConfig('NFL', { roster: { config: { sections: [{ key: 'primary', slots }] } } }).starterCapacities
const CAP_BEFORE = capacities({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6, IR: 1 })
const CAP_NO_FLEX = capacities({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1, BN: 7, IR: 1 })
const CAP_ONE_RB = capacities({ QB: 1, RB: 1, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 7, IR: 1 })

const starter = (id: string, position: string, slotIndex?: number) => ({ id, position, name: `${id} name`, ...(slotIndex == null ? {} : { slotIndex }) })
const lineup = (starters: Array<Record<string, unknown>>, bench: Array<Record<string, unknown>> = [{ id: 'bn1', position: 'WR', name: 'bn1 name' }]) => ({
  players: [...starters, ...bench].map((r) => r.id),
  starters: starters.map((r) => r.id),
  lineup_sections: { starters, bench, ir: [], taxi: [], devy: [] },
})
/** A full lineup, every seat filled, saved with its seats. */
const FULL = () =>
  lineup([
    starter('k', 'K', 0),
    starter('qb', 'QB', 1),
    starter('rb1', 'RB', 2),
    starter('rb2', 'RB', 3),
    starter('te', 'TE', 4),
    starter('wr1', 'WR', 5),
    starter('wr2', 'WR', 6),
    starter('def', 'DEF', 7),
    starter('flex', 'WR', 8),
  ])
const plan = (playerData: unknown, after: string[], cap: ReadonlyMap<string, number>, trustSavedSeats = true) =>
  planBenchForRemovedSeats({ playerData, sport: 'NFL', seatsBefore: BEFORE, seatsAfter: after, capacities: cap, capacitiesBefore: CAP_BEFORE, trustSavedSeats })
const sections = (p: { playerData: Record<string, unknown> } | null) => (p!.playerData.lineup_sections as { starters: Array<Record<string, unknown>>; bench: Array<Record<string, unknown>> })

describe('the player in the spot that is taken away', () => {
  it('the Flex spot goes: the player in the Flex seat is benched, by name', () => {
    const p = plan(FULL(), NO_FLEX, CAP_NO_FLEX)
    expect(p?.benched).toEqual([{ id: 'flex', name: 'flex name' }])
    expect(sections(p).starters.map((r) => r.id)).toEqual(['k', 'qb', 'rb1', 'rb2', 'te', 'wr1', 'wr2', 'def'])
    expect(sections(p).bench.map((r) => r.id)).toEqual(['bn1', 'flex'])
  })

  it('it is the player in THAT seat, not whichever one a matching would leave out', () => {
    // RB2's seat is removed. The Flex seat holds a receiver, so the second back cannot slide there.
    const p = plan(FULL(), ONE_RB, CAP_ONE_RB)
    expect(p?.benched.map((b) => b.id)).toEqual(['rb2'])
  })

  it('the second back goes to the bench even when the Flex seat is empty for him', () => {
    // The owner's rule: the player sitting in the spot. His manager can start him at Flex; AllFantasy does not.
    const withEmptyFlex = lineup(FULL().lineup_sections.starters.filter((r) => r.id !== 'flex'))
    expect(plan(withEmptyFlex, ONE_RB, CAP_ONE_RB)?.benched.map((b) => b.id)).toEqual(['rb2'])
  })

  it('an empty seat taken away moves nobody', () => {
    const withEmptyFlex = lineup(FULL().lineup_sections.starters.filter((r) => r.id !== 'flex'))
    expect(plan(withEmptyFlex, NO_FLEX, CAP_NO_FLEX)).toBeNull()
  })

  it('everyone else keeps his own seat, at its new position', () => {
    const p = plan(FULL(), ONE_RB, CAP_ONE_RB)
    const at = Object.fromEntries(sections(p).starters.map((r) => [r.id, ONE_RB[r.slotIndex as number]]))
    expect(at).toEqual({ k: 'K', qb: 'QB', rb1: 'RB', te: 'TE', wr1: 'WR1', wr2: 'WR2', def: 'DEF', flex: 'FLEX' })
  })

  it('the benched player takes no seat with him, and nobody is dropped', () => {
    const p = plan(FULL(), NO_FLEX, CAP_NO_FLEX)
    expect(sections(p).bench.find((r) => r.id === 'flex')).not.toHaveProperty('slotIndex')
    expect([...(p!.playerData.players as string[])].sort()).toEqual([...FULL().players].sort())
    expect(p!.playerData.starters).toEqual(['k', 'qb', 'rb1', 'rb2', 'te', 'wr1', 'wr2', 'def'])
  })

  it('never mutates the lineup it was given', () => {
    const before = FULL()
    const copy = JSON.stringify(before)
    plan(before, NO_FLEX, CAP_NO_FLEX)
    expect(JSON.stringify(before)).toBe(copy)
  })
})

describe('the safety net: anyone the new layout cannot seat', () => {
  const unpositioned = () => lineup(FULL().lineup_sections.starters.map(({ slotIndex: _s, ...r }) => r))

  it('a lineup saved without seats: the one who cannot be seated is benched, and only him', () => {
    const p = plan(unpositioned(), NO_FLEX, CAP_NO_FLEX)
    // Three receivers for two WR seats and no Flex: exactly one has no seat.
    expect(p?.benched).toHaveLength(1)
    expect(['wr1', 'wr2', 'flex']).toContain(p!.benched[0]!.id)
    expect(sections(p).starters).toHaveLength(8)
  })

  it('a lineup that still fits is left alone', () => {
    const short = lineup(FULL().lineup_sections.starters.filter((r) => r.id !== 'flex').map(({ slotIndex: _s, ...r }) => r))
    expect(plan(short, NO_FLEX, CAP_NO_FLEX)).toBeNull()
  })

  it('a roster changed after the layout did: its saved seats are not read as the old layout', () => {
    // Saved against the NEW layout (no Flex): position 7 is the defense. Read as the old layout it is also the
    // defense here, so use ONE_RB, where new position 2 is the only back and old position 3 was RB2.
    const savedAgainstNew = lineup([starter('k', 'K', 0), starter('qb', 'QB', 1), starter('rb1', 'RB', 2), starter('te', 'TE', 3), starter('wr1', 'WR', 4), starter('wr2', 'WR', 5), starter('def', 'DEF', 6), starter('flex', 'WR', 7)])
    // Trusted, position 3 would be read as the old RB2 seat and the tight end benched. Not trusted: nobody.
    expect(plan(savedAgainstNew, ONE_RB, CAP_ONE_RB, true)?.benched.map((b) => b.id)).toEqual(['te'])
    expect(plan(savedAgainstNew, ONE_RB, CAP_ONE_RB, false)).toBeNull()
  })

  it('and when it does need a move, its seats are dropped rather than guessed', () => {
    const p = plan(FULL(), NO_FLEX, CAP_NO_FLEX, false)
    expect(p?.benched).toHaveLength(1)
    for (const row of sections(p).starters) expect(row).not.toHaveProperty('slotIndex')
  })

  it('🛑 a player with a missing or unknown position is never benched for it', () => {
    // Found by this suite: a row with no position reads as the placeholder UTIL, which no football slot takes,
    // and "cannot be seated" alone benched all nine starters.
    const oddTightEnd = lineup(FULL().lineup_sections.starters.map((r) => (r.id === 'te' ? { ...r, position: 'XYZ' } : r)))
    expect(plan(oddTightEnd, NO_FLEX, CAP_NO_FLEX)?.benched.map((b) => b.id)).toEqual(['flex'])
    const noPosition = lineup(FULL().lineup_sections.starters.map((r) => (r.id === 'te' ? { id: 'te', slotIndex: 4 } : r)))
    expect(plan(noPosition, NO_FLEX, CAP_NO_FLEX)?.benched.map((b) => b.id)).toEqual(['flex'])
    // And with nothing taken from his lineup, nothing happens to it at all.
    expect(plan(oddTightEnd, BEFORE, CAP_BEFORE)).toBeNull()
  })

  it('rows with no position: only a certain overflow is benched, from the end', () => {
    const bare = lineup(FULL().lineup_sections.starters.map((r) => ({ id: r.id })))
    expect(plan(bare, NO_FLEX, CAP_NO_FLEX)?.benched.map((b) => b.id)).toEqual(['flex'])
    const fits = lineup(FULL().lineup_sections.starters.slice(0, 8).map((r) => ({ id: r.id })))
    expect(plan(fits, NO_FLEX, CAP_NO_FLEX)).toBeNull()
  })

  it('an empty lineup, and a legacy roster with no sections, need nothing', () => {
    expect(plan(lineup([]), NO_FLEX, CAP_NO_FLEX)).toBeNull()
    expect(plan(['a', 'b'], NO_FLEX, CAP_NO_FLEX)).toBeNull()
    expect(plan(null, NO_FLEX, CAP_NO_FLEX)).toBeNull()
  })
})

describe('who cannot be seated', () => {
  it('seats a back in the Flex before calling him unseatable', () => {
    const three = [{ id: 'a', position: 'RB' }, { id: 'b', position: 'RB' }, { id: 'c', position: 'RB' }]
    expect(unseatableStarters('NFL', three, capacities({ RB: 2, FLEX: 1, BN: 5 }))).toEqual([])
    expect(unseatableStarters('NFL', three, capacities({ RB: 2, BN: 5 }))).toHaveLength(1)
  })

  it('reads a defense under either spelling', () => {
    const cap = capacities({ QB: 1, DEF: 1, BN: 5 })
    expect(unseatableStarters('NFL', [{ id: 'd', position: 'DEF' }], cap)).toEqual([])
    expect(unseatableStarters('NFL', [{ id: 'd', position: 'DST' }], cap)).toEqual([])
  })
})

describe('dropping saved seats', () => {
  it('removes every starter seat and nothing else', () => {
    const before = FULL()
    const next = withoutStarterSeats(before) as ReturnType<typeof FULL>
    expect(next.lineup_sections.starters.map((r) => r.id)).toEqual(before.lineup_sections.starters.map((r) => r.id))
    for (const row of next.lineup_sections.starters) expect(row).not.toHaveProperty('slotIndex')
    expect(next.lineup_sections.bench).toEqual(before.lineup_sections.bench)
  })

  it('returns the same object when there is no seat to drop', () => {
    const none = lineup([{ id: 'a', position: 'QB' }])
    expect(withoutStarterSeats(none)).toBe(none)
    expect(withoutStarterSeats(null)).toBeNull()
  })
})
