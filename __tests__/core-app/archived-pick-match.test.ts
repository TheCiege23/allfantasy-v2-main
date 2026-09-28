/**
 * An archived trade row's picks paired with what the graded ledger says each became.
 *
 * The fixture is the production trade that exposed the gap (2026-09-25, Sleeper league
 * 1313185505852018688): roster 1 sent its own 2026 8th to roster 10 and got its own 2026 6th back.
 * Sleeper's draft results say the 8th (slot 3) was Alec Pierce and the 6th was Kyler Murray. The
 * board graded the swap C at "560 for 560", both priced as picks that no longer existed.
 */
import { describe, expect, it } from 'vitest'
import { draftedPickNamesForRow, withDraftedNames, type LedgerTradeSide } from '@/lib/core-app/archivedPickMatch'

const resolved = (name: string) => ({ playerId: 'x', name, position: null, creditedBySeason: {}, departed: null })
const pick = (season: string, round: number, name: string | null) => ({
  season,
  round,
  originalRosterId: 1,
  label: `${season} round ${round}`,
  resolved: name ? resolved(name) : null,
  pending: !name,
  rerouted: false,
})

const SWAP: LedgerTradeSide[] = [
  { rosterId: 1, picksIn: [pick('2026', 6, 'Kyler Murray')], picksOut: [pick('2026', 8, 'Alec Pierce')] },
  { rosterId: 10, picksIn: [pick('2026', 8, 'Alec Pierce')], picksOut: [pick('2026', 6, 'Kyler Murray')] },
]

describe('draftedPickNamesForRow', () => {
  it('finds the row’s side by its picks and names each one — both copies of the trade', () => {
    expect(
      draftedPickNamesForRow(
        { picksIn: [{ season: '2026', round: 6 }], picksOut: [{ season: '2026', round: 8 }], partnerRosterId: 10 },
        SWAP,
      ),
    ).toEqual({ picksIn: ['Kyler Murray'], picksOut: ['Alec Pierce'] })
    expect(
      draftedPickNamesForRow(
        { picksIn: [{ season: '2026', round: 8 }], picksOut: [{ season: '2026', round: 6 }], partnerRosterId: 1 },
        SWAP,
      ),
    ).toEqual({ picksIn: ['Alec Pierce'], picksOut: ['Kyler Murray'] })
  })

  it('without a partner roster, the picks alone pick the side when only one side matches', () => {
    expect(
      draftedPickNamesForRow({ picksIn: [{ season: 2026, round: 6 }], picksOut: [{ season: '2026', round: 8 }], partnerRosterId: null }, SWAP),
    ).toEqual({ picksIn: ['Kyler Murray'], picksOut: ['Alec Pierce'] })
  })

  it('🛑 a mirror-image swap with no partner roster is ambiguous: null, never a guess', () => {
    const mirror: LedgerTradeSide[] = [
      { rosterId: 1, picksIn: [pick('2026', 6, 'A')], picksOut: [pick('2026', 6, 'B')] },
      { rosterId: 2, picksIn: [pick('2026', 6, 'B')], picksOut: [pick('2026', 6, 'A')] },
    ]
    const row = { picksIn: [{ season: '2026', round: 6 }], picksOut: [{ season: '2026', round: 6 }] }
    expect(draftedPickNamesForRow({ ...row, partnerRosterId: null }, mirror)).toBeNull()
    // Naming the partner settles it.
    expect(draftedPickNamesForRow({ ...row, partnerRosterId: 2 }, mirror)).toEqual({ picksIn: ['A'], picksOut: ['B'] })
  })

  it('picks that do not match the ledger’s side exactly return null — the row is not this trade as recorded', () => {
    expect(
      draftedPickNamesForRow({ picksIn: [{ season: '2026', round: 6 }], picksOut: [], partnerRosterId: 10 }, SWAP),
    ).toBeNull()
  })

  it('an unresolved pick in the ledger stays null — still a pick, not a player', () => {
    const sides: LedgerTradeSide[] = [
      { rosterId: 1, picksIn: [pick('2027', 1, null)], picksOut: [] },
      { rosterId: 2, picksIn: [], picksOut: [pick('2027', 1, null)] },
    ]
    expect(draftedPickNamesForRow({ picksIn: [{ season: '2027', round: 1 }], picksOut: [], partnerRosterId: 2 }, sides)).toEqual({
      picksIn: [null],
      picksOut: [],
    })
  })

  it('two identical picks each get one of the two drafted players', () => {
    const sides: LedgerTradeSide[] = [
      { rosterId: 1, picksIn: [pick('2026', 1, 'First'), pick('2026', 1, 'Second')], picksOut: [] },
      { rosterId: 2, picksIn: [], picksOut: [pick('2026', 1, 'First'), pick('2026', 1, 'Second')] },
    ]
    const names = draftedPickNamesForRow(
      { picksIn: [{ season: '2026', round: 1 }, { season: '2026', round: 1 }], picksOut: [], partnerRosterId: 2 },
      sides,
    )
    expect([...(names?.picksIn ?? [])].sort()).toEqual(['First', 'Second'])
  })

  it('no ledger, no picks, or malformed sides: null', () => {
    const row = { picksIn: [{ season: '2026', round: 6 }], picksOut: [], partnerRosterId: null }
    expect(draftedPickNamesForRow(row, undefined)).toBeNull()
    expect(draftedPickNamesForRow(row, [])).toBeNull()
    expect(draftedPickNamesForRow({ picksIn: [], picksOut: [], partnerRosterId: null }, SWAP)).toBeNull()
    expect(draftedPickNamesForRow(row, [{ rosterId: 1, picksIn: 'nope', picksOut: null }])).toBeNull()
  })
})

describe('withDraftedNames', () => {
  it('carries the drafted player for the grader and into the label', () => {
    expect(withDraftedNames([{ name: '2026 8th' }, { name: '2027 1st' }], ['Alec Pierce', null])).toEqual([
      { name: '2026 8th · Alec Pierce', drafted: 'Alec Pierce' },
      { name: '2027 1st', drafted: null },
    ])
  })

  it('a names list that does not line up is ignored rather than shifted onto the wrong pick', () => {
    expect(withDraftedNames([{ name: '2026 8th' }, { name: '2027 1st' }], ['Alec Pierce'])).toEqual([
      { name: '2026 8th', drafted: null },
      { name: '2027 1st', drafted: null },
    ])
  })
})
