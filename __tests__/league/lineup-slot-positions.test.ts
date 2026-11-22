/**
 * Starter slot positions are stored on the server (`lineup_sections.starters[i].slotIndex`), so a
 * lineup saved with an EMPTY slot comes back with the hole exactly where the manager left it.
 *
 * Before this, starters were stored as a compacted list and the screen re-seated them on load
 * (`seatStartersInSlots`). With a FLEX slot that moved the hole: bench RB2 and leave FLEX's RB in
 * place, reload, and the FLEX RB had slid into the RB2 slot with FLEX empty instead. These tests
 * drive the real save normalizer (`buildPersistedRosterDataFromRosterState`, what
 * /api/leagues/roster/save stores) and the real reader (`buildLineupListsFromPlayerData` + the
 * screen's `seatStartersInSlots`), through a JSON round-trip as Postgres would.
 */
import { describe, expect, it } from 'vitest'
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import type { RosterTemplateDto } from '@/lib/multi-sport/RosterTemplateService'
import { buildLineupListsFromPlayerData } from '@/lib/league/lineup-swap'
import { placeStartersBySlotIndex } from '@/lib/league/lineupSlotPositions'
import { seatStartersInSlots } from '@/lib/league/native/lineupMoves'
import { buildPersistedRosterDataFromRosterState } from '@/lib/roster/buildPersistedRosterDataFromRosterState'
import { buildPlayerDataFromSections, getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { applyStarterSwap } from '@/lib/roster/starterSwap'
import { validateCanonicalRosterPayload } from '@/lib/roster-lineup-engine/rosterValidationService'
import type { LineupValidationContext } from '@/lib/roster-lineup-engine/types'

const slot = (index: number, label: string, allowedPositions: string[]): ExpandedStarterSlot => ({
  index,
  label,
  allowedPositions,
  isFlexible: allowedPositions.length > 1,
})
// QB, RB1, RB2, WR1, WR2, TE, FLEX
const SLOTS = [
  slot(0, 'QB', ['QB']),
  slot(1, 'RB1', ['RB']),
  slot(2, 'RB2', ['RB']),
  slot(3, 'WR1', ['WR']),
  slot(4, 'WR2', ['WR']),
  slot(5, 'TE', ['TE']),
  slot(6, 'FLEX', ['RB', 'WR', 'TE']),
]
const POS: Record<string, string> = { qb: 'QB', rbA: 'RB', rbB: 'RB', wrA: 'WR', wrB: 'WR', te: 'TE', rbF: 'RB', k: 'K' }
const positionOf = (id: string) => POS[id]

/** What NativeLineupScreen sends: one row per FILLED slot, carrying that slot's index. */
function clientRosterState(layout: string[], bench: string[] = []) {
  return {
    starters: layout
      .map((id, i) => (id ? { id, name: id, position: POS[id], slotIndex: i } : null))
      .filter((x): x is NonNullable<typeof x> => x != null),
    bench: bench.map((id) => ({ id, name: id, position: POS[id] })),
    ir: [],
    taxi: [],
    devy: [],
  }
}
/** Saved through the route's normalizer, then a JSON round-trip (what the JSONB column returns). */
const store = (rosterState: unknown, existing: unknown = {}) =>
  JSON.parse(JSON.stringify(buildPersistedRosterDataFromRosterState(rosterState, existing))) as Record<string, unknown>
/** What the screen shows after a reload. */
const reload = (playerData: unknown) =>
  seatStartersInSlots(buildLineupListsFromPlayerData(playerData, SLOTS.length).starters, SLOTS, positionOf)
/** The same stored lineup with its positions removed — every lineup saved before this change. */
function withoutPositions(playerData: Record<string, unknown>) {
  const sections = playerData.lineup_sections as Record<string, Array<Record<string, unknown>>>
  return {
    ...playerData,
    lineup_sections: {
      ...sections,
      starters: sections.starters.map(({ slotIndex: _drop, ...rest }) => rest),
    },
  }
}

describe('a saved empty slot round-trips to the same layout', () => {
  it('an empty middle slot stays empty after a reload', () => {
    const layout = ['qb', 'rbA', 'rbB', 'wrA', '', 'te', 'rbF']
    const saved = store(clientRosterState(layout, ['wrB']))
    // The legacy lists every other reader uses are unchanged: compacted ids, no holes.
    expect(saved.starters).toEqual(['qb', 'rbA', 'rbB', 'wrA', 'te', 'rbF'])
    expect((saved.lineup_sections as { starters: Array<{ slotIndex: number }> }).starters.map((r) => r.slotIndex)).toEqual([0, 1, 2, 3, 5, 6])
    expect(reload(saved)).toEqual(layout)
  })

  it('the FLEX example that used to shift no longer does', () => {
    // RB2 benched, FLEX keeps its RB. Before slot positions, the reload moved the FLEX RB into RB2.
    const layout = ['qb', 'rbA', '', 'wrA', 'wrB', 'te', 'rbF']
    const saved = store(clientRosterState(layout, ['rbB']))
    const legacy = reload(withoutPositions(saved))
    expect(legacy[2]).not.toBe('') // the FLEX RB was re-seated into the slot the manager emptied...
    expect(legacy[6]).toBe('') // ...and FLEX came back empty instead
    expect(legacy).toEqual(['qb', 'rbF', 'rbA', 'wrB', 'wrA', 'te', ''])
    expect(reload(saved)).toEqual(layout)
  })

  it('a re-save of the reloaded layout is stable', () => {
    const layout = ['', 'rbA', '', 'wrA', 'wrB', '', 'rbF']
    const first = store(clientRosterState(layout, ['qb', 'rbB', 'te']))
    const again = store(clientRosterState(reload(first), ['qb', 'rbB', 'te']), first)
    expect(reload(again)).toEqual(layout)
  })
})

describe('old data without positions falls back to re-seating', () => {
  it('lineup_sections without slotIndex reads exactly as before', () => {
    const old = {
      starters: ['qb', 'rbA', 'wrA', 'wrB', 'te', 'rbF'],
      lineup_sections: { starters: ['qb', 'rbA', 'wrA', 'wrB', 'te', 'rbF'].map((id) => ({ id, position: POS[id] })), bench: [{ id: 'rbB', position: 'RB' }] },
    }
    const compacted = buildLineupListsFromPlayerData(old, SLOTS.length).starters
    expect(compacted).toEqual(['qb', 'rbA', 'wrA', 'wrB', 'te', 'rbF', ''])
    expect(reload(old)).toEqual(seatStartersInSlots(compacted, SLOTS, positionOf))
    expect(reload(old)).toEqual(['qb', 'rbF', 'rbA', 'wrB', 'wrA', 'te', ''])
  })

  it('a legacy top-level starters array (no sections) still reads', () => {
    expect(buildLineupListsFromPlayerData({ starters: ['qb', 'rbA'] }, 3).starters).toEqual(['qb', 'rbA', ''])
  })

  it('invalid positions are ignored rather than trusted', () => {
    const rows = (pairs: Array<[string, unknown]>) => pairs.map(([id, slotIndex]) => ({ id, slotIndex }))
    // Duplicate index: both rows are unpositioned, filled into open slots in saved order.
    expect(placeStartersBySlotIndex(rows([['qb', 0], ['rbA', 0]]), 3)).toBeNull()
    // Out of range, negative, non-integer, string: ignored.
    expect(placeStartersBySlotIndex(rows([['qb', 9], ['rbA', -1], ['wrA', 1.5], ['wrB', '2']]), 3)).toBeNull()
    // Mixed: positioned rows keep their slot, the rest fill the open slots in order.
    expect(placeStartersBySlotIndex(rows([['qb', 2], ['rbA', undefined], ['wrA', 0]]), 4)).toEqual(['wrA', 'rbA', 'qb', ''])
  })
})

describe('positions live on STARTER rows only', () => {
  it('a bench, IR, taxi or devy row never carries a slotIndex', () => {
    const pd = { lineup_sections: { starters: [{ id: 'qb', position: 'QB', slotIndex: 0 }], bench: [{ id: 'rbA', position: 'RB', slotIndex: 1 }], ir: [{ id: 'te', slotIndex: 5 }] } }
    const s = getNormalizedLineupSections(pd)
    expect(s.starters[0].slotIndex).toBe(0)
    expect('slotIndex' in s.bench[0]).toBe(false)
    expect('slotIndex' in s.ir[0]).toBe(false)
    const built = buildPlayerDataFromSections({}, { ...s, bench: [{ id: 'wrA', slotIndex: 3 }] }) as { lineup_sections: Record<string, Array<Record<string, unknown>>> }
    expect('slotIndex' in built.lineup_sections.bench[0]).toBe(false)
    const persisted = store({ starters: [{ id: 'qb', position: 'QB', slotIndex: 0 }], bench: [{ id: 'rbA', position: 'RB', slotIndex: 1 }] })
    expect('slotIndex' in (persisted.lineup_sections as { bench: Array<Record<string, unknown>> }).bench[0]).toBe(false)
  })

  it('the Team tab starter swap hands the incoming player the outgoing starter\'s slot', () => {
    const saved = store(clientRosterState(['qb', 'rbA', '', 'wrA', 'wrB', 'te', 'rbF'], ['rbB']))
    // Compact index 1 is rbA (slot RB1); swap in the bench RB.
    const swapped = applyStarterSwap(saved, 1, 'rbB')
    expect(reload(swapped)).toEqual(['qb', 'rbB', '', 'wrA', 'wrB', 'te', 'rbF'])
    const bench = (swapped.lineup_sections as { bench: Array<Record<string, unknown>> }).bench
    expect(bench.map((r) => r.id)).toEqual(['rbA'])
    expect('slotIndex' in bench[0]).toBe(false)
  })
})

// --- server validation -----------------------------------------------------------------------

const TEMPLATE = {
  templateId: 't',
  name: 't',
  formatType: 'standard',
  slots: [
    { slotName: 'QB', allowedPositions: ['QB'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 0 },
    { slotName: 'RB', allowedPositions: ['RB'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 1 },
    { slotName: 'WR', allowedPositions: ['WR'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 2 },
    { slotName: 'TE', allowedPositions: ['TE'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 3 },
    { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: true, slotOrder: 4 },
    { slotName: 'BN', allowedPositions: ['*'], starterCount: 0, benchCount: 7, reserveCount: 2, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 5 },
  ],
} as unknown as RosterTemplateDto

function vctx(over: Partial<LineupValidationContext> = {}): LineupValidationContext {
  return {
    league: {
      id: 'L', sport: 'NFL', leagueVariant: null, settings: {}, lifecycleState: 'in_season', lockAllMoves: false,
      irAllowOut: true, irAllowCovid: true, irAllowSuspended: true, irAllowNA: true, irAllowDNR: true, irAllowDoubtful: false,
      taxiSlots: 0, taxiAllowNonRookies: false, taxiYearsLimit: null, guillotineMode: false, bestBallMode: false,
    } as never,
    template: TEMPLATE,
    season: 2026,
    week: 5,
    starterSlots: SLOTS,
    ...over,
  }
}
const codes = (pd: unknown, c = vctx()) => validateCanonicalRosterPayload(pd, c).issues.map((i) => i.code)

describe('the server validates every positioned starter against HIS slot', () => {
  it('accepts a lineup with an empty slot', () => {
    const pd = store(clientRosterState(['qb', 'rbA', '', 'wrA', 'wrB', 'te', 'rbF'], ['rbB']))
    expect(validateCanonicalRosterPayload(pd, vctx())).toEqual({ ok: true, issues: [] })
  })

  it('rejects an ineligible player in a slot, naming the slot', () => {
    // A WR in the RB1 slot: legal by the template's union of starter positions, illegal in that slot.
    const pd = store({ starters: [{ id: 'qb', position: 'QB', slotIndex: 0 }, { id: 'wrA', position: 'WR', slotIndex: 1 }] })
    const r = validateCanonicalRosterPayload(pd, vctx())
    expect(r.ok).toBe(false)
    expect(r.issues).toEqual([expect.objectContaining({ code: 'starter_slot_ineligible', playerId: 'wrA', section: 'starters' })])
    expect(r.issues[0].message).toMatch(/RB1/)
  })

  it('rejects two starters in one slot and a slot that does not exist', () => {
    expect(codes(store({ starters: [{ id: 'rbA', position: 'RB', slotIndex: 1 }, { id: 'rbB', position: 'RB', slotIndex: 1 }] }))).toContain('starter_slot_duplicate')
    expect(codes(store({ starters: [{ id: 'rbA', position: 'RB', slotIndex: 7 }] }))).toContain('starter_slot_out_of_range')
    // A raw `rosterData` merge skips the normalizer, so a malformed index reaches the validator as-is.
    expect(codes({ lineup_sections: { starters: [{ id: 'rbA', position: 'RB', slotIndex: 'one' }] } })).toContain('starter_slot_invalid')
  })

  it('still rejects a starter position the template does not allow at all, positioned or not', () => {
    expect(codes(store({ starters: [{ id: 'k', position: 'K' }] }))).toContain('starter_position_ineligible')
    expect(codes(store({ starters: [{ id: 'k', position: 'K', slotIndex: 0 }] }))).toEqual(
      expect.arrayContaining(['starter_position_ineligible', 'starter_slot_ineligible']),
    )
  })

  it('an unpositioned lineup (every other writer) is validated exactly as before', () => {
    const pd = store({ starters: ['qb', 'wrA', 'wrB'].map((id) => ({ id, position: POS[id] })) })
    expect(validateCanonicalRosterPayload(pd, vctx())).toEqual({ ok: true, issues: [] })
  })

  it('without a slot layout there is no per-slot check', () => {
    const pd = store({ starters: [{ id: 'wrA', position: 'WR', slotIndex: 1 }] })
    expect(validateCanonicalRosterPayload(pd, vctx({ starterSlots: undefined })).ok).toBe(true)
  })

  it('a position CARRIED UNCHANGED from the stored lineup is not held against a save (template changed since)', () => {
    // Stored when slot 1 was a FLEX; the commissioner has since made it RB-only. An automated writer
    // that preserves rows must not be refused for a slot nobody moved.
    const stored = { lineup_sections: { starters: [{ id: 'te', position: 'TE', slotIndex: 1 }] } }
    const next = { lineup_sections: { starters: [{ id: 'te', position: 'TE', slotIndex: 1 }, { id: 'qb', position: 'QB', slotIndex: 0 }] } }
    expect(validateCanonicalRosterPayload(next, vctx({ previousPlayerData: stored })).ok).toBe(true)
    // ...but MOVING someone into it is a new claim and is checked.
    const moved = { lineup_sections: { starters: [{ id: 'wrA', position: 'WR', slotIndex: 1 }] } }
    expect(codes(moved, vctx({ previousPlayerData: stored }))).toContain('starter_slot_ineligible')
  })
})
