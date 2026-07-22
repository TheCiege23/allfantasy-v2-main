import { describe, expect, it } from 'vitest'
import {
  buildRunEvidence,
  buildTradeValuationEvidence,
  createDerivedFieldTracker,
} from '@/lib/legacy/intelligenceEvidence'

describe('buildTradeValuationEvidence — trade analyze honesty', () => {
  it('classifies an unknown player as fallback, never observed', () => {
    const result = buildTradeValuationEvidence({
      sideAPlayers: [{ name: 'Ja\'Marr Chase', value: 9500, found: true }],
      sideBPlayers: [{ name: 'Obscure Rookie', value: 200, found: false }],
      unknownPlayers: ['Obscure Rookie'],
    })
    const unknown = result.players.find((p) => p.name === 'Obscure Rookie')
    expect(unknown?.provenance).toBe('fallback')
    expect(result.players.find((p) => p.name === "Ja'Marr Chase")?.provenance).toBe('observed')
  })

  it('adds fallback-valued players to missingInputs and lowers confidence', () => {
    const result = buildTradeValuationEvidence({
      sideAPlayers: [
        { name: 'Player A', value: 200, found: false },
        { name: 'Player B', value: 200, found: false },
      ],
      sideBPlayers: [{ name: 'Player C', value: 5000, found: true }],
    })
    expect(result.evidence.missingInputs).toContain('market value for Player A')
    expect(result.evidence.missingInputs).toContain('market value for Player B')
    expect(result.evidence.confidence).toBe('low')
    expect(result.evidence.disclaimer).toMatch(/no market value/i)
    expect(result.fallbackCount).toBe(2)
    expect(result.coveragePercent).toBe(33)
  })

  it('reports high confidence with no disclaimer when every valuation is observed', () => {
    const result = buildTradeValuationEvidence({
      sideAPlayers: [{ name: 'A', value: 4000, found: true }],
      sideBPlayers: [{ name: 'B', value: 3900, found: true }],
    })
    expect(result.evidence.confidence).toBe('high')
    expect(result.evidence.disclaimer).toBeUndefined()
    expect(result.evidence.missingInputs).toEqual([])
    expect(result.coveragePercent).toBe(100)
  })

  it('classifies scarcity-adjusted market values as derived, not observed', () => {
    const result = buildTradeValuationEvidence({
      sideAPlayers: [{ name: 'A', value: 4400, found: true }],
      sideBPlayers: [{ name: 'B', value: 200, found: false }],
      foundValuesAdjusted: true,
    })
    expect(result.players.find((p) => p.name === 'A')?.provenance).toBe('derived')
    expect(result.players.find((p) => p.name === 'B')?.provenance).toBe('fallback')
  })

  it('picks are always labeled derived (curve-based, never a provider quote)', () => {
    const result = buildTradeValuationEvidence({ sideAPlayers: [], sideBPlayers: [] })
    expect(result.picksProvenance).toBe('derived')
    expect(result.evidence.confidence).toBe('unknown')
    expect(result.coveragePercent).toBeNull()
  })

  it('duplicate player names cannot inflate coverage (client-supplied assets)', () => {
    const result = buildTradeValuationEvidence({
      sideAPlayers: [
        { name: 'Repeat Guy', value: 5000, found: true },
        { name: 'repeat guy', value: 5000, found: true },
        { name: 'Repeat Guy ', value: 5000, found: true },
      ],
      sideBPlayers: [{ name: 'Unknown', value: 200, found: false }],
    })
    expect(result.players.filter((p) => p.side === 'A')).toHaveLength(1)
    expect(result.marketBackedCount).toBe(1)
    expect(result.coveragePercent).toBe(50)
    expect(result.evidence.confidence).toBe('low')
  })

  it('the same name on BOTH sides is legitimate and kept (side-scoped dedupe)', () => {
    const result = buildTradeValuationEvidence({
      sideAPlayers: [{ name: 'Pivot Player', value: 4000, found: true }],
      sideBPlayers: [{ name: 'Pivot Player', value: 4000, found: true }],
    })
    expect(result.players).toHaveLength(2)
  })

  it('one unknown among many known players yields medium, not high, confidence', () => {
    const known = Array.from({ length: 5 }, (_, i) => ({ name: `K${i}`, value: 3000, found: true }))
    const result = buildTradeValuationEvidence({
      sideAPlayers: known,
      sideBPlayers: [{ name: 'Unknown', value: 200, found: false }],
    })
    expect(result.evidence.confidence).toBe('medium')
  })
})

describe('createDerivedFieldTracker — ai/run synthesized fields', () => {
  it('records a synthesized numeric field and clamps the fallback', () => {
    const tracker = createDerivedFieldTracker()
    const value = tracker.bounded('rating', undefined, 0, 100, 150)
    expect(value).toBe(100)
    expect(tracker.fields()).toContain('rating')
  })

  it('does not record a field the model actually returned', () => {
    const tracker = createDerivedFieldTracker()
    const value = tracker.bounded('rating', 87, 0, 100, 50)
    expect(value).toBe(87)
    expect(tracker.fields()).toEqual([])
  })

  it('records synthesized text fields but not model-provided ones', () => {
    const tracker = createDerivedFieldTracker()
    expect(tracker.text('title', '  ', 'Fallback Title')).toBe('Fallback Title')
    expect(tracker.text('archetype', 'Contrarian', 'Balanced')).toBe('Contrarian')
    expect(tracker.fields()).toEqual(['title'])
  })
})

describe('buildRunEvidence — ai/run evidence from the audit object', () => {
  const fullAudit = { partialData: false, sourcesUsed: ['sleeper_history', 'league_settings'], missingSources: [] }

  it('caps confidence at medium when core scores were synthesized on full data', () => {
    const evidence = buildRunEvidence({ audit: fullAudit, derivedFields: ['rating', 'title'] })
    expect(evidence.confidence).toBe('medium')
    expect(evidence.missingInputs).toContain('model output for rating')
    expect(evidence.disclaimer).toMatch(/derived from win-rate formulas/i)
  })

  it('is low confidence when core scores were synthesized AND data was partial', () => {
    const evidence = buildRunEvidence({
      audit: { partialData: true, sourcesUsed: ['sleeper_history'], missingSources: ['fantasycalc'] },
      derivedFields: ['power_index_breakdown.roster_value'],
    })
    expect(evidence.confidence).toBe('low')
    expect(evidence.missingInputs).toContain('fantasycalc')
  })

  it('is high confidence when nothing core was synthesized and data was complete', () => {
    const evidence = buildRunEvidence({ audit: fullAudit, derivedFields: ['share_text'] })
    expect(evidence.confidence).toBe('high')
    expect(evidence.disclaimer).toBeUndefined()
    expect(evidence.basedOn).toEqual(['sleeper_history', 'league_settings'])
  })

  it('tolerates an empty/missing-ish audit object without throwing', () => {
    const evidence = buildRunEvidence({
      audit: { partialData: false, sourcesUsed: [], missingSources: [] },
      derivedFields: [],
    })
    expect(evidence.confidence).toBe('high')
    expect(evidence.missingInputs).toEqual([])
  })
})
