import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dedupeImportedLeagueRows } from '@/lib/career/dedupeImportedLeagueRows'

/**
 * 🛑 /api/user/rank read career stats with `AND platform = 'sleeper'`, so a manager whose leagues
 * came from ESPN/Yahoo/MFL/Fleaflicker/Fantrax saw an empty dashboard career while /core's career
 * page — reading the same `import_*` columns with no platform filter — showed their record.
 */
const ROUTE = readFileSync(join(process.cwd(), 'app/api/user/rank/route.ts'), 'utf8')

describe('/api/user/rank career stats read every platform', () => {
  it('the imported-league query carries no platform filter', () => {
    const q = ROUTE.slice(ROUTE.indexOf('FROM leagues'), ROUTE.indexOf('AND import_wins IS NOT NULL'))
    expect(q.length).toBeGreaterThan(0)
    expect(q).not.toMatch(/platform\s*=/)
  })

  it('dedupes the rows it reads', () => {
    expect(ROUTE).toContain('dedupeImportedLeagueRows(importedRows)')
  })
})

describe('dedupeImportedLeagueRows', () => {
  const row = (id: string, platform: string | null, platformLeagueId: string | null, season: number) => ({
    id,
    platform,
    platformLeagueId,
    season,
  })

  it('keeps one row per provider league-season, whatever the platform', () => {
    const out = dedupeImportedLeagueRows([
      row('a', 'espn', '111', 2025),
      row('b', 'ESPN', '111', 2025), // same league re-imported
      row('c', 'espn', '111', 2024), // another season: kept
      row('d', 'yahoo', '111', 2025), // same id on another provider: kept
      row('e', 'mfl', '222', 2025),
    ])
    expect(out.map((r) => r.id)).toEqual(['a', 'c', 'd', 'e'])
  })

  it('never merges rows that carry no provider id', () => {
    const out = dedupeImportedLeagueRows([row('a', 'fantrax', null, 2025), row('b', 'fantrax', ' ', 2025)])
    expect(out.map((r) => r.id)).toEqual(['a', 'b'])
  })
})
