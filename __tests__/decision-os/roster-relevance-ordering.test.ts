/**
 * R1.4 — the bounded rows are the ASKER's players, not the first eight.
 *
 * 🛑 MEASURED ON A LIVE PACKET (§0.9): "the 8 rendered rows are arbitrary — first-8, not the
 * user's roster and not top-ranked. Bounding is correct; ordering is not solved. For 'what is
 * my WR worth' the right 8 are the asker's players."
 *
 * A value feed can carry hundreds of players. Taking `slice(0, 8)` of it answers a question
 * nobody asked, and the asker's own players reached the prompt only by luck.
 */
import { describe, it, expect } from 'vitest'

import {
  rosterPlayerKeys,
  orderByRosterRelevance,
  serializeDecisionOsGroundingForPrompt,
} from '@/lib/decision-os/grounding/serialize'
import type { DecisionOsGroundingPacket } from '@/lib/decision-os/grounding/packet'

const slice = (value: unknown, present = true) =>
  ({ present, value, asOf: null, servedFrom: 'live', confidence: 1, conclusive: { ok: true }, gap: null }) as never

/** A packet carrying market values, and optionally the asker's roster under contextFacts. */
function packetWithRoster(
  values: unknown[],
  rosterPlayers: Array<{ playerId?: string; name?: string }> | null,
): DecisionOsGroundingPacket {
  const absent = { present: false, value: null, asOf: null, servedFrom: null, confidence: 0, conclusive: { ok: true }, gap: null }
  return {
    leagueId: 'L1',
    userId: 'U1',
    builtAt: '2026-09-02T12:00:00.000Z',
    importAssertions: absent,
    leagueRules: absent,
    marketValues: slice(values),
    devyValues: absent,
    projections: absent,
    contextFacts: rosterPlayers
      ? { roster: slice({ starters: rosterPlayers, bench: [] }) }
      : null,
    contextLookups: null,
    commissionerIntelligence: absent,
    leagueIntelligence: absent,
    portfolio: absent,
    savedAnalysis: absent,
    managerPsychology: absent,
    gaps: [],
    meta: { durationMs: 1, engineMs: null, sources: [], killedFeeds: [] },
  } as unknown as DecisionOsGroundingPacket
}

describe('R1.4 · rosterPlayerKeys', () => {
  it('collects starters AND bench — a bench player is still the asker\'s', () => {
    const keys = rosterPlayerKeys(
      slice({ starters: [{ playerId: 'p1', name: 'Ja\'Marr Chase' }], bench: [{ playerId: 'p2', name: 'Jaylen Waddle' }] }),
    )
    expect(keys.has('p1')).toBe(true)
    expect(keys.has('p2')).toBe(true)
  })

  it('normalises names so punctuation differences still match', () => {
    const keys = rosterPlayerKeys(slice({ starters: [{ name: 'T.J. Hockenson' }] }))
    expect(keys.has('tjhockenson')).toBe(true)
  })

  it('an absent or empty roster yields an empty set, never throws', () => {
    expect(rosterPlayerKeys(slice(null, false)).size).toBe(0)
    expect(rosterPlayerKeys(null).size).toBe(0)
    expect(rosterPlayerKeys(undefined).size).toBe(0)
    expect(rosterPlayerKeys(slice({})).size).toBe(0)
  })
})

describe('R1.4 · orderByRosterRelevance', () => {
  const mine = new Set(['mine1', 'mine2'])

  it('🛑 the asker\'s players are promoted ahead of a long arbitrary list', () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => ({ playerId: `other${i}` })),
      { playerId: 'mine1' },
      { playerId: 'mine2' },
    ]
    const { ordered, promoted } = orderByRosterRelevance(rows, mine)
    expect(promoted).toBe(2)
    expect((ordered[0] as { playerId: string }).playerId).toBe('mine1')
    expect((ordered[1] as { playerId: string }).playerId).toBe('mine2')
  })

  it('matches on playerName as well as playerId', () => {
    const keys = new Set(['jamarrchase'])
    const rows = [{ playerId: 'zzz' }, { playerName: "Ja'Marr Chase" }]
    const { ordered, promoted } = orderByRosterRelevance(rows, keys)
    expect(promoted).toBe(1)
    expect((ordered[0] as { playerName: string }).playerName).toBe("Ja'Marr Chase")
  })

  /**
   * ⚠ A STABLE PARTITION, NOT A SORT. A feed already emitting by descending value must keep
   * that order inside the promoted group, and the same packet must render the same text twice.
   */
  it('preserves the producer\'s relative order within each group', () => {
    const rows = [
      { playerId: 'a' },
      { playerId: 'mine2' },
      { playerId: 'b' },
      { playerId: 'mine1' },
      { playerId: 'c' },
    ]
    const { ordered } = orderByRosterRelevance(rows, mine)
    expect((ordered as Array<{ playerId: string }>).map((r) => r.playerId)).toEqual([
      'mine2',
      'mine1',
      'a',
      'b',
      'c',
    ])
  })

  it('🛑 never drops or dedupes a row — the hidden count stays exact', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ playerId: i < 3 ? 'mine1' : `other${i}` }))
    const { ordered } = orderByRosterRelevance(rows, mine)
    expect(ordered).toHaveLength(50)
  })

  it('no roster is a no-op — the list comes back untouched', () => {
    const rows = [{ playerId: 'a' }, { playerId: 'b' }]
    const { ordered, promoted } = orderByRosterRelevance(rows, new Set())
    expect(ordered).toBe(rows)
    expect(promoted).toBe(0)
  })

  it('a roster that matches nothing is also a no-op, and claims no promotion', () => {
    const rows = [{ playerId: 'a' }, { playerId: 'b' }]
    const { ordered, promoted } = orderByRosterRelevance(rows, new Set(['nobody']))
    expect(ordered).toBe(rows)
    expect(promoted).toBe(0)
  })

  it('rows carrying no player key at all are left alone', () => {
    const rows = [{ foo: 1 }, { bar: 2 }]
    const { promoted } = orderByRosterRelevance(rows, mine)
    expect(promoted).toBe(0)
  })

  it('is deterministic across repeated calls', () => {
    const rows = [{ playerId: 'a' }, { playerId: 'mine1' }, { playerId: 'b' }]
    const first = orderByRosterRelevance(rows, mine).ordered
    const second = orderByRosterRelevance(rows, mine).ordered
    expect(first).toEqual(second)
  })
})

/**
 * 🛑 THE WIRING TEST, AND IT EXISTS BECAUSE ITS ABSENCE SHIPPED A BUG.
 *
 * The two suites above exercise the pure helpers directly, so they passed 11/11 while the
 * serializer called `rosterPlayerKeys(packet.roster)` — a property that does not exist. The
 * roster lives under `packet.contextFacts.roster`. Nothing in a helper-only suite can see
 * that; the typecheck caught it as a single TS2339 against a known 145-error baseline.
 *
 * So this asserts the path THROUGH the serializer, which is the only thing that proves the
 * feature is connected rather than merely correct in isolation.
 */
describe('R1.4 · wired into the serializer, not just correct in isolation', () => {
  it("promotes the asker's players in real prompt output", () => {
    const others = Array.from({ length: 12 }, (_, i) => ({
      playerId: `other-${i}`,
      playerName: `Other Guy ${i}`,
      position: 'WR',
      value: 100 - i,
    }))
    const text = serializeDecisionOsGroundingForPrompt(
      packetWithRoster(
        [...others, { playerId: 'p-mine', playerName: 'My Star', position: 'WR', value: 1 }],
        [{ playerId: 'p-mine', name: 'My Star' }],
      ),
    )
    expect(text).toContain('My Star')
    // …and says these are roster-scoped rather than a value ranking.
    expect(text).toContain('your own players are listed first')
  })

  it('a packet with no contextFacts still serialises, with the original wording', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      playerId: `p${i}`,
      playerName: `Player ${i}`,
      position: 'WR',
      value: 10,
    }))
    const text = serializeDecisionOsGroundingForPrompt(packetWithRoster(rows, null))
    expect(text).toContain('more not shown')
    expect(text).not.toContain('your own players are listed first')
  })
})
