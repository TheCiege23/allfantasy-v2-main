/**
 * Deterministic sample-league generator for the per-format demos (/demo/formats/*).
 *
 * Nothing here touches the database or a provider: every league is generated from a seed
 * derived from the format id, so a given format shows the SAME sample on every visit and
 * every server (no Math.random, no Date-dependent randomness). The output is pushed
 * through the real `buildDemoLeagueView`, so standings, matchups and rosters render with
 * the same screens as the live demo.
 *
 * Players are real, public NFL athletes (the product's subject matter). Teams and managers
 * are the demo's fake aliases. College prospects for Devy/C2C are INVENTED names, because
 * naming real amateur athletes as fantasy assets in a sample is not ours to do.
 */
import { buildDemoLeagueView } from '../view'
import type { SourceSnapshot } from '../source'
import type { DemoLeagueView } from '../types'

// ── Seeded RNG ────────────────────────────────────────────────────────────────

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export type Rng = {
  next: () => number
  int: (min: number, max: number) => number
  pick: <T>(arr: readonly T[]) => T
  shuffle: <T>(arr: readonly T[]) => T[]
}

export function seededRng(seed: string): Rng {
  let a = hashSeed(seed)
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  return {
    next,
    int,
    pick: (arr) => arr[Math.floor(next() * arr.length)]!,
    shuffle: (arr) => {
      const out = [...arr]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j]!, out[i]!]
      }
      return out
    },
  }
}

// ── Player pools ──────────────────────────────────────────────────────────────

export type PoolPlayer = { name: string; position: string; team: string; age?: number }

/** Real NFL players. Positions/teams are for display only; a sample never prices them. */
export const NFL_POOL: readonly PoolPlayer[] = [
  { name: 'Josh Allen', position: 'QB', team: 'BUF', age: 30 },
  { name: 'Lamar Jackson', position: 'QB', team: 'BAL', age: 29 },
  { name: 'Jalen Hurts', position: 'QB', team: 'PHI', age: 28 },
  { name: 'Joe Burrow', position: 'QB', team: 'CIN', age: 29 },
  { name: 'Patrick Mahomes', position: 'QB', team: 'KC', age: 31 },
  { name: 'C.J. Stroud', position: 'QB', team: 'HOU', age: 25 },
  { name: 'Jayden Daniels', position: 'QB', team: 'WAS', age: 26 },
  { name: 'Kyler Murray', position: 'QB', team: 'ARI', age: 29 },
  { name: 'Justin Herbert', position: 'QB', team: 'LAC', age: 28 },
  { name: 'Baker Mayfield', position: 'QB', team: 'TB', age: 31 },
  { name: 'Brock Purdy', position: 'QB', team: 'SF', age: 27 },
  { name: 'Jordan Love', position: 'QB', team: 'GB', age: 28 },
  { name: 'Bijan Robinson', position: 'RB', team: 'ATL', age: 24 },
  { name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', age: 24 },
  { name: 'Saquon Barkley', position: 'RB', team: 'PHI', age: 29 },
  { name: 'Breece Hall', position: 'RB', team: 'NYJ', age: 25 },
  { name: "De'Von Achane", position: 'RB', team: 'MIA', age: 25 },
  { name: 'Jonathan Taylor', position: 'RB', team: 'IND', age: 27 },
  { name: 'Derrick Henry', position: 'RB', team: 'BAL', age: 32 },
  { name: 'Kyren Williams', position: 'RB', team: 'LAR', age: 26 },
  { name: 'Josh Jacobs', position: 'RB', team: 'GB', age: 28 },
  { name: 'Ashton Jeanty', position: 'RB', team: 'LV', age: 22 },
  { name: 'Bucky Irving', position: 'RB', team: 'TB', age: 24 },
  { name: 'Chase Brown', position: 'RB', team: 'CIN', age: 26 },
  { name: 'James Cook', position: 'RB', team: 'BUF', age: 27 },
  { name: 'Kenneth Walker III', position: 'RB', team: 'SEA', age: 26 },
  { name: 'Alvin Kamara', position: 'RB', team: 'NO', age: 31 },
  { name: 'Omarion Hampton', position: 'RB', team: 'LAC', age: 22 },
  { name: 'Christian McCaffrey', position: 'RB', team: 'SF', age: 30 },
  { name: 'David Montgomery', position: 'RB', team: 'DET', age: 29 },
  { name: "Ja'Marr Chase", position: 'WR', team: 'CIN', age: 26 },
  { name: 'Justin Jefferson', position: 'WR', team: 'MIN', age: 27 },
  { name: 'CeeDee Lamb', position: 'WR', team: 'DAL', age: 27 },
  { name: 'Puka Nacua', position: 'WR', team: 'LAR', age: 25 },
  { name: 'Amon-Ra St. Brown', position: 'WR', team: 'DET', age: 27 },
  { name: 'Malik Nabers', position: 'WR', team: 'NYG', age: 23 },
  { name: 'Nico Collins', position: 'WR', team: 'HOU', age: 27 },
  { name: 'Brian Thomas Jr.', position: 'WR', team: 'JAX', age: 23 },
  { name: 'A.J. Brown', position: 'WR', team: 'PHI', age: 29 },
  { name: 'Drake London', position: 'WR', team: 'ATL', age: 25 },
  { name: 'Garrett Wilson', position: 'WR', team: 'NYJ', age: 26 },
  { name: 'Tee Higgins', position: 'WR', team: 'CIN', age: 27 },
  { name: 'Ladd McConkey', position: 'WR', team: 'LAC', age: 25 },
  { name: 'Marvin Harrison Jr.', position: 'WR', team: 'ARI', age: 24 },
  { name: 'Jaxon Smith-Njigba', position: 'WR', team: 'SEA', age: 24 },
  { name: 'Tetairoa McMillan', position: 'WR', team: 'CAR', age: 22 },
  { name: 'Davante Adams', position: 'WR', team: 'LAR', age: 33 },
  { name: 'Terry McLaurin', position: 'WR', team: 'WAS', age: 31 },
  { name: 'DK Metcalf', position: 'WR', team: 'PIT', age: 28 },
  { name: 'Zay Flowers', position: 'WR', team: 'BAL', age: 26 },
  { name: 'DeVonta Smith', position: 'WR', team: 'PHI', age: 28 },
  { name: 'Rashee Rice', position: 'WR', team: 'KC', age: 26 },
  { name: 'Mike Evans', position: 'WR', team: 'TB', age: 33 },
  { name: 'George Pickens', position: 'WR', team: 'DAL', age: 25 },
  { name: 'Brock Bowers', position: 'TE', team: 'LV', age: 23 },
  { name: 'Trey McBride', position: 'TE', team: 'ARI', age: 27 },
  { name: 'Sam LaPorta', position: 'TE', team: 'DET', age: 25 },
  { name: 'George Kittle', position: 'TE', team: 'SF', age: 33 },
  { name: 'Mark Andrews', position: 'TE', team: 'BAL', age: 31 },
  { name: 'Travis Kelce', position: 'TE', team: 'KC', age: 37 },
  { name: 'Tucker Kraft', position: 'TE', team: 'GB', age: 26 },
  { name: 'Dalton Kincaid', position: 'TE', team: 'BUF', age: 27 },
  { name: 'Colston Loveland', position: 'TE', team: 'CHI', age: 22 },
  { name: 'Tyler Warren', position: 'TE', team: 'IND', age: 24 },
  { name: 'Dak Prescott', position: 'QB', team: 'DAL' },
  { name: 'Jared Goff', position: 'QB', team: 'DET' },
  { name: 'Bo Nix', position: 'QB', team: 'DEN' },
  { name: 'Caleb Williams', position: 'QB', team: 'CHI' },
  { name: 'Drake Maye', position: 'QB', team: 'NE' },
  { name: 'Trevor Lawrence', position: 'QB', team: 'JAX' },
  { name: 'Tony Pollard', position: 'RB', team: 'TEN' },
  { name: 'Aaron Jones', position: 'RB', team: 'MIN' },
  { name: 'Rhamondre Stevenson', position: 'RB', team: 'NE' },
  { name: 'Isiah Pacheco', position: 'RB', team: 'KC' },
  { name: 'Travis Etienne Jr.', position: 'RB', team: 'JAX' },
  { name: 'Brian Robinson Jr.', position: 'RB', team: 'SF' },
  { name: 'Javonte Williams', position: 'RB', team: 'DAL' },
  { name: "D'Andre Swift", position: 'RB', team: 'CHI' },
  { name: 'Jaylen Warren', position: 'RB', team: 'PIT' },
  { name: 'Tyrone Tracy Jr.', position: 'RB', team: 'NYG' },
  { name: 'Zach Charbonnet', position: 'RB', team: 'SEA' },
  { name: 'RJ Harvey', position: 'RB', team: 'DEN' },
  { name: 'Jaylen Waddle', position: 'WR', team: 'MIA' },
  { name: 'Tyreek Hill', position: 'WR', team: 'MIA' },
  { name: 'Courtland Sutton', position: 'WR', team: 'DEN' },
  { name: 'DJ Moore', position: 'WR', team: 'CHI' },
  { name: 'Jameson Williams', position: 'WR', team: 'DET' },
  { name: 'Chris Olave', position: 'WR', team: 'NO' },
  { name: 'Jordan Addison', position: 'WR', team: 'MIN' },
  { name: 'Xavier Worthy', position: 'WR', team: 'KC' },
  { name: 'Rome Odunze', position: 'WR', team: 'CHI' },
  { name: 'Khalil Shakir', position: 'WR', team: 'BUF' },
  { name: 'Jerry Jeudy', position: 'WR', team: 'CLE' },
  { name: 'Calvin Ridley', position: 'WR', team: 'TEN' },
  { name: 'Emeka Egbuka', position: 'WR', team: 'TB' },
  { name: 'Travis Hunter', position: 'WR', team: 'JAX' },
  { name: 'Jauan Jennings', position: 'WR', team: 'SF' },
  { name: 'Michael Pittman Jr.', position: 'WR', team: 'IND' },
  { name: 'David Njoku', position: 'TE', team: 'CLE' },
  { name: 'Evan Engram', position: 'TE', team: 'DEN' },
  { name: 'Jake Ferguson', position: 'TE', team: 'DAL' },
  { name: 'Kyle Pitts', position: 'TE', team: 'ATL' },
  { name: 'Dallas Goedert', position: 'TE', team: 'PHI' },
  { name: 'Hunter Henry', position: 'TE', team: 'NE' },
] as const

/** Real NFL defenders, for IDP. */
export const IDP_POOL: readonly PoolPlayer[] = [
  { name: 'Micah Parsons', position: 'LB', team: 'GB' },
  { name: 'T.J. Watt', position: 'LB', team: 'PIT' },
  { name: 'Myles Garrett', position: 'DL', team: 'CLE' },
  { name: 'Aidan Hutchinson', position: 'DL', team: 'DET' },
  { name: 'Fred Warner', position: 'LB', team: 'SF' },
  { name: 'Roquan Smith', position: 'LB', team: 'BAL' },
  { name: 'Zack Baun', position: 'LB', team: 'PHI' },
  { name: 'Bobby Wagner', position: 'LB', team: 'WAS' },
  { name: 'Foyesade Oluokun', position: 'LB', team: 'JAX' },
  { name: 'Zaire Franklin', position: 'LB', team: 'IND' },
  { name: 'Nick Bosa', position: 'DL', team: 'SF' },
  { name: 'Maxx Crosby', position: 'DL', team: 'LV' },
  { name: 'Trey Hendrickson', position: 'DL', team: 'CIN' },
  { name: 'Chris Jones', position: 'DL', team: 'KC' },
  { name: 'Will Anderson Jr.', position: 'DL', team: 'HOU' },
  { name: 'Kyle Hamilton', position: 'DB', team: 'BAL' },
  { name: 'Sauce Gardner', position: 'DB', team: 'IND' },
  { name: 'Derwin James Jr.', position: 'DB', team: 'LAC' },
  { name: 'Budda Baker', position: 'DB', team: 'ARI' },
  { name: 'Brian Branch', position: 'DB', team: 'DET' },
  { name: 'Patrick Surtain II', position: 'DB', team: 'DEN' },
  { name: 'Kerby Joseph', position: 'DB', team: 'DET' },
  { name: 'Antoine Winfield Jr.', position: 'DB', team: 'TB' },
  { name: 'Jessie Bates III', position: 'DB', team: 'ATL' },
] as const

/** INVENTED college prospects (see the header): plausible, clearly not real people. */
export const PROSPECT_POOL: readonly PoolPlayer[] = [
  { name: 'Marcus Delane (sample)', position: 'QB', team: 'Texas' },
  { name: 'Tyrese Halvorsen (sample)', position: 'QB', team: 'Ohio State' },
  { name: 'Devin Okafor (sample)', position: 'RB', team: 'Georgia' },
  { name: 'Jalen Pruitt (sample)', position: 'RB', team: 'Alabama' },
  { name: 'Cam Whitfield (sample)', position: 'RB', team: 'Oregon' },
  { name: 'Isaiah Brandt (sample)', position: 'WR', team: 'LSU' },
  { name: 'Kobe Marchetti (sample)', position: 'WR', team: 'USC' },
  { name: 'Andre Solberg (sample)', position: 'WR', team: 'Michigan' },
  { name: 'Darius Venn (sample)', position: 'WR', team: 'Miami' },
  { name: 'Eli Kwarteng (sample)', position: 'TE', team: 'Penn State' },
  { name: 'Rashad Ellery (sample)', position: 'TE', team: 'Notre Dame' },
  { name: 'Nolan Abara (sample)', position: 'QB', team: 'Clemson' },
] as const

// ── Base league ───────────────────────────────────────────────────────────────

export type SampleTeam = { key: string; slot: number; roster: PoolPlayer[] }

export type SampleBase = {
  view: DemoLeagueView
  teams: SampleTeam[]
  rng: Rng
  /** Weekly points per team key, weeks 1..scoredWeeks. */
  weekly: Map<string, number[]>
}

export type SampleOptions = {
  seed: string
  teamCount?: number
  scoredWeeks?: number
  /** Extra positions appended to each roster (e.g. IDP defenders). */
  extraPool?: readonly PoolPlayer[]
  extraPerTeam?: number
  leagueType?: string
  isDynasty?: boolean
  rosterPositions?: string[]
  scoring?: string
  /** Hide head-to-head matchups (e.g. Guillotine/Best Ball/Survivor score against the field). */
  noMatchups?: boolean
}

/** A fixed "now" so samples render identically on every visit; the page labels them as samples. */
export const SAMPLE_NOW = Date.UTC(2026, 10, 10, 18, 0, 0)

export function buildSampleBase(opts: SampleOptions): SampleBase {
  const rng = seededRng(opts.seed)
  const teamCount = opts.teamCount ?? 12
  const scoredWeeks = opts.scoredWeeks ?? 9
  const totalWeeks = scoredWeeks + 1

  // Snake-draft the pool so rosters are balanced and every player appears once.
  const pool = rng.shuffle(NFL_POOL)
  const perTeam = Math.min(Math.floor(pool.length / teamCount), 7)
  const rosters: PoolPlayer[][] = Array.from({ length: teamCount }, () => [])
  let idx = 0
  for (let round = 0; round < perTeam; round++) {
    const order = round % 2 === 0 ? [...Array(teamCount).keys()] : [...Array(teamCount).keys()].reverse()
    for (const t of order) rosters[t]!.push(pool[idx++]!)
  }
  if (opts.extraPool && opts.extraPerTeam) {
    const extra = rng.shuffle(opts.extraPool)
    let e = 0
    for (let r = 0; r < opts.extraPerTeam; r++) for (let t = 0; t < teamCount && e < extra.length; t++) rosters[t]!.push(extra[e++]!)
  }

  const teams: SampleTeam[] = rosters.map((roster, i) => ({ key: `sample-${opts.seed}-${String(i + 1).padStart(2, '0')}`, slot: i + 1, roster }))
  const strength = teams.map(() => 95 + rng.int(0, 30))
  const weekly = new Map<string, number[]>()
  for (const [i, t] of teams.entries()) {
    weekly.set(t.key, Array.from({ length: scoredWeeks }, () => Math.round((strength[i]! + rng.int(-28, 32) + rng.next()) * 10) / 10))
  }

  // Round-robin schedule (circle method). Odd counts get a bye.
  const ids = [...teams.map((t) => t.key), ...(teamCount % 2 ? ['__bye__'] : [])]
  const weekRows: SourceSnapshot['weekRows'] = []
  for (let week = 1; week <= totalWeeks; week++) {
    const rot = [ids[0]!, ...ids.slice(1).map((_, i, rest) => rest[(i + week - 1) % rest.length]!)]
    for (let m = 0; m < rot.length / 2; m++) {
      const a = rot[m]!
      const b = rot[rot.length - 1 - m]!
      if (a === '__bye__' || b === '__bye__') continue
      const pa = week <= scoredWeeks ? weekly.get(a)![week - 1]! : week === totalWeeks && m < 2 ? Math.round(rng.int(20, 70) * 10) / 10 : 0
      const pb = week <= scoredWeeks ? weekly.get(b)![week - 1]! : week === totalWeeks && m < 2 ? Math.round(rng.int(20, 70) * 10) / 10 : 0
      const ra = String(teams.findIndex((t) => t.key === a) + 1)
      const rb = String(teams.findIndex((t) => t.key === b) + 1)
      weekRows.push({ seasonYear: 2026, week, rosterId: ra, matchupId: m + 1, pointsFor: pa, pointsAgainst: pb, win: pa > pb ? 1 : 0 })
      weekRows.push({ seasonYear: 2026, week, rosterId: rb, matchupId: m + 1, pointsFor: pb, pointsAgainst: pa, win: pb > pa ? 1 : 0 })
    }
  }

  const src = {
    league: {
      id: `sample-${opts.seed}`, name: null, platform: 'allfantasy', platformLeagueId: `sample-${opts.seed}`, sport: 'NFL',
      season: 2026, scoring: opts.scoring ?? 'ppr', leagueType: opts.leagueType ?? 'redraft', isDynasty: opts.isDynasty ?? false,
      leagueSize: teamCount, starters: opts.rosterPositions ?? ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
      playoffTeams: 6, playoffStartWeek: 15, tradeDeadlineWeek: 11, waiverType: 'FAAB',
      lastSyncedAt: new Date(SAMPLE_NOW), avatarUrl: null, logoUrl: null, userId: 'sample',
    },
    teams: teams.map((t, i) => ({
      key: t.key, externalId: String(i + 1), ownerName: `sample owner ${i + 1}`, teamName: `sample team ${i + 1}`,
      avatarUrl: null, platformUserId: null, claimedByUserId: null,
      wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, currentRank: null, isOrphan: false,
    })),
    users: [],
    weekRows,
    rosters: teams.map((t) => ({
      teamKey: t.key,
      starters: t.roster.slice(0, 5).map((p) => ({ name: p.name, position: p.position, team: p.team, headshotUrl: null })),
      bench: t.roster.slice(5).map((p) => ({ name: p.name, position: p.position, team: p.team, headshotUrl: null })),
      emptyStarterSlots: 0,
    })),
    trades: [],
    openAlertHeadlines: [],
    tradeCountThisSeason: 0,
  } as unknown as SourceSnapshot

  const built = buildDemoLeagueView(src, new Map(teams.map((t, i) => [t.key, i])), new Date(SAMPLE_NOW)).view
  // A sample carries no trade history, so the health engine reads "zero trades" and raises a
  // stagnant-market alarm about a league that does not exist. Drop trade-derived notes.
  const notTrade = (t: string) => !/trade/i.test(t)
  const view = {
    ...built,
    alerts: built.alerts.filter((a) => notTrade(a.text)),
    health: built.health ? { ...built.health, strengths: built.health.strengths.filter(notTrade), problems: built.health.problems.filter(notTrade) } : null,
  }
  return {
    view: opts.noMatchups ? { ...view, matchups: [] } : view,
    teams,
    rng,
    weekly,
  }
}

/** Team name for a slot in a built sample. */
export function teamNameOf(base: SampleBase, slot: number): string {
  return base.view.teams.find((t) => t.slot === slot)?.teamName ?? `Team ${slot}`
}
