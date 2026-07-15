import { describe, it, expect, vi } from 'vitest'

/**
 * Regression coverage for Opponent Behavior / Compare grades
 * (AF_DATA_PROVENANCE_AUDIT.md demo risk #2).
 *
 * Grades/winner/margin were once raw GPT-4o output (non-reproducible). They are now computed
 * deterministically from real league stats and FORCED onto the LLM output server-side; the LLM
 * only contributes narrative. These tests certify the two pure functions behind that: the
 * disclosed weights (champ 35 / win% 25 / playoff 25 / longevity 15) and the grade boundaries,
 * plus that identical inputs always produce identical grades.
 */

// Compare route builds an OpenAI client at module load (line 17) + a telemetry-wrapped POST.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: vi.fn(() => (h: unknown) => h) }))
vi.mock('@/lib/ai/openai-route-client', () => ({ getOpenAIRouteClient: vi.fn(() => ({})) }))

import { computeWeightedScore, scoreToGrade } from '@/server/api-route-modules/legacy/compare/route'

describe('computeWeightedScore (provenance #2 — disclosed weights)', () => {
  it('applies champ 35 / win% 25 / playoff 25 / longevity 15 exactly', () => {
    // winPct 75, championshipRate 25, playoffRate 50, longevity 100
    // => 25*.35 + 75*.25 + 50*.25 + 100*.15 = 8.75 + 18.75 + 12.5 + 15 = 55.0
    const score = computeWeightedScore({ wins: 30, losses: 10, championships: 2, playoffs: 4, leagues: 8 })
    expect(score).toBeCloseTo(55.0, 10)
  })

  it('rewards a dominant manager proportionally to the weights', () => {
    // winPct 90, championshipRate 62.5, playoffRate 100, longevity 100
    // => 62.5*.35 + 90*.25 + 100*.25 + 100*.15 = 21.875 + 22.5 + 25 + 15 = 84.375
    const score = computeWeightedScore({ wins: 90, losses: 10, championships: 5, playoffs: 8, leagues: 8 })
    expect(score).toBeCloseTo(84.375, 10)
  })

  it('returns 0 for a manager with no leagues (avoids divide-by-zero)', () => {
    expect(computeWeightedScore({ wins: 0, losses: 0, championships: 0, playoffs: 0, leagues: 0 })).toBe(0)
  })

  it('caps longevity credit at 8 leagues', () => {
    const eight = computeWeightedScore({ wins: 0, losses: 0, championships: 0, playoffs: 0, leagues: 8 })
    const twenty = computeWeightedScore({ wins: 0, losses: 0, championships: 0, playoffs: 0, leagues: 20 })
    // With only longevity contributing, 8 leagues already earns the full 15 points, so 20 caps equal.
    expect(eight).toBeCloseTo(15, 10)
    expect(twenty).toBeCloseTo(15, 10)
  })
})

describe('scoreToGrade (provenance #2 — grade boundaries)', () => {
  const cases: Array<[number, string]> = [
    [100, 'A+'], [97, 'A+'],
    [96.9, 'A'], [93, 'A'],
    [92.9, 'A-'], [90, 'A-'],
    [89, 'B+'], [87, 'B+'],
    [86, 'B'], [83, 'B'],
    [82, 'B-'], [80, 'B-'],
    [79, 'C+'], [77, 'C+'],
    [76, 'C'], [73, 'C'],
    [72, 'C-'], [70, 'C-'],
    [69, 'D'], [60, 'D'],
    [59, 'F'], [0, 'F'],
  ]
  it.each(cases)('maps score %d -> grade %s', (score, grade) => {
    expect(scoreToGrade(score)).toBe(grade)
  })
})

describe('determinism (provenance #2 — same input, same grade)', () => {
  it('produces byte-identical score + grade across repeat runs on the same stats', () => {
    const stats = { wins: 44, losses: 28, championships: 1, playoffs: 3, leagues: 6 }
    const run = () => {
      const s = computeWeightedScore(stats)
      return { score: s, grade: scoreToGrade(s) }
    }
    const a = run()
    const b = run()
    const c = run()
    expect(a).toEqual(b)
    expect(b).toEqual(c)
    // sanity: the grade is a real letter derived from the score, not an empty/echoed value
    expect(a.grade).toMatch(/^[A-F][+-]?$/)
    expect(scoreToGrade(a.score)).toBe(a.grade)
  })
})
