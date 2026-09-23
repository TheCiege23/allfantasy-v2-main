import { describe, expect, it } from 'vitest'
import {
  buildChimmyAnswerContract,
  capConfidenceLevelToShownPct,
  type ChimmyConfidenceBlock,
} from '@/lib/chimmy-chat/response-contract'
import { liftGroundingText } from '@/lib/ai-orchestration/orchestration-service'

const block = (level: ChimmyConfidenceBlock['level']): ChimmyConfidenceBlock => ({
  level,
  rationale: 'r',
  freshness: 'fresh',
  basedOn: [],
  missing: [],
  leagueContext: 'available',
})

describe('confidence label never claims more than the percent shown beside it', () => {
  it('caps HIGH to LOW when the shown percent is 26 (the production "HIGH CONFIDENCE · 26%")', () => {
    expect(capConfidenceLevelToShownPct(block('high'), 26).level).toBe('low')
  })

  it('caps HIGH to MEDIUM inside the medium band', () => {
    expect(capConfidenceLevelToShownPct(block('high'), 70).level).toBe('medium')
  })

  it('never RAISES a level', () => {
    expect(capConfidenceLevelToShownPct(block('low'), 95).level).toBe('low')
    expect(capConfidenceLevelToShownPct(block('medium'), 95).level).toBe('medium')
  })

  it('leaves the block alone when no percent is shown', () => {
    const b = block('high')
    expect(capConfidenceLevelToShownPct(b, null)).toBe(b)
    expect(capConfidenceLevelToShownPct(b, undefined)).toBe(b)
    expect(capConfidenceLevelToShownPct(b, Number.NaN)).toBe(b)
  })

  it('is applied by buildChimmyAnswerContract — a rich answer with a 26% model number is not HIGH', () => {
    const { contract } = buildChimmyAnswerContract({
      message: 'Should I start Justin Jefferson this week?',
      confidencePct: 26,
      hasLeagueContext: true,
      dataSources: ['a', 'b', 'c', 'd', 'e', 'f'],
      sourceLinks: [{ label: 'League', href: '/league/x' }],
      responseStructure: {
        shortAnswer: 'Start him.',
        whatDataSays: 'Data.',
        whatItMeans: 'Meaning.',
        recommendedAction: 'Start.',
        caveats: ['c1'],
      },
    } as Parameters<typeof buildChimmyAnswerContract>[0])
    expect(contract.confidence.level).toBe('low')
  })
})

describe('the Chimmy grounding reaches the model whole, not cut at 4,000 JSON characters', () => {
  const longGrounding = Array.from({ length: 20 }, (_, i) => `BLOCK ${i}\n${'x'.repeat(900)}\nRULE ${i}: do not guess.`).join('\n\n')

  it('lifts the grounding and memory text out of the JSON payload', () => {
    const source = {
      userTemporalContext: { promptLine: 'today' },
      pecrContext: { intent: 'trade', legacyEnrichmentContext: longGrounding, legacyMemorySection: 'mem', enrichmentLoaded: true },
    }
    const { payload, grounding, memory } = liftGroundingText(source)
    expect(grounding).toBe(longGrounding)
    expect(grounding).toContain('RULE 19: do not guess.')
    expect(memory).toBe('mem')
    expect(JSON.stringify(payload)).not.toContain('BLOCK 0')
    expect((payload.pecrContext as Record<string, unknown>).intent).toBe('trade')
    // The caller's object is untouched.
    expect((source.pecrContext as Record<string, unknown>).legacyEnrichmentContext).toBe(longGrounding)
  })

  it('is a no-op without pecrContext text', () => {
    const source = { a: 1 }
    expect(liftGroundingText(source)).toEqual({ payload: source, grounding: null, memory: null })
    const empty = { pecrContext: { legacyEnrichmentContext: '   ' } }
    expect(liftGroundingText(empty).payload).toBe(empty)
  })
})
