/**
 * Campus to Canton fixtures for the DB-free harness, typed against the app's own response types with
 * `satisfies`, so a fixture that drifts from the real shape fails the typecheck instead of rendering a
 * screen the app never could. They are dumped to JSON for the capture script. Harness-only.
 */
import type { C2CMatchupScore } from '@prisma/client'
import type { C2CConfigClient } from '@/lib/c2c/c2cUiLabels'
import type { C2CPlayerRow } from '@/app/c2c/components/c2cPlayerTypes'
import type { C2CPickRow } from '@/app/c2c/components/C2CPicksBoard'
import type { RosterBuckets } from '@/app/c2c/[leagueId]/roster/C2CRosterClient'

export const HARNESS_USER_ID = 'e2e-c2c-user'

export const config = {
  c2c: {
    sportPair: 'NFL_CFB',
    scoringMode: 'combined_total',
    campusScoreWeight: 0.4,
    cantonScoreWeight: 0.6,
    devyScoringEnabled: false,
    futureDraftFormat: 'separate_campus_and_canton',
    startupDraftFormat: 'combined',
    campusStarterSlots: 8,
    cantonStarterSlots: 9,
    benchSlots: 10,
    taxiSlots: 4,
    devySlots: 6,
    irSlots: 2,
    taxiRookieOnly: true,
    taxiMaxExperienceYears: 2,
    taxiLockDeadline: null,
    taxiPointsVisible: true,
    footballCampusLockDay: 'saturday',
    footballCantonLockDay: 'sunday',
    taxiLockMode: 'preseason',
  } satisfies C2CConfigClient,
}

const season = {
  season: {
    id: 'e2e-c2c-season',
    season: 2026,
    currentWeek: 10,
    rosters: [
      { id: 'ro-me', ownerId: HARNESS_USER_ID, teamName: 'Saturday to Sunday Pipeline' },
      { id: 'ro-opp', ownerId: 'u2', teamName: 'Gridiron Graduates' },
    ],
  },
}

const p = (id: string, name: string, pos: string, side: 'campus' | 'canton', bucket: string, extra: Partial<C2CPlayerRow> = {}): C2CPlayerRow => ({
  playerId: id, playerName: name, position: pos, playerSide: side, playerType: side === 'campus' ? 'college' : 'pro',
  bucketState: bucket, scoringEligibility: bucket.endsWith('_starter') ? 'starter' : 'display_only', ...extra,
})

const campus = (id: string, name: string, pos: string, school: string, classYear: string, bucket = 'campus_starter') =>
  p(id, name, pos, 'campus', bucket, { school, schoolLogoUrl: null, classYear, projectedDeclarationYear: 2027, hasEnteredPro: false })
const canton = (id: string, name: string, pos: string, team: string, bucket = 'canton_starter', extra: Partial<C2CPlayerRow> = {}) =>
  p(id, name, pos, 'canton', bucket, { nflNbaTeam: team, hasEnteredPro: true, proEntryYear: 2023, ...extra })

const mine: RosterBuckets = {
  campusStarters: [
    campus('c1', 'Arch Manning', 'QB', 'Texas', 'JR'),
    campus('c2', 'Jeremiyah Love', 'RB', 'Notre Dame', 'JR'),
    campus('c3', 'Nate Frazier', 'RB', 'Georgia', 'SO'),
    campus('c4', 'Jeremiah Smith', 'WR', 'Ohio State', 'SO'),
    campus('c5', 'Ryan Williams', 'WR', 'Alabama', 'SO'),
    campus('c6', 'Cam Coleman', 'WR', 'Auburn', 'SO'),
    campus('c7', 'Duce Robinson', 'TE', 'Florida State', 'JR'),
    campus('c8', 'Dakorien Moore', 'WR', 'Oregon', 'FR'),
  ],
  cantonStarters: [
    canton('n1', 'Jayden Daniels', 'QB', 'WAS'),
    canton('n2', 'Bijan Robinson', 'RB', 'ATL'),
    canton('n3', 'Jahmyr Gibbs', 'RB', 'DET'),
    canton('n4', 'Ja\'Marr Chase', 'WR', 'CIN'),
    canton('n5', 'Puka Nacua', 'WR', 'LAR'),
    canton('n6', 'Malik Nabers', 'WR', 'NYG'),
    canton('n7', 'Brock Bowers', 'TE', 'LV'),
    canton('n8', 'Amon-Ra St. Brown', 'WR', 'DET'),
    canton('n9', 'Brandon Aubrey', 'K', 'DAL'),
  ],
  bench: [canton('b1', 'Ladd McConkey', 'WR', 'LAC', 'bench'), campus('b2', 'Dylan Raiola', 'QB', 'Nebraska', 'JR', 'bench')],
  taxi: [canton('t1', 'Travis Hunter', 'WR', 'JAX', 'taxi', { isRookieEligible: true, isTaxiEligible: true, taxiYearsUsed: 1, proEntryYear: 2025 })],
  devy: [campus('d1', 'Bryce Underwood', 'QB', 'Michigan', 'FR', 'devy')],
  ir: [canton('i1', 'Christian McCaffrey', 'RB', 'SF', 'ir')],
}

const theirs: RosterBuckets = {
  campusStarters: mine.campusStarters.map((r, i) => ({ ...r, playerId: `oc${i}`, playerName: ['Julian Sayin', 'Isaac Brown', 'Kewan Lacy', 'Carnell Tate', 'Eric Singleton Jr.', 'Elijah Sarratt', 'Eli Stowers', 'Evan Stewart'][i]! })),
  cantonStarters: mine.cantonStarters.map((r, i) => ({ ...r, playerId: `on${i}`, playerName: ['Josh Allen', 'Saquon Barkley', 'Derrick Henry', 'Justin Jefferson', 'CeeDee Lamb', 'Nico Collins', 'Trey McBride', 'Drake London', 'Cameron Dicker'][i]! })),
  bench: [], taxi: [], devy: [], ir: [],
}

const rosters: Record<string, { roster: RosterBuckets }> = { 'ro-me': { roster: mine }, 'ro-opp': { roster: theirs } }

const score = (rosterId: string, campusScore: number, cantonScore: number, campusResult: string | null, cantonResult: string | null): C2CMatchupScore => ({
  id: `s-${rosterId}`, leagueId: 'e2e-c2c', matchupId: 'mu-10', rosterId, week: 10, season: 2026,
  campusStarterScore: campusScore, cantonStarterScore: cantonScore, benchDisplayScore: 31.4, taxiDisplayScore: 8.2, devyDisplayScore: 0,
  officialTeamScore: Math.round((campusScore * 0.4 + cantonScore * 0.6) * 100) / 100,
  campusMatchupResult: campusResult, cantonMatchupResult: cantonResult, isFinalized: false, finalizedAt: null,
})

export const matchup = {
  matchups: [
    { id: 'mu-10', homeRosterId: 'ro-me', awayRosterId: 'ro-opp', homeRoster: { teamName: 'Saturday to Sunday Pipeline' }, awayRoster: { teamName: 'Gridiron Graduates' } },
  ],
  c2cScores: { 'mu-10': { home: score('ro-me', 128.6, 141.2, 'W', null), away: score('ro-opp', 112.3, 149.8, 'L', null) } },
}

const picks = {
  picks: [
    ...[2027, 2028].flatMap((season) =>
      [1, 2, 3].flatMap((round) => [
        { id: `cp-${season}-${round}`, pickSide: 'campus', season, round, originalOwnerId: 'ro-me', currentOwnerId: 'ro-me', isUsed: false },
        { id: `np-${season}-${round}`, pickSide: 'canton', season, round, originalOwnerId: round === 2 ? 'ro-opp' : 'ro-me', currentOwnerId: 'ro-me', isUsed: false },
      ]),
    ),
  ] satisfies C2CPickRow[],
}
