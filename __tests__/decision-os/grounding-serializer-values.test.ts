import { describe, it, expect } from 'vitest'

import { serializeDecisionOsGroundingForPrompt } from '@/lib/decision-os/grounding/serialize'
import type { DecisionOsGroundingPacket, GroundedSlice } from '@/lib/decision-os/grounding/packet'
import type { ValueLookup } from '@/lib/decision-os/value/contract'
import type { ProjectionFact } from '@/lib/decision-os/projection/facts'

/**
 * ── 🛑 THE PACKET ASSEMBLED FACTS AND THE SERIALIZER THREW THEM AWAY (G11) ──────────────────
 *
 * `sliceLine()` rendered `- Market player values: available (4 hours old)` and never read
 * `slice.value` — zero occurrences of it in the whole file. So a packet that spent ~1.7s
 * gathering `ValueLookup[]`, `ProjectionFact[]` and three-brain's saved conclusion handed the
 * model ten lines of adjectives.
 *
 * ⚠ AND NOTHING CAUGHT IT, WHICH IS WHY THIS FILE EXISTS. Every existing serializer test asserts
 * on the GAPS half — the hard half, and the half that was written correctly. A serializer that
 * renders no values at all passes all of them. These tests assert the assertion half.
 *
 * ⚠ THE GAPS HALF IS DELIBERATELY RE-ASSERTED HERE TOO. It was correct before this change and
 * must stay correct through it: the whole point of the packet is that "I cannot tell you" and
 * "here is the number" are both first-class, and a fix to one must not quietly cost the other.
 */

const NOW = Date.parse('2026-09-02T12:00:00.000Z')

function present<T>(value: T, over: Partial<GroundedSlice<T>> = {}): GroundedSlice<T> {
  return {
    present: true,
    value,
    asOf: '2026-09-02T08:00:00.000Z',
    servedFrom: 'store',
    confidence: null,
    conclusive: { ok: true },
    gap: null,
    ...over,
  } as GroundedSlice<T>
}

function absent<T>(reason: string, detail = 'gone', remedy = 'do the thing'): GroundedSlice<T> {
  return {
    present: false,
    value: null,
    asOf: null,
    servedFrom: null,
    confidence: null,
    conclusive: { ok: true },
    gap: { reason, detail, remedy },
  } as unknown as GroundedSlice<T>
}

function marketValue(playerName: string, value: number, overallRank: number): ValueLookup {
  return {
    status: 'ok',
    value: {
      playerId: `pid-${playerName.replace(/\s+/g, '-').toLowerCase()}`,
      idSpace: 'sleeperId',
      sourceId: '8891',
      sport: 'NFL',
      value,
      unit: 'market_units',
      basis: 'market',
      scope: 'global',
      overallRank,
      playerName,
      position: 'WR',
      asOf: '2026-09-02T06:00:00.000Z',
      sourceModule: 'test',
    },
  } as ValueLookup
}

function projection(playerName: string, points: number): ProjectionFact {
  return {
    playerId: `pid-${playerName}`,
    playerName,
    sport: 'NFL',
    position: 'WR',
    season: 2026,
    week: 3,
    points,
    storedPoints: points,
    rescored: false,
    storedPreset: null,
    computedAt: '2026-09-02T06:00:00.000Z',
  } as unknown as ProjectionFact
}

function packet(over: Partial<DecisionOsGroundingPacket> = {}): DecisionOsGroundingPacket {
  return {
    leagueId: 'L1',
    userId: 'U1',
    builtAt: '2026-09-02T12:00:00.000Z',
    importAssertions: absent('not_requested'),
    leagueRules: absent('not_requested'),
    marketValues: absent('not_requested'),
    devyValues: absent('not_requested'),
    projections: absent('not_requested'),
    contextFacts: null,
    contextLookups: null,
    commissionerIntelligence: absent('not_requested'),
    leagueIntelligence: absent('not_requested'),
    portfolio: absent('not_requested'),
    savedAnalysis: absent('not_requested'),
    managerPsychology: absent('not_requested'),
    gaps: [],
    meta: { durationMs: 1, engineMs: null, sources: [], killedFeeds: [] },
    ...over,
  } as DecisionOsGroundingPacket
}

describe('the serializer says WHAT it knows, not merely THAT it knows', () => {
  it('renders a market value with the PLAYER NAME, not an opaque id', () => {
    // 🛑 The id is useless in a prompt. `CanonicalValue` carried no name at all until this change,
    // even though all three adapters read one from the DB and discarded it — marketAdapter reads
    // `name` for its identity `nameHint` and drops it one line later.
    const text = serializeDecisionOsGroundingForPrompt(
      packet({ marketValues: present([marketValue('Malik Nabers', 6420, 12)]) }),
      NOW,
    )
    expect(text).toContain('Malik Nabers')
    expect(text).toContain('6420')
    expect(text).not.toContain('pid-malik-nabers')
  })

  it('renders projections with names and points', () => {
    const text = serializeDecisionOsGroundingForPrompt(
      packet({ projections: present([projection('Malik Nabers', 14.8)]) }),
      NOW,
    )
    expect(text).toContain('Malik Nabers')
    expect(text).toContain('14.8')
  })

  it('emits the four prose slices VERBATIM — they are already prompt-ready', () => {
    // These are GroundedSlice<string>. `sliceLine` reduced each to the word "available", which is
    // what silenced three-brain's saved conclusion — the entire substance of plan item 6.2.
    const text = serializeDecisionOsGroundingForPrompt(
      packet({
        savedAnalysis: present('Answer: hold. Model agreement: unanimous.'),
        leagueIntelligence: present('This league trades heavily in-season.'),
      }),
      NOW,
    )
    expect(text).toContain('Answer: hold. Model agreement: unanimous.')
    expect(text).toContain('This league trades heavily in-season.')
  })

  it('BOUNDS a large board and says how many it hid', () => {
    // ⚠ marketAdapter takes up to 2,000 rows and `rankings` carries ~400 leagues. Rendering a
    // collection raw would blow the context window and recreate the latency problem in tokens.
    const many = Array.from({ length: 200 }, (_, i) => marketValue(`Player ${i}`, 1000 - i, i + 1))
    const text = serializeDecisionOsGroundingForPrompt(packet({ marketValues: present(many) }), NOW)
    expect(text).toContain('Player 0')
    expect(text).not.toContain('Player 199')
    expect(text).toMatch(/more not shown/i)
  })

  it('renders the value of a PRESENT-BUT-INCONCLUSIVE slice, and keeps the warning', () => {
    // 🛑 Dropping true information to punish a stale import is the failure the packet's own roster
    // comment warns about. The number is real; the caveat travels with it.
    const text = serializeDecisionOsGroundingForPrompt(
      packet({
        projections: present([projection('Malik Nabers', 14.8)], {
          conclusive: { ok: false, blockers: [] } as never,
        }),
      }),
      NOW,
    )
    expect(text).toContain('Malik Nabers')
    expect(text).toMatch(/NOT SAFE TO ACT ON/i)
  })

  it('still renders gaps with reason and remedy — the half that was already right', () => {
    const text = serializeDecisionOsGroundingForPrompt(
      packet({
        gaps: [{ slice: 'projections', reason: 'not_computed', detail: 'None held.', remedy: 'They compute daily.' }],
      } as never),
      NOW,
    )
    expect(text).toContain('WHAT IS MISSING, AND WHY')
    expect(text).toContain('None held.')
    expect(text).toContain('They compute daily.')
  })

  it('is PURE — same packet, same string', () => {
    // The file's header promises no IO and no clock, so what the model is told is assertable in a
    // test rather than inspected in a log. A rendering that reaches for Date.now() breaks that.
    const p = packet({ marketValues: present([marketValue('Malik Nabers', 6420, 12)]) })
    expect(serializeDecisionOsGroundingForPrompt(p, NOW)).toBe(serializeDecisionOsGroundingForPrompt(p, NOW))
  })

  it('emits nothing at all when nothing was requested and nothing is missing', () => {
    expect(serializeDecisionOsGroundingForPrompt(packet(), NOW)).toBe('')
  })
})

/**
 * ── 🛑 THE ONE FUNCTION BETWEEN AN ASSEMBLED PACKET AND THE PROMPT MUST NOT THROW ────────────
 *
 * `serializeDecisionOsGroundingForPrompt` walks a FIXED list of slice names. Adding
 * `managerPsychology` to that list turned eight passing tests into TypeErrors, because their
 * fixture predated the field and `sliceLine` did a bare `s.present`.
 *
 * In production that is worse than a test failure: a packet built by an older caller, or a slice
 * added ahead of one producer, throws — and the model receives NOTHING rather than the fifteen
 * slices that were fine. An absent slice is an absent slice, not an outage.
 */
describe('a missing slice degrades, it does not throw', () => {
  it('renders every other slice when one is absent from the packet entirely', () => {
    const p = packet({ marketValues: present([marketValue('Malik Nabers', 6420, 12)]) })
    delete (p as Record<string, unknown>).managerPsychology
    delete (p as Record<string, unknown>).savedAnalysis
    const text = serializeDecisionOsGroundingForPrompt(p, NOW)
    expect(text).toContain('Malik Nabers')   // the surviving slices still render
    expect(text).toContain('6420')
  })
})
