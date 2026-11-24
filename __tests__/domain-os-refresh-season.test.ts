import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/core-app/playerRef', () => ({ playerRef: vi.fn() }))

/**
 * 2026-11-20 re-score: the domain-OS warm keyed the NFL projection and NCAAF devy entries on the CALENDAR year, so in
 * January and February it warmed next year's entries while every league still asked for this season's.
 */
const { currentNflSeason } = await import('@/lib/follows/followFreeAgentCheck')
const SRC = readFileSync(join(process.cwd(), 'app/api/cron/domain-os-refresh/route.ts'), 'utf8')

describe('the warm is keyed on the football season', () => {
  it('January and February belong to last season; the rest of the year to this one', () => {
    expect(currentNflSeason(new Date('2027-01-20T12:00:00Z'))).toBe(2026)
    expect(currentNflSeason(new Date('2027-02-10T12:00:00Z'))).toBe(2026)
    expect(currentNflSeason(new Date('2026-11-20T12:00:00Z'))).toBe(2026)
    expect(currentNflSeason(new Date('2027-03-01T12:00:00Z'))).toBe(2027)
  })

  it('the route uses it, not the calendar year', () => {
    expect(SRC).toMatch(/^\s*const season = currentNflSeason\(new Date\(\)\)/m)
    expect(SRC).not.toMatch(/^\s*const season = new Date\(\)\.getUTCFullYear\(\)/m)
  })
})

/**
 * 2026-11-24 re-score: non-NFL projections are warmed too, from the sports `AFProjectionSnapshot` actually holds (a
 * sport with no rows is simply absent), after NFL so NFL keeps first claim on the run budget. Market is not warmed for
 * them: `loadMarketValues` answers `no_producer` for non-NFL sports without a read.
 */
describe('non-NFL projections are warmed', () => {
  it('the set comes from the snapshot table, excluding NFL, at each sport\'s newest season', () => {
    expect(SRC).toMatch(/aFProjectionSnapshot\s*\.groupBy\(\{ by: \['sport'\], where: \{ sport: \{ not: 'NFL' \} \}, _max: \{ season: true \} \}\)/)
  })

  it('each is a projection unit, after the NFL one, and stops on the same budget', () => {
    const nfl = SRC.indexOf("label: `projection:NFL:${season}`")
    const other = SRC.indexOf('label: `projection:${p.sport}:${p.season}`')
    expect(nfl).toBeGreaterThan(0)
    expect(other).toBeGreaterThan(nfl)
    expect(SRC).toContain('projectionOs.refresh(canonicalProjectionSource, { sport: p.sport, season: p.season })')
    expect(SRC).toMatch(/if \(budget\.exhausted\(\)\) \{ counts\.skippedForTime \+= 1; continue \}/)
  })
})
