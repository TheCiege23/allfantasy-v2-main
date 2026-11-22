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
