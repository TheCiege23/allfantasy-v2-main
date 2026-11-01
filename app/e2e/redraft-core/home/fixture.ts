/**
 * Fixture data for the /core league Home harness (/e2e/redraft-core/home). Shapes only — every value
 * is invented for the screenshot and labelled as such on the harness. The redraft deck is built by the
 * REAL builder (lib/core-app/redraftLeagueHome.ts) from these fixture rows, so the harness exercises
 * the same mapping the loader runs, and the shell stamp comes from the REAL identity rule applied to a
 * fixture imported Sleeper league whose stored settings say `sleeper_league_type: 0`.
 */
import type { LeagueHomeData } from '@/lib/core-app/leagueHome'
import type { LeagueScoreboard, ScoreboardTeam } from '@/lib/core-app/leagueScoreboard'
import { buildRedraftHomeDeck } from '@/lib/core-app/redraftLeagueHome'
import { buildSeasonTimeline } from '@/lib/core-app/seasonTimeline'
import { resolveRedraftIdentity } from '@/lib/league-media/redraftIdentity'

type SportFixture = {
  sport: string
  week: number
  regular: number
  deadline: number
  spots: number
  /** Typical weekly team total, so the score bug reads like the sport. */
  scale: number
  teams: string[]
}

const FOOTBALL = ['Fourth & Long', 'Waiver Wire Wizards', 'Gridiron Ghosts', 'Bench Mob', 'Late Round QBs', 'Sunday Scaries', 'Taco Tuesday', 'The Replacements', 'Red Zone Rejects', 'Hail Mary Heroes', 'Two-Point Tries', 'Monday Night Misery']

export const SPORT_FIXTURES: Record<string, SportFixture> = {
  nfl: { sport: 'NFL', week: 9, regular: 14, deadline: 11, spots: 6, scale: 110, teams: FOOTBALL },
  ncaaf: { sport: 'NCAAF', week: 7, regular: 12, deadline: 9, spots: 4, scale: 105, teams: FOOTBALL.slice(0, 10) },
  nba: { sport: 'NBA', week: 3, regular: 19, deadline: 14, spots: 6, scale: 610, teams: ['Hardwood Heroes', 'Pick & Rollers', 'Triple Doubles', 'Full Court Press', 'Bench Mob', 'Fast Breakers', 'Glass Cleaners', 'Corner Threes', 'Sixth Men', 'The Tankers'] },
  ncaab: { sport: 'NCAAB', week: 2, regular: 16, deadline: 11, spots: 4, scale: 520, teams: ['Bracket Busters', 'Cinderella Story', 'Buzzer Beaters', 'Bench Mob', 'Final Four Fans', 'One Shining Moment', 'Bubble Teams', 'Walk-On Wonders'] },
  nhl: { sport: 'NHL', week: 4, regular: 20, deadline: 15, spots: 6, scale: 42, teams: ['Top Shelf', 'Five Hole', 'Power Play', 'Bench Mob', 'Hat Trick Heroes', 'Penalty Killers', 'The Zamboni', 'Empty Netters', 'Blue Liners', 'Sin Bin'] },
  mlb: { sport: 'MLB', week: 8, regular: 22, deadline: 16, spots: 6, scale: 210, teams: ['Moonshots', 'Bullpen Bandits', 'Seventh Inning', 'Bench Mob', 'Small Ball', 'Walk-Off Wonders', 'The Closers', 'Bases Loaded', 'Can of Corn', 'Rally Caps'] },
  soccer: { sport: 'SOCCER', week: 11, regular: 34, deadline: 22, spots: 4, scale: 62, teams: ['Top Bins', 'Park the Bus', 'False Nines', 'Bench Mob', 'Stoppage Time', 'Clean Sheets', 'The Gaffers', 'Offside Trap'] },
}

/** Deterministic pseudo-random in [0,1), so every run shoots the same frame. */
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

function boardFor(f: SportFixture, week: number, scored: boolean, seed: number): LeagueScoreboard {
  const r = rng(seed)
  const team = (i: number): ScoreboardTeam => {
    const pts = Math.round(f.scale * (0.72 + r() * 0.56) * 10) / 10
    return {
      rosterId: String(i + 1),
      teamName: f.teams[i],
      managerName: null,
      avatarUrl: null,
      points: scored ? pts : null,
      projected: scored ? null : Math.round(f.scale * (0.9 + r() * 0.2) * 10) / 10,
      projectedFrom: 9,
      starterCount: 9,
      isYou: i === 0,
    }
  }
  const games = []
  for (let i = 0; i + 1 < f.teams.length; i += 2) {
    const a = team(i)
    const b = team(i + 1)
    games.push({
      matchupId: i / 2 + 1,
      teams: [a, b],
      winProbability: scored ? null : 0.64,
      unplayed: !scored,
      margin: scored && a.points != null && b.points != null ? Math.abs(a.points - b.points) : null,
    })
  }
  return { seasonYear: 2026, week, games, allUnplayed: !scored, unpaired: [], projectionBasis: null, unpricedReason: null }
}

export function homeFixture(sportKey: string, opts: { identity: boolean; leagueType?: string }): {
  data: LeagueHomeData
  redraftSport: ReturnType<typeof resolveRedraftIdentity>
} {
  const f = SPORT_FIXTURES[sportKey] ?? SPORT_FIXTURES.nfl
  const settings = {
    sleeper_league_type: opts.leagueType && opts.leagueType !== 'redraft' ? 2 : 0,
    regular_season_length: f.regular,
    playoff_start_week: f.regular + 1,
    trade_deadline_week: f.deadline,
    playoff_teams: f.spots,
    current_week: f.week,
    status: 'in_season',
  }
  const league = {
    platform: 'sleeper',
    sport: f.sport,
    leagueType: opts.leagueType ?? 'redraft',
    leagueVariant: null,
    isDynasty: opts.leagueType === 'dynasty',
    settings,
  }
  const identity = opts.identity ? resolveRedraftIdentity(league) : null
  const played = f.week - 1
  const standings = f.teams.map((teamName, i) => {
    // The viewer sits fourth: inside the line, close to it.
    const order = [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11][i] ?? i
    const wins = Math.max(0, played - Math.round((order * played) / (f.teams.length - 1)))
    return {
      teamId: `t${i + 1}`,
      teamName,
      ownerName: teamName,
      wins,
      losses: played - wins,
      ties: 0,
      pointsFor: Math.round((f.scale * played * (1.1 - order * 0.03)) * 10) / 10,
      rank: order + 1,
      isYou: i === 0,
      faabRemaining: null,
    }
  })
  const board = boardFor(f, f.week, false, 7)
  const lastWeek = boardFor(f, f.week - 1, true, 11)
  const redraft = identity
    ? buildRedraftHomeDeck({
        identity,
        settings,
        currentWeek: f.week,
        stage: 'in_season',
        preSeason: false,
        standings,
        board,
        lastWeekBoard: lastWeek,
      })
    : null
  const you = standings[0]
  const opp = standings[1]
  const off = { available: false as const, reason: 'not in this harness fixture' }
  const data = {
    redraft,
    pairing: null,
    calendar: [],
    league: { id: 'e2e-redraft-core-home', variant: null, name: 'Sunday Night Redraft', platform: 'sleeper', canRemoveImported: false, format: 'redraft', sport: f.sport, season: 2026, currentWeek: f.week },
    importCoverage: { capabilities: { rosters: true, scoring: true, matchups: true, standings: true, draft: true, trades: true, history: true }, missing: [], partial: [], sentence: null, hasGaps: false },
    yourTeam: { available: true, data: { teamName: you.teamName, record: `${you.wins}-${you.losses}`, rank: you.rank, pointsFor: you.pointsFor } },
    stage: 'in_season',
    preSeason: false,
    teamDirectory: [],
    rosteredPlayerCount: 180,
    weekPicker: { weeks: Array.from({ length: f.regular }, (_, i) => i + 1), selected: f.week, current: f.week, isFuture: false },
    standings: { available: true, data: standings },
    timeline: { available: true, data: buildSeasonTimeline({ settings, currentWeek: f.week, status: 'in_season', variant: 'redraft' }).phases },
    matchup: { available: true, data: { week: f.week, season: 2026, you: { name: you.teamName, points: 0 }, opponent: { name: opp.teamName, points: 0 }, winProbability: null } },
    draftHq: off,
    commissioner: off,
    buzz: off,
    scoreboard: { available: true, data: board },
    powerBoard: off,
    rivalry: off,
    syncAge: { label: 'just now', stale: false },
  } as unknown as LeagueHomeData
  return { data, redraftSport: identity }
}
