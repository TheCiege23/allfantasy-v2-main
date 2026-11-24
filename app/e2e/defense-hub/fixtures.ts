/**
 * IDP Defense hub fixtures for the DB-free harness, typed against the app's own response types with
 * `satisfies`, so a fixture that drifts from the real shape fails the typecheck instead of rendering a
 * screen the app never could. Harness-only; every list stays JSON-serialisable.
 *
 * The screen (app/idp/defense-hub/[leagueId]/DefenseHubClient.tsx + TradeBoardSection.tsx) makes three
 * reads, all on GET /api/idp/players (app/api/idp/players/route.ts). Each branch sends its loader's payload
 * through `afJson`, which adds nothing while the AF Intelligence paywall is unlaunched — so the body IS the
 * loader's return value, no wrapper keys:
 *   view=defense-hub        → loadDefenseHub          → DefenseHubPayload    (lib/idp-projections/defenseHub.ts)
 *   view=trade-board        → loadLeagueDefenderBoard → LeagueDefenderBoard  (lib/values/leagueDefenderBoard.ts)
 *   view=value-eligibility  → resolveLeagueValueSurfaces → ValueSurfaceEligibility (ValuesPageLink, inside
 *                             "How these numbers work"; without it the link renders nothing)
 *
 * The league: a 12-team NFL IDP dynasty league, 2026, projections for week 10 built from games through
 * week 9. The viewer manages "Blitz Package". Sleeper ids are synthetic (`9xxxx`), not real ones.
 *
 * ⚠ THE NUMBERS ARE DERIVED, NOT TYPED IN, so the hub and the board agree the way the real loaders do (both
 * come from one `loadLeagueIdpVorp` pass). One league-wide list below carries each defender's projection;
 * VORP is projection minus his group's replacement level, the board is ranked across all three groups by
 * VORP, value is `idpValueForRank(overallRank, dynasty)` (mirrored in `dynastyValueForRank` because the real
 * one lives in a server module), and `valueIsFloor` is "equals the board minimum", exactly as both loaders
 * compute it. Roles and the kicker value are worded/computed with the same formulas as deriveDefenderRole
 * and resolveLeagueKickerValue.
 *
 * Edge cases the UI draws, all reachable through the real loaders:
 *  - Mykel Williams: no scored game on file → `projection: null`, reason row, no snaps, role refused, no game.
 *  - Jamien Sherwood: projected but replacement level not established → `vorp/value: null`, the other reason.
 *  - Kool-Aid McKinstry: floor-priced; last week `unscored` with a 2-key line (the ingest-gap tooltip).
 *  - Derwin James: last week `no_game` (bye). Travis Hunter: snap share on the OFFENSE basis.
 *  - Marte Mapu (another team): unpriced on the board, sorted last with a dash.
 *  - One roster entry in an unresolvable id space (`unresolvedIds: 1`), stated in "How these numbers work".
 *  - The board lists ~140 rows, so it opens at its top 25 with a "show all" button.
 */
import type { DefenseHubDefender, DefenseHubPayload } from '@/lib/idp-projections/defenseHub'
import type { ActualWeekOutcome } from '@/lib/idp-projections/actualWeeklyPoints'
import type { TeamDefenseTendency } from '@/lib/idp-projections/teamTendencies'
import type { LeagueKickerValue } from '@/lib/kicker-values/leagueKickerValue'
import type { DefenderBoardRow, LeagueDefenderBoard } from '@/lib/values/leagueDefenderBoard'
import type { ValueSurfaceEligibility } from '@/lib/values/valueSurfaceEligibility'
import type { HarnessApiRoute } from '../harnessApi'

export const DEFENSE_HUB_LEAGUE_ID = 'e2e-idp-defense'

const PROJECTED_FOR = { season: 2026, week: 10 }

// ── The league ────────────────────────────────────────────────────────────────────────────────

const TEAMS: Array<{ teamName: string; ownerName: string }> = [
  { teamName: 'Blitz Package', ownerName: 'blitzpkg' }, // the viewer
  { teamName: 'Pick Six Syndicate', ownerName: 'jrod_ff' },
  { teamName: 'Sack Masters', ownerName: 'edgelord' },
  { teamName: 'The Coverage Unit', ownerName: 'dbu_kev' },
  { teamName: 'Gridiron Gurus', ownerName: 'guru_mike' },
  { teamName: 'Red Zone Rebels', ownerName: 'rzr_kate' },
  { teamName: 'Fourth & Long', ownerName: '4thandlong' },
  { teamName: 'Hail Mary Heroes', ownerName: 'hmh_tony' },
  { teamName: 'Turnover Chain', ownerName: 'chaingang' },
  { teamName: 'Monsters of the Midway', ownerName: 'bearsfan85' },
  { teamName: 'Bayou Ballhawks', ownerName: 'bayou_b' },
  { teamName: 'Trench Warfare', ownerName: 'trench_dan' },
]
const MINE = 0

/** [name, NFL team, position as SportsPlayer spells it, league-scored projection or null] */
type Raw = [string, string, string, number | null]

/** Index = TEAMS index. The viewer's own list is in roster order (the order snaps/roles come back in). */
const ROSTERS: Raw[][] = [
  [
    ['Roquan Smith', 'BAL', 'LB', 15.6],
    ['Fred Warner', 'SF', 'LB', 14.8],
    ['Micah Parsons', 'GB', 'DE', 13.4],
    ['Jack Campbell', 'DET', 'LB', 14.1],
    ['Zack Baun', 'PHI', 'LB', 13.9],
    ['Quay Walker', 'GB', 'LB', 12.3],
    ['Aidan Hutchinson', 'DET', 'DE', 12.1],
    ['Kyle Hamilton', 'BAL', 'S', 11.2],
    ['Derwin James', 'LAC', 'S', 10.9],
    ['Brian Branch', 'DET', 'S', 10.4],
    ['Jamien Sherwood', 'NYJ', 'LB', 10.2],
    ['Jalen Carter', 'PHI', 'DT', 9.6],
    ['Travis Hunter', 'JAX', 'CB', 8.4],
    ['Sauce Gardner', 'IND', 'CB', 7.9],
    ['Tyler Nubin', 'NYG', 'S', 6.6],
    ['Kool-Aid McKinstry', 'NO', 'CB', 6.1],
    ['Mykel Williams', 'SF', 'DE', null],
  ],
  [
    ['Bobby Wagner', 'WAS', 'LB', 13.6],
    ['Foyesade Oluokun', 'JAX', 'LB', 13.2],
    ['Myles Garrett', 'CLE', 'DE', 12.9],
    ['T.J. Watt', 'PIT', 'LB', 12.8],
    ['Nick Bolton', 'KC', 'LB', 11.9],
    ['Budda Baker', 'ARI', 'S', 10.8],
    ['Antoine Winfield Jr.', 'TB', 'S', 10.1],
    ['Xavier McKinney', 'GB', 'S', 9.7],
    ['Josh Sweat', 'ARI', 'DE', 8.9],
    ['Dexter Lawrence', 'NYG', 'DT', 8.6],
    ['Patrick Surtain II', 'DEN', 'CB', 7.4],
  ],
  [
    ['Maxx Crosby', 'LV', 'DE', 12.4],
    ['Will Anderson Jr.', 'HOU', 'DE', 11.8],
    ['Trey Hendrickson', 'CIN', 'DE', 11.2],
    ['Nik Bonitto', 'DEN', 'LB', 10.6],
    ['Danielle Hunter', 'HOU', 'DE', 10.3],
    ['Brian Burns', 'NYG', 'DE', 10.1],
    ['Josh Hines-Allen', 'JAX', 'DE', 9.9],
    ['Jonathan Greenard', 'MIN', 'DE', 9.8],
    ['Jessie Bates III', 'ATL', 'S', 9.4],
    ['Zaven Collins', 'ARI', 'LB', 9.0],
    ['Jaylon Johnson', 'CHI', 'CB', 6.4],
  ],
  [
    ['Bobby Okereke', 'NYG', 'LB', 11.6],
    ['Kerby Joseph', 'DET', 'S', 9.9],
    ['Kamren Curl', 'LAR', 'S', 9.3],
    ['Jevon Holland', 'NYG', 'S', 9.1],
    ['Talanoa Hufanga', 'DEN', 'S', 9.0],
    ['Jaquan Brisker', 'CHI', 'S', 8.8],
    ['Devon Witherspoon', 'SEA', 'CB', 8.7],
    ['Derek Stingley Jr.', 'HOU', 'CB', 7.8],
    ['Jalen Ramsey', 'PIT', 'CB', 7.6],
    ['Christian Gonzalez', 'NE', 'CB', 7.0],
    ['Nate Wiggins', 'BAL', 'CB', 6.3],
  ],
  [
    ['Zaire Franklin', 'IND', 'LB', 14.4],
    ['Demario Davis', 'NYJ', 'LB', 12.6],
    ['Lavonte David', 'TB', 'LB', 11.4],
    ['Logan Wilson', 'DAL', 'LB', 11.1],
    ['Terrel Bernard', 'BUF', 'LB', 11.0],
    ['Grant Delpit', 'CLE', 'S', 9.6],
    ['Camryn Bynum', 'IND', 'S', 9.2],
    ['Chris Jones', 'KC', 'DT', 8.8],
    ['Quinnen Williams', 'DAL', 'DT', 8.3],
    ['Tyrann Mathieu', 'NO', 'S', 7.9],
    ['Jaire Alexander', 'BAL', 'CB', 5.9],
  ],
  [
    ['Jordyn Brooks', 'MIA', 'LB', 14.0],
    ['Ernest Jones IV', 'SEA', 'LB', 12.4],
    ['Alex Singleton', 'DEN', 'LB', 12.0],
    ['Eric Kendricks', 'SF', 'LB', 10.0],
    ['Jalen Pitre', 'HOU', 'S', 9.8],
    ['Rashan Gary', 'GB', 'DE', 9.4],
    ['Montez Sweat', 'CHI', 'DE', 9.2],
    ['Jeffery Simmons', 'TEN', 'DT', 8.4],
    ['Jordan Battle', 'CIN', 'S', 8.2],
    ['Trent McDuffie', 'KC', 'CB', 7.2],
    ['Marlon Humphrey', 'BAL', 'CB', 6.0],
  ],
  [
    ['Devin Lloyd', 'CAR', 'LB', 12.7],
    ['Tremaine Edmunds', 'CHI', 'LB', 10.7],
    ['Jared Verse', 'LAR', 'DE', 10.2],
    ['Jeremiah Owusu-Koramoah', 'CLE', 'LB', 9.9],
    ['Julian Love', 'SEA', 'S', 9.5],
    ['Laiatu Latu', 'IND', 'DE', 9.3],
    ['Nolan Smith', 'PHI', 'LB', 8.7],
    ['Calijah Kancey', 'TB', 'DT', 8.1],
    ['Andre Cisco', 'NYJ', 'S', 8.0],
    ['Byron Murphy II', 'SEA', 'DT', 7.7],
    ['Trevon Diggs', 'DAL', 'CB', 6.8],
  ],
  [
    ['Edgerrin Cooper', 'GB', 'LB', 13.0],
    ['Daiyan Henley', 'LAC', 'LB', 12.9],
    ['Kaden Elliss', 'ATL', 'LB', 12.5],
    ['Payton Wilson', 'PIT', 'LB', 11.3],
    ['Matt Milano', 'BUF', 'LB', 9.6],
    ['Tykee Smith', 'TB', 'S', 9.0],
    ['Cooper DeJean', 'PHI', 'CB', 8.9],
    ['Coby Bryant', 'SEA', 'S', 8.6],
    ['Jalen Thompson', 'DAL', 'S', 8.4],
    ['Kwity Paye', 'IND', 'DE', 8.0],
    ['Kenny Clark', 'DAL', 'DT', 7.6],
  ],
  [
    ['Abdul Carter', 'NYG', 'LB', 10.9],
    ['Germaine Pratt', 'LV', 'LB', 10.8],
    ['Troy Andersen', 'ATL', 'LB', 10.4],
    ['Zach Allen', 'DEN', 'DE', 9.7],
    ['Jaelan Phillips', 'PHI', 'DE', 9.0],
    ['Kyle Dugger', 'PIT', 'S', 8.9],
    ['Leonard Williams', 'SEA', 'DT', 8.5],
    ['Minkah Fitzpatrick', 'MIA', 'S', 8.5],
    ['Brandon Jones', 'DEN', 'S', 8.3],
    ['Kenny Moore II', 'IND', 'CB', 7.3],
    ['Riq Woolen', 'PHI', 'CB', 6.2],
  ],
  [
    ['T.J. Edwards', 'CHI', 'LB', 13.3],
    ['Blake Cashman', 'MIN', 'LB', 11.7],
    ['Dre Greenlaw', 'DEN', 'LB', 10.5],
    ['Christian Harris', 'HOU', 'LB', 9.8],
    ['Kevin Byard III', 'CHI', 'S', 9.5],
    ['DeMarvion Overshown', 'DAL', 'LB', 9.4],
    ['Derrick Brown', 'CAR', 'DT', 9.1],
    ['Gervon Dexter Sr.', 'CHI', 'DT', 8.2],
    ["Ji'Ayir Brown", 'SF', 'S', 8.1],
    ['Chop Robinson', 'MIA', 'DE', 7.8],
    ['Jaylen Watson', 'KC', 'CB', 5.8],
  ],
  [
    ['Carson Schwesinger', 'CLE', 'LB', 12.2],
    ['Jack Gibbens', 'TEN', 'LB', 11.5],
    ['Chase Young', 'NO', 'DE', 9.6],
    ['Malcolm Rodriguez', 'DET', 'LB', 9.3],
    ['Justin Reid', 'NO', 'S', 9.1],
    ['Jordan Whitehead', 'TB', 'S', 8.6],
    ['Cameron Jordan', 'NO', 'DE', 8.3],
    ['Alontae Taylor', 'NO', 'CB', 6.9],
    ['Shemar Stewart', 'CIN', 'DE', 6.9],
    ['Jahdae Barron', 'DEN', 'CB', 6.6],
    ['Mike Jackson', 'CAR', 'CB', 6.0],
  ],
  [
    ['Robert Spillane', 'NE', 'LB', 12.1],
    ['Nakobe Dean', 'PHI', 'LB', 10.6],
    ['Tuli Tuipulotu', 'LAC', 'DE', 9.5],
    ['Xavier Watts', 'ATL', 'S', 9.3],
    ['Harold Landry III', 'NE', 'DE', 8.8],
    ['Milton Williams', 'NE', 'DT', 8.0],
    ['Vita Vea', 'TB', 'DT', 7.9],
    ['Osa Odighizuwa', 'DAL', 'DT', 7.5],
    ['Christian Barmore', 'NE', 'DT', 7.2],
    ['Jourdan Lewis', 'JAX', 'CB', 6.5],
    ['Marte Mapu', 'NE', 'S', null],
  ],
]

/**
 * Projected, but replacement level at his position could not be established — the hub's second reason,
 * and a null value on the board. Rare in a healthy league; here so the row is seen.
 */
const NO_REPLACEMENT = new Set(['Jamien Sherwood'])

/** Mirrors idpPositionGroup (lib/core-app/scoringNotes.ts) for the spellings used above. */
function groupOf(position: string): 'DL' | 'LB' | 'DB' {
  if (position === 'LB') return 'LB'
  if (position === 'DE' || position === 'DT') return 'DL'
  return 'DB'
}

/** Points per game a freely available player at each group scores in this league. */
const REPLACEMENT: Record<'DL' | 'LB' | 'DB', number> = { DL: 7.4, LB: 9.6, DB: 7.1 }

/**
 * Mirrors `idpValueForRank(rank, true)` (lib/idp-kicker-values.ts): the dynasty market-decay curve at the
 * 5,500 ceiling, linearly interpolated, held flat at its floor past rank 130.
 */
const DYNASTY_TIERS: Array<[number, number]> = [
  [1, 1.0], [2, 0.883], [3, 0.714], [5, 0.597], [8, 0.499], [15, 0.343],
  [25, 0.244], [40, 0.124], [60, 0.066], [90, 0.049], [130, 0.016],
].map(([rank, share]): [number, number] => [rank, Math.round(5500 * share)])
function dynastyValueForRank(rank: number): number {
  let prevRank = 1
  let prevValue = DYNASTY_TIERS[0][1]
  for (const [maxRank, value] of DYNASTY_TIERS) {
    if (rank <= maxRank) {
      if (maxRank === prevRank) return value
      const t = Math.max(0, Math.min(1, (rank - prevRank) / (maxRank - prevRank)))
      return Math.round(prevValue + (value - prevValue) * t)
    }
    prevRank = maxRank
    prevValue = value
  }
  return DYNASTY_TIERS[DYNASTY_TIERS.length - 1][1]
}

const round1 = (n: number) => Math.round(n * 10) / 10

interface LeaguePlayer {
  sleeperId: string
  name: string
  team: string
  position: string
  group: 'DL' | 'LB' | 'DB'
  owner: number
  projection: number | null
  vorp: number | null
  value: number | null
  positionRank: number | null
}

const LEAGUE: LeaguePlayer[] = ROSTERS.flatMap((roster, owner) =>
  roster.map(([name, team, position, projection], i) => {
    const group = groupOf(position)
    return {
      sleeperId: String(90000 + owner * 100 + i),
      name,
      team,
      position,
      group,
      owner,
      projection,
      vorp: projection != null && !NO_REPLACEMENT.has(name) ? round1(projection - REPLACEMENT[group]) : null,
      value: null as number | null,
      positionRank: null as number | null,
    }
  }),
)

// One board across all three groups, ordered by VORP (as loadLeagueIdpVorp ranks it); rank within group for reading.
{
  const priced = LEAGUE.filter((p) => p.vorp != null).sort((a, b) => b.vorp! - a.vorp! || b.projection! - a.projection!)
  priced.forEach((p, i) => {
    p.value = dynastyValueForRank(i + 1)
  })
  for (const g of ['DL', 'LB', 'DB'] as const) {
    priced.filter((p) => p.group === g).forEach((p, i) => {
      p.positionRank = i + 1
    })
  }
}

const BOARD_FLOOR = Math.min(...LEAGUE.filter((p) => p.value != null).map((p) => p.value!))

const COVERAGE = {
  defenders: LEAGUE.length,
  projected: LEAGUE.filter((p) => p.projection != null).length,
  priced: LEAGUE.filter((p) => p.value != null).length,
}

const mine = LEAGUE.filter((p) => p.owner === MINE)

// ── Kickers ───────────────────────────────────────────────────────────────────────────────────

/**
 * resolveLeagueKickerValue for 1 K slot × 12 teams, dynasty: replacement K13, scarcity 12/32, value
 * round(500 × (0.35 + 0.65 × 0.375) × (0.5 + (1 − 0.7565))) = 221. Basis worded as that function words it.
 */
const KICKER_VALUE = {
  value: 221,
  replacementRank: 13,
  scarcity: 0.375,
  rankPredictability: 'none',
  basis:
    'Every kicker prices the same here: kicker rank does not persist (year-over-year Spearman -0.455, ' +
    'negative in all six measured season pairs), and the startable population spans only 1.55x. This ' +
    'league starts 1 kicker across 12 teams, so replacement is about K13.',
} satisfies LeagueKickerValue

const KICKERS: Array<[string, string]> = [
  ['Brandon Aubrey', 'DAL'], ['Cameron Dicker', 'LAC'], ['Jake Bates', 'DET'], ['Chris Boswell', 'PIT'],
  ['Ka’imi Fairbairn', 'HOU'], ['Wil Lutz', 'DEN'], ['Tyler Loop', 'BAL'], ['Harrison Butker', 'KC'],
  ['Jason Myers', 'SEA'], ['Cairo Santos', 'CHI'], ['Chase McLaughlin', 'TB'], ['Andy Borregales', 'NE'],
]
const kickerId = (owner: number) => String(98000 + owner)

// ── GET /api/idp/players?view=defense-hub ─────────────────────────────────────────────────────

type Snap = DefenseHubPayload['snaps'][number]
type Role = DefenseHubPayload['roles'][number]

/** Last completed week (9), under this league's scoring. Keyed by name; anyone absent scored normally. */
const LAST_WEEK_OVERRIDE: Record<string, ActualWeekOutcome> = {
  'Derwin James': { scored: false, reason: 'no_game' }, // bye
  'Mykel Williams': { scored: false, reason: 'no_game' }, // has not played
  'Kool-Aid McKinstry': { scored: false, reason: 'unscored', lineKeys: 2 }, // only def_snp / tm_def_snp ingested
}
/** Week-9 points: his projection plus a fixed, player-specific swing, so the column reads as real games. */
const SWING = [3.4, -2.1, 6.8, 1.2, -4.0, 0.6, -1.5, 2.9, 0, 4.4, -3.2, 1.8, -0.9, -2.6, 0.7, 0, 0]
function lastWeekOf(p: LeaguePlayer, i: number): ActualWeekOutcome {
  const o = LAST_WEEK_OVERRIDE[p.name]
  if (o) return o
  return { scored: true, points: round1(Math.max(0, (p.projection ?? 0) + (SWING[i] ?? 0))), matchedKeys: 7 }
}

const defenders: DefenseHubDefender[] = mine
  .map((p, i) => ({
    sleeperId: p.sleeperId,
    name: p.name,
    team: p.team,
    position: p.position,
    positionGroup: p.group,
    projection: p.projection,
    vorp: p.vorp,
    positionRank: p.positionRank,
    value: p.value,
    valueIsFloor: p.value != null && p.value === BOARD_FLOOR,
    reason:
      p.projection == null
        ? 'No projection yet: he hasn’t played a scored game.'
        : p.vorp == null
          ? 'Projected, but there aren’t enough comparable players at his position to price him.'
          : null,
    lastWeek: lastWeekOf(p, i),
  }))
  .sort((a, b) => (b.projection ?? -1) - (a.projection ?? -1))

/** [snap share, basis, games, sacks, tackles] per rostered defender; games = the last 26 logs (2025 + 2026 to week 9). */
const PLAY: Record<string, [number, 'defense' | 'offense', number, number, number]> = {
  'Roquan Smith': [0.99, 'defense', 26, 1.5, 241],
  'Fred Warner': [0.98, 'defense', 26, 2, 228],
  'Micah Parsons': [0.81, 'defense', 25, 19.5, 77],
  'Jack Campbell': [0.97, 'defense', 26, 5.5, 205],
  'Zack Baun': [0.96, 'defense', 26, 4, 214],
  'Quay Walker': [0.93, 'defense', 23, 2.5, 172],
  'Aidan Hutchinson': [0.84, 'defense', 21, 16, 69],
  'Kyle Hamilton': [0.95, 'defense', 26, 3, 151],
  'Derwin James': [0.97, 'defense', 25, 4.5, 158],
  'Brian Branch': [0.9, 'defense', 24, 1, 139],
  'Jamien Sherwood': [0.88, 'defense', 24, 1.5, 167],
  'Jalen Carter': [0.82, 'defense', 26, 6, 64],
  'Travis Hunter': [0.71, 'offense', 15, 0, 38],
  'Sauce Gardner': [0.96, 'defense', 22, 0, 71],
  'Tyler Nubin': [0.86, 'defense', 19, 0, 96],
  'Kool-Aid McKinstry': [0.74, 'defense', 20, 0, 62],
}

/** Rate of defensive snaps per game behind `snaps` — a full-time defender sees ~64. */
const SNAPS_PER_GAME = 64

const snaps: Snap[] = mine.map((p) => {
  const play = PLAY[p.name]
  return play
    ? { sleeperId: p.sleeperId, name: p.name, share: play[0], games: play[2], basis: play[1], trend: null, reason: null }
    : {
        sleeperId: p.sleeperId,
        name: p.name,
        share: null,
        games: 0,
        basis: null,
        trend: null,
        reason: 'no game on file carries both def_snp and tm_def_snp for this player',
      }
})

/** Worded exactly as deriveDefenderRole (lib/idp-projections/defenderRole.ts) words them. */
const roles: Role[] = mine.map((p) => {
  const play = PLAY[p.name]
  if (!play) {
    return {
      sleeperId: p.sleeperId,
      name: p.name,
      games: 0,
      snaps: 0,
      sacks: 0,
      tackles: null,
      lines: [{ label: 'Role', value: null, basis: 'no game on file carries a defensive snap count — refused rather than estimated' }],
    }
  }
  const [share, basis, games, sacks, tackles] = play
  // Hunter's share is of OFFENSIVE snaps; his defensive count is what the role lines are built from.
  const snapCount = Math.round(games * SNAPS_PER_GAME * (basis === 'offense' ? 0.45 : share))
  return {
    sleeperId: p.sleeperId,
    name: p.name,
    games,
    snaps: snapCount,
    sacks,
    tackles,
    lines: [
      sacks > 0
        ? { label: 'Sack rate', value: `1 per ${round1(snapCount / sacks)} defensive snaps`, basis: `${sacks} sacks over ${snapCount} snaps, ${games} games` }
        : { label: 'Sack rate', value: `none in ${games} games`, basis: `${snapCount} defensive snaps, no sack recorded` },
      { label: 'Tackle rate', value: `1 per ${round1(snapCount / tackles)} defensive snaps`, basis: `${tackles} tackles over ${snapCount} snaps, ${games} games` },
      { label: 'Coverage', value: null, basis: 'no targets-allowed column is ingested by any provider we read' },
    ],
  }
})

/** Last completed season on file (2025), one card per team the viewer has a defender on and we hold a row for. */
const tendency = (teamId: string, t: Omit<TeamDefenseTendency, 'teamId' | 'season'>): { team: string; tendency: TeamDefenseTendency } => ({
  team: teamId,
  tendency: { teamId, season: 2025, ...t },
})
const tendencies = [
  tendency('BAL', { passRateFaced: 0.612, thirdDownRateFaced: 0.214, playsFacedSeason: 1063, secPerPlayFaced: 28.4, blitzRate: 0.318, meanPassRushers: 4.4, meanDefendersInBox: 6.3 }),
  tendency('SF', { passRateFaced: 0.574, thirdDownRateFaced: 0.226, playsFacedSeason: 1041, secPerPlayFaced: 29.1, blitzRate: 0.204, meanPassRushers: 4.1, meanDefendersInBox: 6.6 }),
  tendency('GB', { passRateFaced: 0.598, thirdDownRateFaced: 0.219, playsFacedSeason: 1018, secPerPlayFaced: 28.8, blitzRate: 0.247, meanPassRushers: 4.2, meanDefendersInBox: 6.4 }),
  tendency('DET', { passRateFaced: 0.633, thirdDownRateFaced: 0.231, playsFacedSeason: 1087, secPerPlayFaced: 27.6, blitzRate: 0.356, meanPassRushers: 4.5, meanDefendersInBox: 6.2 }),
  tendency('PHI', { passRateFaced: 0.605, thirdDownRateFaced: 0.208, playsFacedSeason: 992, secPerPlayFaced: 29.7, blitzRate: 0.192, meanPassRushers: 4.1, meanDefendersInBox: 6.5 }),
  tendency('LAC', { passRateFaced: 0.587, thirdDownRateFaced: 0.222, playsFacedSeason: 1024, secPerPlayFaced: 28.9, blitzRate: 0.281, meanPassRushers: 4.3, meanDefendersInBox: 6.4 }),
] satisfies DefenseHubPayload['tendencies']

// Verbatim from lib/idp-projections/defenseHub.ts.
const NO_CAP_NOTE =
  'No salary, contract or cap-efficiency columns: those tables have zero rows in production, ' +
  'so there is nothing to show for any league yet.'
const KICKER_NOTE =
  'Every kicker in this league is priced the same, on purpose. Measured over 4,482 kicker ' +
  'games from 2019-2025, kicker rank does not carry: year to year the correlation is negative ' +
  'in all six season pairs, and within a season it is effectively zero. Nobody can tell you ' +
  'which kicker will finish first, so we do not charge you for one.'
const TENDENCY_NOTE =
  'Opponent tendencies are facts about how a defence has been played, not a matchup grade. ' +
  'Grading them measured worse than leaving them out over 5,291 out-of-sample player-weeks.'
const unresolvedNote = (n: number) =>
  `${n} roster ${n === 1 ? 'entry is' : 'entries are'} stored in an id ` +
  'space we cannot resolve to a player, so they are not shown here.'

/** `state: 'ok'` — the normal in-season hub. */
export const defenseHubFull = {
  state: 'ok',
  projectedFor: PROJECTED_FOR,
  coverage: COVERAGE,
  defenders,
  kickers: [{ sleeperId: kickerId(MINE), name: KICKERS[MINE][0], team: KICKERS[MINE][1] }],
  kickerValue: KICKER_VALUE,
  snaps,
  roles,
  tendencies,
  notes: [NO_CAP_NOTE, unresolvedNote(1), TENDENCY_NOTE, KICKER_NOTE],
  unresolvedIds: 1,
} satisfies DefenseHubPayload

/** The loader's `EMPTY(state, notes)` shape — what every non-ok hub state sends. */
const emptyHub = (state: DefenseHubPayload['state'], notes: string[]) =>
  ({
    state,
    projectedFor: null,
    coverage: { defenders: 0, projected: 0, priced: 0 },
    defenders: [],
    kickers: [],
    kickerValue: null,
    snaps: [],
    roles: [],
    tendencies: [],
    notes,
  }) satisfies DefenseHubPayload

/** A Sleeper league whose claimed team holds no defender (only offence + a kicker). */
export const defenseHubNoDefenders = emptyHub('no_defenders', [NO_CAP_NOTE])

/** A Fantrax/MFL-style league: the roster is imported, but all 31 ids are the provider's own. */
export const defenseHubIdsUnreadable = emptyHub('ids_unreadable', [NO_CAP_NOTE, unresolvedNote(31)])

// ── GET /api/idp/players?view=trade-board ─────────────────────────────────────────────────────

const ownedBy = (owner: number) => ({ teamName: TEAMS[owner].teamName, ownerName: TEAMS[owner].ownerName, isMine: owner === MINE })

const boardRows: DefenderBoardRow[] = LEAGUE.map((p) => ({
  sleeperId: p.sleeperId,
  name: p.name,
  team: p.team,
  // shortIdpPosition of the raw spelling — so a lineman reads "DE", while his rank is a DL rank.
  position: p.position,
  value: p.value,
  vorp: p.vorp,
  projectedPoints: p.projection,
  positionRank: p.positionRank,
  valueIsFloor: p.value != null && p.value === BOARD_FLOOR,
  ownedBy: ownedBy(p.owner),
})).sort((a, b) => {
  if (a.value == null && b.value == null) return a.name.localeCompare(b.name)
  if (a.value == null) return 1
  if (b.value == null) return -1
  return b.value - a.value
})

const unpricedCount = boardRows.filter((r) => r.value == null).length

/** `state: 'ok'` — every rostered defender in the league, richest first. */
export const tradeBoardFull = {
  state: 'ok',
  projectedFor: PROJECTED_FOR,
  rows: boardRows,
  kickerValue: KICKER_VALUE,
  kickers: KICKERS.map(([name, team], owner) => ({ sleeperId: kickerId(owner), name, team, ownedBy: ownedBy(owner) })),
  coverage: COVERAGE,
  // Verbatim from lib/values/leagueDefenderBoard.ts.
  notes: [
    'These values are specific to THIS league. They come from its scoring settings and its ' +
      'starting slots, not from a market — no vendor prices individual defenders — so they are not ' +
      'comparable with a defender’s price in another league.',
    'Linebackers, linemen and defensive backs are ranked on one board. Value over replacement is ' +
      'already measured against each position’s own replacement level, which is what makes them ' +
      'comparable; ranking inside each group would price three different players at the ceiling.',
    'Every kicker in this league is worth the same, on purpose. Over 4,482 kicker games from ' +
      '2019-2025 kicker rank does not carry year to year — the correlation is negative in all six ' +
      'measured season pairs — and the startable population spans only 1.55x.',
    `${unpricedCount} ${unpricedCount === 1 ? 'defender is' : 'defenders are'} shown without a value: ` +
      'replacement level could not be established for them, which is different from being ' +
      'worth nothing.',
  ],
} satisfies LeagueDefenderBoard

// ── GET /api/idp/players?view=value-eligibility (ValuesPageLink) ──────────────────────────────

const valueEligibility = { hasIdp: true, hasKicker: true, eligible: true } satisfies ValueSurfaceEligibility

// ── Routes ────────────────────────────────────────────────────────────────────────────────────

const PATH = '/api/idp/players'
const q = (view: string) => ({ leagueId: DEFENSE_HUB_LEAGUE_ID, view })

const hubRoute = (body: DefenseHubPayload): HarnessApiRoute => ({ path: PATH, query: q('defense-hub'), body })
const boardRoute: HarnessApiRoute = { path: PATH, query: q('trade-board'), body: tradeBoardFull }
const eligibilityRoute: HarnessApiRoute = { path: PATH, query: q('value-eligibility'), body: valueEligibility }

/**
 * One route list per state the hub renders differently, keyed for `?state=`:
 *  - full            the in-season hub: your defenders, the league trade board, kickers, play table,
 *                    tendencies, "How these numbers work" with the values link.
 *  - board-error     the hub loads, the trade board's read fails (no route → 503): the board's own error
 *                    line, with everything above and below it intact — the isolation TradeBoardSection promises.
 *  - no-defenders    the blocked card: "You don't roster any defensive players yet".
 *  - ids-unreadable  the blocked card for a foreign-id league (FOREIGN_IDS_UNREADABLE).
 */
export const DEFENSE_HUB_VARIANTS: Record<string, HarnessApiRoute[]> = {
  full: [hubRoute(defenseHubFull), boardRoute, eligibilityRoute],
  'board-error': [hubRoute(defenseHubFull), eligibilityRoute],
  'no-defenders': [hubRoute(defenseHubNoDefenders), boardRoute, eligibilityRoute],
  'ids-unreadable': [hubRoute(defenseHubIdsUnreadable), eligibilityRoute],
}

/** Every /api/ answer the Defense hub needs in its normal state. */
export const DEFENSE_HUB_API: HarnessApiRoute[] = DEFENSE_HUB_VARIANTS.full
