/**
 * Fixture data for the /core dynasty Standings harness (/e2e/dynasty-core/standings). Every value is
 * invented for the screenshot. The live board is the redraft standings harness's computed board (its
 * real `advanceWeek` + `buildStandingsBoard`), relabelled as a dynasty league; the dynasty history is
 * built by the REAL builders — `buildChampionRafters` (what `loadChampionHistory` returns) and
 * `buildDynastyStandingsHistory` — from rows shaped exactly like the stored ones:
 *
 *   2021        a champion NAME only (no team, no records) — hangs in the rafters, not counted
 *   2022–2024   Sleeper-history `teamRecords` (ownerId = Sleeper user id), as syncLeagueHistory writes
 *   2025        a native season archive (ownerId = AllFantasy user id, franchiseId = LeagueTeam id) plus
 *               its `league_championships` row
 *   2026        the season being played — the live board above, an open pennant
 *
 * The two id spaces meet on the league's `LeagueTeam` rows (platformUserId + claimedByUserId), which is
 * the stored join the builder uses. Team 7 changed hands after 2022: its 2022 owner is a separate,
 * departed franchise, because the owner key — not the seat's name — is what identifies a franchise.
 */
import type { LeagueStandingsResult } from '@/lib/core-app/leagueStandings'
import { buildChampionRafters } from '@/lib/league/dynastyHomeExtras'
import {
  buildDynastyStandingsHistory,
  type DynastySeasonInput,
  type DynastyStandingsHistory,
  type DynastyTeamInput,
} from '@/lib/core-app/dynastyStandingsHistory'
import { harnessStandings } from '../../redraft-core/standings/fixtures'

export const DYNASTY_LEAGUE_ID = 'e2e-dynasty-core-standings'
export const DYNASTY_LEAGUE_NAME = 'The Deep!'
const VIEWER = 'e2e-viewer'

/** Same ten teams as the redraft board, so the live table and the dynasty table name the same clubs. */
const TEAMS = [
  ['Ciege Squad', 'Ciege'],
  ['Hardwood Heroes', 'Hoovi'],
  ['Blue Line Bandits', 'BlueLineB'],
  ['Midnight Movers', 'MidnightMo'],
  ['Stitch & Glory', 'Stitch'],
  ['Goalpost Gang', 'GPG'],
  ['Bracket Busters', 'Busters'],
  ['Pitch Perfect', 'PitchP'],
  ['Waiver Wire Kings', 'WWK'],
  ['Last Pick Legends', 'LPL'],
] as const

const sleeperUser = (i: number) => `sl-${i}`
const afUser = (i: number) => (i === 4 ? VIEWER : `af-${i}`)

const teams: DynastyTeamInput[] = TEAMS.map(([teamName, ownerName], idx) => {
  const i = idx + 1
  return { id: `lt-${i}`, externalId: String(i), platformUserId: sleeperUser(i), claimedByUserId: afUser(i), teamName, ownerName }
})

/** [wins, losses, pointsFor] per team per season — invented, 13-game seasons. */
const RESULTS: Record<number, Array<[number, number, number]>> = {
  2022: [[9, 4, 1612.4], [10, 3, 1688.1], [6, 7, 1490.2], [7, 6, 1544.9], [5, 8, 1431.7], [8, 5, 1570.3], [3, 10, 1302.6], [7, 6, 1521.0], [6, 7, 1477.8], [4, 9, 1366.5]],
  2023: [[8, 5, 1590.2], [7, 6, 1533.4], [5, 8, 1450.9], [10, 3, 1701.6], [6, 7, 1488.2], [9, 4, 1622.0], [6, 7, 1470.1], [5, 8, 1421.3], [7, 6, 1519.8], [2, 11, 1288.4]],
  2024: [[11, 2, 1744.7], [6, 7, 1502.6], [8, 5, 1588.1], [8, 5, 1611.3], [7, 6, 1531.9], [5, 8, 1442.0], [7, 6, 1508.5], [4, 9, 1390.2], [6, 7, 1480.7], [3, 10, 1335.0]],
  2025: [[9, 4, 1650.8], [5, 8, 1462.3], [7, 6, 1555.5], [10, 3, 1690.4], [8, 5, 1600.1], [6, 7, 1496.6], [7, 6, 1534.2], [5, 8, 1430.0], [4, 9, 1401.9], [4, 9, 1377.3]],
}
const CHAMPION: Record<number, number> = { 2022: 2, 2023: 4, 2024: 1, 2025: 4 }
const RUNNER_UP: Record<number, number> = { 2022: 1, 2023: 6, 2024: 4, 2025: 1 }

/** Older team names for the imported seasons — the franchise keeps its id through a rename. */
const OLD_NAME: Record<number, string> = { 4: 'Night Shift', 1: 'Ciege FC' }

function sleeperSeason(season: number): DynastySeasonInput {
  const records = RESULTS[season].map(([w, l, pf], idx) => {
    const i = idx + 1
    const departed = season === 2022 && i === 7
    return {
      rosterId: i,
      ownerId: departed ? 'sl-old7' : sleeperUser(i),
      managerName: departed ? 'gone_fishing' : TEAMS[idx][1],
      teamName: departed ? 'Reel Deal' : OLD_NAME[i] ?? TEAMS[idx][0],
      wins: w,
      losses: l,
      ties: 0,
      pointsFor: pf,
      pointsAgainst: pf - 20,
      isChampion: CHAMPION[season] === i,
      isRunnerUp: RUNNER_UP[season] === i,
    }
  })
  return { season, status: 'complete', teamRecords: records, championName: TEAMS[CHAMPION[season] - 1][1], championTeamId: `lt-${CHAMPION[season]}` }
}

function nativeSeason(season: number): DynastySeasonInput {
  const records = RESULTS[season].map(([w, l, pf], idx) => {
    const i = idx + 1
    return {
      rosterId: `rr-${season}-${i}`,
      franchiseId: `lt-${i}`,
      ownerId: afUser(i),
      managerUserId: afUser(i),
      managerName: TEAMS[idx][1],
      teamName: TEAMS[idx][0],
      wins: w,
      losses: l,
      ties: 0,
      pointsFor: pf,
      pointsAgainst: pf - 15,
      isChampion: CHAMPION[season] === i,
      isRunnerUp: RUNNER_UP[season] === i,
    }
  })
  return { season, status: 'complete', teamRecords: records, championName: TEAMS[CHAMPION[season] - 1][0], championTeamId: `lt-${CHAMPION[season]}` }
}

export type DynastyHistoryMode = 'full' | 'titles' | 'none'

export function dynastyHistoryFixture(mode: DynastyHistoryMode): DynastyStandingsHistory {
  const seasons: DynastySeasonInput[] =
    mode === 'none'
      ? []
      : [
          { season: 2021, status: 'complete', teamRecords: null, championName: 'Hoovi', championTeamId: null },
          ...(mode === 'titles'
            ? [2022, 2023, 2024, 2025].map((s) => ({ season: s, status: 'complete', teamRecords: null, championName: TEAMS[CHAMPION[s] - 1][1], championTeamId: `lt-${CHAMPION[s]}` }))
            : [sleeperSeason(2022), sleeperSeason(2023), sleeperSeason(2024), nativeSeason(2025)]),
        ]
  const championships = mode === 'none' ? [] : [{ season: 2025, championUserId: VIEWER, teamName: 'Midnight Movers' }]
  const teamById = new Map(teams.map((t) => [t.id, t]))
  /* The rafters exactly as `loadChampionHistory` builds them from these rows. */
  const rafters = buildChampionRafters({
    seasons: seasons.map((s) => {
      const t = s.championTeamId ? teamById.get(s.championTeamId) : undefined
      return {
        season: s.season,
        championName: s.championName,
        championTeamUserIds: t ? [t.platformUserId, t.claimedByUserId] : [],
        championTeamName: t?.teamName ?? null,
      }
    }),
    championships,
    viewerUserId: VIEWER,
    currentSeason: 2026,
  })
  return buildDynastyStandingsHistory({ seasons, championships, teams, standingFacts: [], viewerUserId: VIEWER, rafters })
}

export function dynastyStandingsFixture(): LeagueStandingsResult {
  const data = harnessStandings()
  if (!data.available) return data
  return { ...data, league: { ...data.league, id: DYNASTY_LEAGUE_ID, name: DYNASTY_LEAGUE_NAME, platform: 'sleeper' } }
}
