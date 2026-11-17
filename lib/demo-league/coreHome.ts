/**
 * The demo league, in the shape the REAL league Home (`components/core-app/screens/LeagueHome.tsx`)
 * reads — so the demo shows the app's own screen instead of a look-alike.
 *
 * 🛑 ONLY `DemoLeagueView` GOES IN. That type is the anonymity wall (fake team and manager names,
 * public seat numbers, no real ids), so nothing built here can carry a real identifier: every id is
 * `demo-<slot>`, every name is the alias already on the view. The leak suite renders the demo
 * pages and fails on any real string, and these screens go through it like every other.
 *
 * Panels the demo has no data for (your team, your matchup, the commissioner card, activity) are
 * `available: false`, which the real screen already renders as "nothing here" — the same path a
 * league with missing data takes. There is no "you" in the demo, so nothing is marked as yours.
 *
 * Pure and client-safe: the real builders used here (`buildSeasonTimeline`, `buildRedraftHomeDeck`)
 * are themselves pure, as the app's own DB-free harness relies on.
 */
import type { LeagueHomeData, LeagueStanding } from '@/lib/core-app/leagueHome'
import type { LeagueScoreboard, ScoreboardTeam } from '@/lib/core-app/leagueScoreboard'
import { buildSeasonTimeline } from '@/lib/core-app/seasonTimeline'
import { buildRedraftHomeDeck } from '@/lib/core-app/redraftLeagueHome'
import { buildDynastyHomeDeck } from '@/lib/core-app/dynastyLeagueHome'
import { resolveRedraftIdentity } from '@/lib/league-media/redraftIdentity'
import type { DemoLeagueView, DemoMatchup } from './types'

export const DEMO_CORE_LEAGUE_ID = 'demo-league'

/**
 * Home sections that only mean something to a member: "your next steps" (there is no "you"), buzz,
 * insights, draft, commissioner and franchise pairing. Hidden with the screen's own
 * `hiddenSections` — the mechanism a member uses to customize the page — never by forking it.
 */
export const DEMO_HIDDEN_HOME_SECTIONS = ['week', 'activity', 'insights', 'draft', 'commissioner', 'pairing'] as const

const off = (reason: string) => ({ available: false as const, reason })

/** Sleeper-shaped settings, which is what the real timeline and deck builders read. */
function demoSettings(view: DemoLeagueView) {
  const s = view.settings
  const regular = s.playoffStartWeek != null ? s.playoffStartWeek - 1 : 14
  return {
    sleeper_league_type: s.isDynasty ? 2 : 0,
    regular_season_length: regular,
    playoff_start_week: s.playoffStartWeek ?? regular + 1,
    trade_deadline_week: s.tradeDeadlineWeek ?? undefined,
    playoff_teams: s.playoffTeams ?? undefined,
    current_week: view.currentWeek ?? undefined,
    status: 'in_season',
  }
}

export function demoStandingsRows(view: DemoLeagueView): LeagueStanding[] {
  const teamOf = new Map(view.teams.map((t) => [t.slot, t]))
  return view.standings.map((r) => {
    const t = teamOf.get(r.slot)
    return {
      teamId: `demo-${r.slot}`,
      teamName: t?.teamName ?? `Team ${r.slot}`,
      ownerName: t?.managerName ?? '',
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      pointsFor: r.pointsFor,
      rank: r.rank,
      isYou: false,
      faabRemaining: null,
    }
  })
}

export function demoScoreboard(view: DemoLeagueView): LeagueScoreboard | null {
  if (view.currentWeek == null || view.matchups.length === 0) return null
  const teamOf = new Map(view.teams.map((t) => [t.slot, t]))
  const side = (slot: number, points: number, m: DemoMatchup): ScoreboardTeam => ({
    rosterId: `demo-${slot}`,
    teamName: teamOf.get(slot)?.teamName ?? `Team ${slot}`,
    managerName: teamOf.get(slot)?.managerName ?? null,
    avatarUrl: null,
    points: m.status === 'upcoming' ? null : points,
    projected: null,
    projectedFrom: 0,
    starterCount: 0,
    isYou: false,
  })
  const games = view.matchups.filter((m) => m.away).map((m, i) => {
    const a = side(m.home.slot, m.home.points, m)
    const b = side(m.away!.slot, m.away!.points, m)
    const played = a.points != null && b.points != null
    return { matchupId: i + 1, teams: [a, b], winProbability: null, unplayed: !played, margin: played ? Math.round(Math.abs(a.points! - b.points!) * 10) / 10 : null }
  })
  const unpaired = view.matchups.filter((m) => !m.away).map((m) => side(m.home.slot, m.home.points, m))
  return {
    seasonYear: view.settings.season,
    week: view.currentWeek,
    games,
    allUnplayed: games.every((g) => g.unplayed),
    unpaired,
    projectionBasis: null,
    unpricedReason: null,
  } as LeagueScoreboard
}

export function demoLeagueHome(view: DemoLeagueView, opts: { id?: string; format?: string; name?: string } = {}): LeagueHomeData {
  const settings = demoSettings(view)
  const standings = demoStandingsRows(view)
  const board = demoScoreboard(view)
  const format = opts.format ?? (view.settings.isDynasty ? 'dynasty' : 'redraft')
  const identity = !view.settings.isDynasty
    ? resolveRedraftIdentity({ platform: 'sleeper', sport: view.settings.sport, leagueType: 'redraft', leagueVariant: null, isDynasty: false, settings })
    : null
  const redraft = identity
    ? buildRedraftHomeDeck({ identity, settings, currentWeek: view.currentWeek, stage: 'in_season', preSeason: false, standings, board, lastWeekBoard: null } as Parameters<typeof buildRedraftHomeDeck>[0])
    : null
  // The Dynasty Era deck's season clock. Rafters, draft capital and taxi need league history the demo
  // view does not carry, so they are null — the deck draws only what it has, as for a new import.
  const dynasty = view.settings.isDynasty
    ? buildDynastyHomeDeck({
        league: { season: view.settings.season, sport: view.settings.sport, settings, platform: 'sleeper' },
        firstSeasonOnFile: null,
        rafters: null,
        outlook: null,
        taxi: null,
      })
    : null

  return {
    redraft,
    dynasty,
    pairing: null,
    calendar: [],
    league: {
      id: opts.id ?? DEMO_CORE_LEAGUE_ID,
      variant: null,
      name: opts.name ?? view.leagueName,
      platform: 'sleeper',
      canRemoveImported: false,
      format,
      sport: view.settings.sport,
      season: view.settings.season,
      currentWeek: view.currentWeek,
    },
    importCoverage: { capabilities: { rosters: true, scoring: true, matchups: true, standings: true, draft: true, trades: true, history: true }, missing: [], partial: [], sentence: null, hasGaps: false },
    yourTeam: off('The demo has no team of yours.'),
    stage: 'in_season',
    preSeason: false,
    teamDirectory: [],
    rosteredPlayerCount: view.rosters.reduce((n, r) => n + r.starters.length + r.bench.length, 0),
    weekPicker: null,
    standings: standings.length ? { available: true, data: standings } : off('No games played yet.'),
    timeline: { available: true, data: buildSeasonTimeline({ settings, currentWeek: view.currentWeek, status: 'in_season', variant: format }).phases },
    matchup: off('The demo has no team of yours.'),
    draftHq: off('Not part of the demo.'),
    commissioner: off('Not part of the demo.'),
    buzz: off('Not part of the demo.'),
    scoreboard: board ? { available: true, data: board } : off('No games this week.'),
    powerBoard: off('Not part of the demo.'),
    rivalry: off('Not part of the demo.'),
    syncAge: { label: view.lastSyncedAt ? 'recently' : 'sample data', stale: false },
    // `as unknown`: optional panels the demo leaves out are absent, which the screen treats as off.
  } as unknown as LeagueHomeData
}
