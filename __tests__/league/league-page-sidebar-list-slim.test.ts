import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SIDEBAR_SETTINGS_KEYS, toSidebarLeague } from '@/lib/league/clientLeagueSettings'

/*
 * 🛑 The league page handed every league in the viewer's list (up to 50) to the client whole. First
 * `identity_mappings` (4.4 MB of a 5.6 MB page, Chrome froze 30+ s — #4119), then ~1 MB of scoring
 * tables and provider blobs the sidebar never reads (2026-11-23). The sidebar gets only what it reads.
 */
describe('toSidebarLeague', () => {
  const imported = {
    id: 'L1',
    name: 'Imported',
    platform: 'fantrax',
    platformLeagueId: 'abc',
    sport: 'NFL',
    isCommissioner: true,
    lifecycleState: 'in_season',
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    userId: 'someone',
    starters: Array.from({ length: 50 }, (_, i) => `p${i}`),
    settings: {
      currentWeek: 11,
      league_type: 'tournament',
      tournamentId: 't1',
      scoringSettings: { rec: 1 },
      fantrax_settings: { big: 'x'.repeat(5000) },
      identity_mappings: Array.from({ length: 500 }, (_, i) => ({ stable_key: `p${i}`, entity_type: 'player' })),
      psychologyCache: { r1: { archetype: 'x' } },
    },
  }

  it('keeps only the sidebar settings keys', () => {
    expect(toSidebarLeague(imported).settings).toEqual({ currentWeek: 11, league_type: 'tournament', tournamentId: 't1' })
  })

  it('keeps the columns the sidebar reads and drops the rest', () => {
    const out = toSidebarLeague(imported) as Record<string, unknown>
    expect(out).toMatchObject({ id: 'L1', name: 'Imported', platform: 'fantrax', platformLeagueId: 'abc', sport: 'NFL', isCommissioner: true, lifecycleState: 'in_season' })
    expect(out).not.toHaveProperty('userId')
    expect(out).not.toHaveProperty('starters')
    expect(out).not.toHaveProperty('updatedAt')
  })

  it('pins the settings keys, so a new sidebar read is a deliberate edit', () => {
    expect([...SIDEBAR_SETTINGS_KEYS]).toEqual(['currentWeek', 'current_week', 'week', 'tournamentId', 'league_type'])
  })

  it('never changes the row it was given', () => {
    toSidebarLeague(imported)
    expect(imported.settings.identity_mappings).toHaveLength(500)
    expect(imported.settings.scoringSettings).toEqual({ rec: 1 })
  })

  it('passes null settings through', () => {
    expect(toSidebarLeague({ id: 'L3', settings: null }).settings).toBeNull()
  })

  it('[control] the sidebar row is a fraction of the full one once serialized', () => {
    const full = JSON.stringify(imported).length
    const slim = JSON.stringify(toSidebarLeague(imported)).length
    expect(slim).toBeLessThan(full / 20)
  })

  it('the league page passes the sidebar rows, not the raw rows', () => {
    const src = readFileSync(join(process.cwd(), 'app/league/[leagueId]/page.tsx'), 'utf8')
    expect(src).toMatch(/^\s*allLeagues=\{allLeagues\.map\(toSidebarLeague\)\}/m)
    expect(src).not.toMatch(/^\s*allLeagues=\{allLeagues\}/m)
  })
})
