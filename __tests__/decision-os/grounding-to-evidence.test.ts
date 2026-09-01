import { describe, it, expect } from 'vitest'

import { groundingPacketToEvidence } from '@/lib/decision-os/grounding/toEvidencePacket'
import type { DecisionOsGroundingPacket, GroundedSlice } from '@/lib/decision-os/grounding/packet'
import type { ImportAssertions } from '@/lib/decision-os/import/assertions'

/**
 * 6.2 — the grounding packet becomes evidence three-brain can reason over.
 *
 * ── 🛑 THE TARGET IS "MINIMIZED" EVIDENCE AND IT GOES TO ANTHROPIC ──────────────────────────
 * `DecisionOSEvidencePacket` is documented as "the verified, MINIMIZED evidence supplied to the
 * models". The grounding packet holds whole projection arrays and rosters. The single most
 * important assertion here is that a 500-row slice does not become 500 rows in a prompt.
 */

const NOW = Date.parse('2026-09-01T12:00:00.000Z')
const HOUR = 3_600_000

function present<T>(value: T, over: Partial<GroundedSlice<T>> = {}): GroundedSlice<T> {
  return {
    present: true,
    value,
    asOf: new Date(NOW - HOUR).toISOString(),
    servedFrom: 'store',
    confidence: null,
    conclusive: { ok: true },
    gap: null,
    ...over,
  }
}

function absent<T>(reason: string, detail: string, remedy: string): GroundedSlice<T> {
  return {
    present: false,
    value: null,
    asOf: null,
    servedFrom: null,
    confidence: null,
    conclusive: { ok: true },
    gap: { reason: reason as never, detail, remedy },
  }
}

function assertions(over: Partial<ImportAssertions> = {}): ImportAssertions {
  return {
    leagueId: 'lg1', provider: 'sleeper', externalLeagueId: 'x', season: 2026,
    lastAttemptedSyncAt: new Date(NOW - HOUR).toISOString(),
    lastSuccessfulSyncAt: new Date(NOW - HOUR).toISOString(),
    staleMs: HOUR, syncStatus: 'completed', consecutiveFailures: 0,
    scopes: [], parity: 'matched', parityNote: null,
    rosterCoverage: 1, rostersHeld: 12, rostersExpected: 12,
    managerIdentityCoverage: 1, managersMapped: 12, managersTotal: 12,
    ...over,
  }
}

function packet(over: Partial<DecisionOsGroundingPacket> = {}): DecisionOsGroundingPacket {
  const base: DecisionOsGroundingPacket = {
    leagueId: 'lg1',
    userId: 'u1',
    builtAt: new Date(NOW).toISOString(),
    importAssertions: present(assertions()),
    leagueRules: present({ scoring: {} }),
    marketValues: present(Array.from({ length: 500 }, (_, i) => ({ playerId: `p${i}` }))) as never,
    devyValues: absent('no_producer', 'No devy model for NFL.', 'Nothing to fix.') as never,
    projections: present(Array.from({ length: 312 }, (_, i) => ({ playerId: `p${i}` }))) as never,
    contextFacts: null,
    contextLookups: null,
    commissionerIntelligence: present('Two managers have not set a lineup in three weeks.'),
    leagueIntelligence: absent('not_computed', 'No brief could be built.', 'Needs recorded activity.'),
    portfolio: present('Three leagues, one contending.'),
    gaps: [
      { slice: 'devyValues', reason: 'no_producer', detail: 'No devy model for NFL.', remedy: 'Nothing to fix.' },
      { slice: 'leagueIntelligence', reason: 'not_computed', detail: 'No brief could be built.', remedy: 'Needs recorded activity.' },
    ],
    meta: {
      durationMs: 120,
      sources: [
        { slice: 'projections', servedFrom: 'store', ok: true },
        { slice: 'devyValues', servedFrom: null, ok: false },
      ],
      killedFeeds: [],
    },
  }
  return { ...base, ...over }
}

const ARGS = { sport: 'NFL', season: 2026, decisionType: 'lineup', now: NOW }

describe('size — the reason this is an adapter and not a spread', () => {
  it('🛑 a 500-row slice becomes a COUNT, not 500 rows', () => {
    const ev = groundingPacketToEvidence(packet(), ARGS)
    const market = ev.relevantFacts.find((f) => f.label === 'marketValues')

    expect(market?.value).toMatch(/^500 rows/)
    // The assertion that actually protects the prompt: no fact carries serialized objects.
    for (const f of ev.relevantFacts) {
      expect(f.value.length).toBeLessThan(500)
      expect(f.value).not.toContain('playerId')
    }
  })

  it('keeps prose slices readable, because those are the ones worth reading verbatim', () => {
    const ev = groundingPacketToEvidence(packet(), ARGS)
    expect(ev.relevantFacts.find((f) => f.label === 'commissionerIntelligence')?.value).toContain(
      'have not set a lineup',
    )
  })

  it('carries each fact’s age, so a model is never handed an undated number', () => {
    const ev = groundingPacketToEvidence(packet(), ARGS)
    expect(ev.relevantFacts.find((f) => f.label === 'projections')?.value).toMatch(/312 rows \(1h old\)/)
  })
})

describe('absence — a gap keeps its reason AND its remedy', () => {
  it('an absent slice is missingInformation, never a fact', () => {
    const ev = groundingPacketToEvidence(packet(), ARGS)
    expect(ev.relevantFacts.map((f) => f.label)).not.toContain('devyValues')
    expect(ev.relevantFacts.map((f) => f.label)).not.toContain('leagueIntelligence')
  })

  it('🛑 the remedy survives, even though the target type has no field for it', () => {
    // "I can't tell you that" is a dead end; the remedy is the half that makes it an answer.
    // DecisionOSEvidencePacket only has string[] here, so it is flattened rather than dropped.
    const ev = groundingPacketToEvidence(packet(), ARGS)
    expect(ev.missingInformation).toContain(
      'devyValues: No devy model for NFL. (no_producer) Fix: Nothing to fix.',
    )
    for (const m of ev.missingInformation) expect(m).toContain('Fix:')
  })

  it('does not report the same absence twice, stripped of why', () => {
    const ev = groundingPacketToEvidence(packet(), ARGS)
    const factLabels = new Set(ev.relevantFacts.map((f) => f.label))
    for (const m of ev.missingInformation) {
      expect(factLabels.has(m.split(':')[0]!)).toBe(false)
    }
  })
})

describe('present but not safe to act on', () => {
  it('🛑 becomes a SIGNAL — the most useful thing this packet knows', () => {
    const p = packet({
      projections: present(Array.from({ length: 10 }, () => ({})), {
        conclusive: { ok: false, blockedBy: [{ detail: 'League has not synced in 2 days.', remedy: 'Re-sync.' } as never] },
        gap: { reason: 'not_synced', detail: 'League has not synced in 2 days.', remedy: 'Re-sync.' },
      }) as never,
    })

    const ev = groundingPacketToEvidence(p, ARGS)
    const sig = ev.deterministicSignals.find((s) => s.summary.includes('projections'))

    expect(sig?.kind).toBe('not_safe_to_act_on')
    expect(sig?.severity).toBe('warning')
    expect(sig?.summary).toContain('has not synced')
    // Still a fact — we DO have the numbers. Dropping it would hide data the user can read.
    expect(ev.relevantFacts.map((f) => f.label)).toContain('projections')
  })
})

describe('freshness comes from the league, not a clock', () => {
  it('fresh when the import is recent', () => {
    expect(groundingPacketToEvidence(packet(), ARGS).freshness.state).toBe('fresh')
  })

  it('aging, then stale, as the import ages', () => {
    const at = (staleMs: number) =>
      groundingPacketToEvidence(packet({ importAssertions: present(assertions({ staleMs })) }), ARGS).freshness.state
    expect(at(3 * HOUR)).toBe('aging')
    expect(at(40 * HOUR)).toBe('stale')
  })

  it('🛑 UNKNOWN — not fresh — when there are no assertions at all', () => {
    // A native AllFantasy league has none, and neither does one that has never synced. Reporting
    // either as fresh is exactly the fabrication the grounding packet exists to prevent.
    const p = packet({ importAssertions: absent('not_computed', 'No import state.', 'A sync creates it.') as never })
    expect(groundingPacketToEvidence(p, ARGS).freshness.state).toBe('unknown')
  })
})

describe('provider status and scope', () => {
  it('⚠ reports an operator-killed feed even though it raises no gap', () => {
    const p = packet({ meta: { ...packet().meta, killedFeeds: ['devyValues'] } })
    const ev = groundingPacketToEvidence(p, ARGS)
    const killed = ev.providerStatus.find((s) => s.note === 'disabled by operator')
    expect(killed).toMatchObject({ provider: 'devyValues', ok: false })
  })

  it('takes league scope from the packet, so caller and packet cannot disagree', () => {
    expect(groundingPacketToEvidence(packet(), ARGS).mode).toBe('league')
    expect(groundingPacketToEvidence(packet({ leagueId: null }), ARGS).mode).toBe('global')
  })

  it('produces a fingerprint and a stable id per fact, via the canonical builder', () => {
    const ev = groundingPacketToEvidence(packet(), ARGS)
    expect(ev.evidenceFingerprint).toBeTruthy()
    expect(ev.schemaVersion).toBe('1')
    expect(new Set(ev.relevantFacts.map((f) => f.id)).size).toBe(ev.relevantFacts.length)
  })

  it('is deterministic — same packet in, same fingerprint out', () => {
    const a = groundingPacketToEvidence(packet(), { ...ARGS, requestId: 'fixed' })
    const b = groundingPacketToEvidence(packet(), { ...ARGS, requestId: 'fixed' })
    expect(a.evidenceFingerprint).toBe(b.evidenceFingerprint)
  })
})
