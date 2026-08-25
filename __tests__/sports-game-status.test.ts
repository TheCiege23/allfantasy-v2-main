import { describe, expect, it } from 'vitest'
import {
  describeGameStatus,
  hasGameStarted,
  isGameCancelled,
  isGameFinished,
  normalizeGameStatus,
} from '@/lib/sports/gameStatus'

/**
 * Every value below was measured in production on 2026-08-25, with its row
 * count. If the normaliser stops handling one of these, real games change state.
 */
const PRODUCTION_VOCABULARY: Array<[string, string, number]> = [
  ['FT', 'final', 10534],
  ['scheduled', 'scheduled', 4332],
  ['final', 'final', 3564],
  ['NS', 'scheduled', 2001],
  ['AOT', 'final', 474],
  ['AP', 'final', 128],
  ['CANC', 'cancelled', 89],
  ['in_progress', 'live', 22],
  ['Final', 'final', 16],
  ['POST', 'postponed', 10],
  ['postponed', 'postponed', 8],
  ['PST', 'postponed', 6],
  ['canceled', 'cancelled', 3],
  ['Match Finished', 'final', 1],
  ['IN2', 'live', 1],
]

describe('normalizeGameStatus — the real production vocabulary', () => {
  for (const [raw, expected, rows] of PRODUCTION_VOCABULARY) {
    it(`maps ${raw} to ${expected} (${rows.toLocaleString()} rows in prod)`, () => {
      expect(normalizeGameStatus(raw)).toBe(expected)
    })
  }

  it('covers every non-null value observed in production', () => {
    const unmapped = PRODUCTION_VOCABULARY.filter(([raw]) => normalizeGameStatus(raw) === 'unknown')
    expect(unmapped).toEqual([])
  })
})

describe('normalizeGameStatus — unknowns', () => {
  /*
   * The central safety property. Both plausible defaults are harmful in opposite
   * directions, so neither is taken.
   */
  it('resolves an unrecognised value to unknown, not to a guess', () => {
    expect(normalizeGameStatus('SOMETHING_NEW')).toBe('unknown')
    expect(normalizeGameStatus('')).toBe('unknown')
    expect(normalizeGameStatus(null)).toBe('unknown')
    expect(normalizeGameStatus(undefined)).toBe('unknown')
  })

  it('treats an unknown status as neither started nor finished', () => {
    expect(isGameFinished('SOMETHING_NEW')).toBe(false)
    expect(hasGameStarted('SOMETHING_NEW')).toBe(false)
    expect(isGameCancelled('SOMETHING_NEW')).toBe(false)
  })
})

describe('normalizeGameStatus — parsing', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(normalizeGameStatus('  ft  ')).toBe('final')
    expect(normalizeGameStatus('FINAL')).toBe('final')
    expect(normalizeGameStatus('Postponed')).toBe('postponed')
  })

  /* api-sports encodes the period in the code, so the family must be matched. */
  it('recognises period-coded live statuses it has never seen', () => {
    for (const code of ['1H', '2H', 'Q1', 'Q4', 'P3', 'IN1', 'IN9', 'OT1']) {
      expect(normalizeGameStatus(code)).toBe('live')
    }
  })

  it('handles the end-after-regulation codes as finished', () => {
    for (const code of ['AOT', 'AP', 'AET', 'PEN']) {
      expect(normalizeGameStatus(code)).toBe('final')
    }
  })
})

describe('the predicates callers actually use', () => {
  it('isGameFinished is true only for finished games', () => {
    expect(isGameFinished('FT')).toBe(true)
    expect(isGameFinished('AOT')).toBe(true)
    expect(isGameFinished('in_progress')).toBe(false)
    expect(isGameFinished('NS')).toBe(false)
    expect(isGameFinished('CANC')).toBe(false)
  })

  it('hasGameStarted covers live and finished, nothing else', () => {
    expect(hasGameStarted('IN2')).toBe(true)
    expect(hasGameStarted('FT')).toBe(true)
    expect(hasGameStarted('scheduled')).toBe(false)
    expect(hasGameStarted('POST')).toBe(false)
  })

  it('a postponed game has neither started nor been cancelled', () => {
    expect(hasGameStarted('POST')).toBe(false)
    expect(isGameCancelled('POST')).toBe(false)
    expect(normalizeGameStatus('POST')).toBe('postponed')
  })

  it('describes each state in words a prompt can use', () => {
    expect(describeGameStatus('FT')).toBe('final')
    expect(describeGameStatus('IN2')).toBe('in progress')
    expect(describeGameStatus('NS')).toBe('not started')
    expect(describeGameStatus('WHAT')).toBe('status unknown')
  })
})


/*
 * The cadence engine keeps its own richer vocabulary (halftime, overtime,
 * suspended) but now defers to the shared reader for anything its table misses.
 * These five were missing and fell through to `scheduled` — 234 production rows
 * the poller believed had not kicked off.
 */
describe('live-scoring cadence no longer mis-reads real statuses as scheduled', () => {
  const PREVIOUSLY_MISSED: Array<[string, string, number]> = [
    ['AP', 'final', 128],
    ['CANC', 'postponed', 89],
    ['POST', 'postponed', 10],
    ['PST', 'postponed', 6],
    ['IN2', 'in_progress', 1],
  ]

  for (const [raw, expected, rows] of PREVIOUSLY_MISSED) {
    it(`reads ${raw} as ${expected}, not scheduled (${rows} rows in prod)`, async () => {
      const { normalizeLiveGameStatus } = await import('@/lib/live-scoring/cadence')
      expect(normalizeLiveGameStatus(raw)).toBe(expected)
    })
  }

  it('still honours its own richer states', async () => {
    const { normalizeLiveGameStatus } = await import('@/lib/live-scoring/cadence')
    expect(normalizeLiveGameStatus('HT')).toBe('halftime')
    expect(normalizeLiveGameStatus('OT')).toBe('overtime')
    expect(normalizeLiveGameStatus('suspended')).toBe('suspended')
    expect(normalizeLiveGameStatus('AOT')).toBe('final')
  })

  /*
   * Deliberately different from the decision path: a poller erring toward one
   * more poll is safe, a lineup call assuming "not started" is not.
   */
  it('keeps its conservative scheduled fallback for a truly unknown value', async () => {
    const { normalizeLiveGameStatus } = await import('@/lib/live-scoring/cadence')
    expect(normalizeLiveGameStatus('SOMETHING_NEW')).toBe('scheduled')
    expect(normalizeGameStatus('SOMETHING_NEW')).toBe('unknown')
  })
})
