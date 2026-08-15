import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Chimmy was handed 108-day-old injury designations with no dates on them.
 *
 * The digest read `injury_report_records` and only fell back to the live feed if
 * that table was EMPTY. It has not been empty since April, so the fallback never
 * fired and the model presented April statuses as today's news. A fallback
 * written for absence does nothing about staleness.
 *
 * These pin the two halves of the fix: fresh rows must carry their age, and a
 * dead feed must produce a refusal rather than older data.
 */

const listInjuryFacts = vi.fn()

vi.mock('@/lib/injuries/injuryReadPort', () => ({
  listInjuryFacts: (...a: unknown[]) => listInjuryFacts(...a),
}))
vi.mock('@/lib/data/news', () => ({ getLatestNews: async () => [] }))
vi.mock('@/lib/news/newsapi-cache', () => ({ getNewsApiEverythingDbFirst: async () => ({ articles: [] }) }))
vi.mock('@/lib/prisma', () => {
  const model = new Proxy({}, { get: () => async () => [] })
  return { prisma: new Proxy({}, { get: () => model }) }
})

const fact = (over: Record<string, unknown> = {}) => ({
  playerName: 'Marcus Mariota',
  team: 'Washington Commanders',
  status: 'Questionable',
  type: 'Knee',
  description: 'Questionable For Week 1',
  date: new Date('2026-08-15'),
  week: 1,
  source: 'ri',
  fetchedAt: new Date('2026-08-15T05:45:00Z'),
  ageHours: 2,
  stale: false,
  id: 'i1',
  ...over,
})

async function digest(sport: 'NFL' | 'NCAAF' = 'NFL') {
  const { buildChimmySportDataDigest } = await import('@/lib/chimmy/chimmy-sport-data-digest')
  return buildChimmySportDataDigest({ sport, question: 'who is injured?', includeNewsApi: false })
}

beforeEach(() => {
  vi.resetModules()
  listInjuryFacts.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('fresh injuries reach Chimmy with their age attached', () => {
  it('states when each designation was reported', async () => {
    listInjuryFacts.mockResolvedValue({
      facts: [fact()],
      newestFetchedAt: new Date('2026-08-15T05:45:00Z'),
      feedStale: false,
    })
    const d = await digest()
    expect(d.text).toContain('Marcus Mariota')
    expect(d.text).toContain('Questionable')
    // Age is the whole point: without it the model cannot tell a live report
    // from a three-month-old one, and will present both as current.
    expect(d.text).toMatch(/reported \d+h ago/)
    expect(d.readiness.NFL?.hasInjuries).toBe(true)
    expect(d.readiness.NFL?.missingData).not.toContain('injuries')
  })

  it('never renders a missing designation as healthy', async () => {
    // status: null means no designation was stated. Collapsing that into
    // "healthy" is a claim about a player's availability that nobody made.
    listInjuryFacts.mockResolvedValue({
      facts: [fact({ status: null, playerName: 'Tyrell Shavers' })],
      newestFetchedAt: new Date('2026-08-15T05:45:00Z'),
      feedStale: false,
    })
    const d = await digest()
    expect(d.text).toContain('no designation stated')
    expect(d.text.toLowerCase()).not.toContain('healthy')
  })
})

describe('a stale or dead feed produces a refusal, not older data', () => {
  it('refuses when every row is past its freshness window', async () => {
    listInjuryFacts.mockResolvedValue({
      facts: [fact({ stale: true, ageHours: 2592 })],
      newestFetchedAt: new Date('2026-04-28'),
      feedStale: true,
    })
    const d = await digest()
    expect(d.text).toContain('UNAVAILABLE')
    expect(d.text).toContain('Do not state or imply')
    // The stale player must not appear at all — a caveat elsewhere in a long
    // prompt is not a reliable brake on a confident answer.
    expect(d.text).not.toContain('Marcus Mariota')
    expect(d.readiness.NFL?.hasInjuries).toBe(false)
    expect(d.readiness.NFL?.missingData).toContain('injuries')
  })

  it('refuses for a sport with no injury feed at all', async () => {
    // Measured: NCAAF has one injury row in the whole database.
    listInjuryFacts.mockResolvedValue({ facts: [], newestFetchedAt: null, feedStale: true })
    const d = await digest('NCAAF')
    expect(d.text).toContain('no live injury feed')
    expect(d.readiness.NCAAF?.hasInjuries).toBe(false)
    expect(d.readiness.NCAAF?.missingData).toContain('injuries')
  })

  it('does not read the stale injury_report_records table at all', async () => {
    // The old path is gone rather than demoted, so it cannot resurface later as
    // a "better than nothing" fallback. Asserted against imports and calls, not
    // the whole file — the comment explaining why it was removed mentions it by
    // name, and that mention is the documentation, not a regression.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('lib/chimmy/chimmy-sport-data-digest.ts', 'utf8')
    )
    expect(source).not.toMatch(/^import\s+\{[^}]*getInjuryReport/m)
    expect(source).not.toMatch(/\bgetInjuryReport\s*\(/)
  })
})
