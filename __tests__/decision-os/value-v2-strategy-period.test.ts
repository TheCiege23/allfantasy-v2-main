import { afterEach, expect, it, vi } from 'vitest'
import { resolveMatchupPeriod } from '@/lib/league-context-engine/resolvePeriod'
afterEach(() => vi.unstubAllGlobals())
it('verifies only the recorded season and regular-season NFL week', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ season: '2026', season_type: 'regular', week: 5 }) }))
  expect(await resolveMatchupPeriod({ sport: 'NFL', leagueSeason: 2026 }))
    .toMatchObject({ source: 'sleeper_state_nfl', currentPeriod: 5, verifiedRegularSeason: true })
})
it.each([
  { season: '2025', season_type: 'regular', week: 5 },
  { season: '2026', season_type: 'pre', week: 4 },
  { season: '2026', season_type: 'post', week: 4 },
  { season: '2026', season_type: 'regular', week: 5.5 },
  { season: '2026', season_type: 'regular', week: 19 },
  { week: 5 },
])('does not verify season state %j, and leaves the week for other callers', async state => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => state }))
  const period = await resolveMatchupPeriod({ sport: 'NFL', leagueSeason: 2026 })
  // Start/sit and Chimmy context keep Sleeper's week; only completed-week consumers need the flag.
  expect(period).toMatchObject({ source: 'sleeper_state_nfl', currentPeriod: state.week, verifiedRegularSeason: false })
})
