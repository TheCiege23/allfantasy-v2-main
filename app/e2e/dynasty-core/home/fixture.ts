/**
 * Fixture data for the /core dynasty Home harness (/e2e/dynasty-core/home). Every value is invented for
 * the screenshot. The deck is built by the REAL builder (lib/core-app/dynastyLeagueHome.ts) from fixture
 * reads shaped like the loaders' output, and the rest of Home reuses the redraft harness's NFL fixture
 * with the league switched to dynasty.
 */
import type { LeagueHomeData } from '@/lib/core-app/leagueHome'
import { buildDynastyHomeDeck } from '@/lib/core-app/dynastyLeagueHome'
import { buildChampionRafters } from '@/lib/league/dynastyHomeExtras'
import { homeFixture } from '../../redraft-core/home/fixture'

const VIEWER = 'e2e-viewer'

export function dynastyHomeFixture(opts: { identity: boolean; sparse: boolean }): LeagueHomeData {
  const { data } = homeFixture('nfl', { identity: false, leagueType: 'dynasty' })
  const rafters = opts.sparse
    ? null
    : buildChampionRafters({
        seasons: [
          { season: 2022, championName: 'Hoovi', championTeamUserIds: [], championTeamName: null },
          { season: 2023, championName: 'Gridiron Ghosts', championTeamUserIds: ['other'], championTeamName: null },
          { season: 2024, championName: 'Fourth & Long', championTeamUserIds: [VIEWER], championTeamName: null },
          { season: 2025, championName: 'Bench Mob', championTeamUserIds: ['other'], championTeamName: null },
          { season: 2026, championName: null, championTeamUserIds: [], championTeamName: null },
        ],
        championships: [],
        viewerUserId: VIEWER,
        currentSeason: 2026,
      })
  const dynasty = opts.identity
    ? buildDynastyHomeDeck({
        league: { season: 2026, sport: 'NFL', platform: 'sleeper', settings: {}, createdAt: null },
        firstSeasonOnFile: opts.sparse ? null : 2022,
        rafters,
        outlook: {
          picks: opts.sparse
            ? { available: false, reason: 'future picks are not synced for this platform yet' }
            : {
                available: true,
                coverage: 'complete',
                bySeason: [
                  { season: 2027, picks: [
                    { season: 2027, round: 1, label: '1st', fromTeamName: null },
                    { season: 2027, round: 1, label: '1st', fromTeamName: 'Taco Tuesday' },
                    { season: 2027, round: 2, label: '2nd', fromTeamName: null },
                    { season: 2027, round: 3, label: '3rd', fromTeamName: null },
                  ] },
                  { season: 2028, picks: [
                    { season: 2028, round: 1, label: '1st', fromTeamName: null },
                    { season: 2028, round: 3, label: '3rd', fromTeamName: null },
                    { season: 2028, round: 4, label: '4th', fromTeamName: 'Bench Mob' },
                  ] },
                  { season: 2029, picks: [
                    { season: 2029, round: 2, label: '2nd', fromTeamName: null },
                  ] },
                ],
              },
          ages: {
            available: true,
            medianStarterAge: 25.5,
            known: 9,
            total: 10,
            aging: [
              { sleeperId: '1', name: 'A', position: 'RB', age: 28, threshold: 27 },
              { sleeperId: '2', name: 'B', position: 'WR', age: 30, threshold: 29 },
            ],
            youngCore: 7,
          },
        },
        taxi: { count: 3, slots: 4 },
      })
    : null
  return {
    ...data,
    dynasty,
    league: { ...data.league, id: 'e2e-dynasty-core-home', name: 'The Deep!', format: 'dynasty' },
  } as LeagueHomeData
}
