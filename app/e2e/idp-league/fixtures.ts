/**
 * Fixture data for the IDP league-tab harness (/e2e/idp-league/<tab>?mood=<mood>). Browser-side fetch override only:
 * no route handler, no Prisma, no database.
 *
 * The reads, from the components each tab shows:
 *   GET /api/app/league/[id]/overview               IDPHome (useLeagueSectionData) — proxied to /api/league/roster
 *   GET /api/leagues/[id]/idp/config                IDPHome → IdpScoringStyleCard (`{ config }`)
 *   GET /api/idp/players?view=idp-matchup           IDPMatchupView (`IdpMatchupPayload`), on IDP and Scores
 *   GET /api/idp/players?view=roster-week           IDPTeamDashboard (`RosterWeekPayload`)
 *   GET /api/redraft/season, /api/idp/cap?type=contracts   IDPTeamDashboard's contract chips (useIdpTeamCap)
 *   GET /api/leagues/[id]/drama                     IDPHome → LeagueDramaWidget (`{ events }`)
 *   GET /api/commissioner/leagues/[id]/invite       IDPHome → ShareLeagueLinkCard (`{ joinUrl }`)
 * Writes (Chimmy's Targets, Learn more, Chimmy matchup analysis) are POSTs and get the harness's 503.
 *
 * Shapes are read from the route handlers and the loaders they call (app/api/idp/players/route.ts →
 * lib/idp-projections/idpMatchup.ts and rosterWeekPoints.ts; app/api/league/roster/route.ts; the IDP config route).
 * Typed with `satisfies` wherever the app exports the type. Harness-only.
 */
import type { HarnessApiRoute } from '../harnessApi'
import type { IdpMatchupPayload, IdpMatchupSide } from '@/lib/idp-projections/idpMatchup'
import type { RosterWeekPayload } from '@/lib/idp-projections/rosterWeekPoints'
import type { ActualWeekOutcome } from '@/lib/idp-projections/actualWeeklyPoints'
import type { IdpSalaryRecordJson } from '@/app/idp/hooks/useIdpTeamCap'
import type { PlayerMap, SlimPlayer } from '@/lib/hooks/useSleeperPlayers'

export const IDP_LEAGUE_ID = 'e2e-idp-league'
export const IDP_HARNESS_USER_ID = 'e2e-idp-league-viewer'
export const IDP_SEASON = 2026
export const IDP_WEEK = 10
const MY_ROSTER_ID = 'ckidplgroster0001'

/**
 * The tabs this harness renders (the URL segment), and the LeagueShell tab id each one is.
 *   idp    → the `idp` tab: <IDPHome leagueId />                                 (LeagueShell renderTab, case 'idp')
 *   team   → the `roster` tab: TeamTab's IDPTeamDashboard                         (TeamTab, behind `idpLeagueUi`)
 *   scores → the `scores` tab: ScoresTab's Matchups pane, <IDPMatchupView live /> (ScoresTab, behind `idpLeagueUi`)
 */
export const IDP_LEAGUE_HARNESS_TABS = ['idp', 'team', 'scores'] as const
export type IdpLeagueHarnessTab = (typeof IDP_LEAGUE_HARNESS_TABS)[number]
export const SHELL_TAB_FOR: Record<IdpLeagueHarnessTab, string> = { idp: 'idp', team: 'roster', scores: 'scores' }

/**
 * in_season:        NFL 2026, week 10, 12 teams, balanced IDP scoring; full lineup (DL DL LB LB DB DB + IDP flex),
 *                   week-10 points and a live matchup.
 * preseason:        the draft has not run: no roster, no season row, no matchup.
 * big_play_scoring: in_season, with the Big-Play-Heavy scoring preset.
 * tackle_heavy:     in_season, with the Tackle-Heavy scoring preset.
 * empty:            in season, but no defender rostered: offense only on both sides.
 */
export const IDP_LEAGUE_HARNESS_MOODS = ['in_season', 'preseason', 'big_play_scoring', 'tackle_heavy', 'empty'] as const
export type IdpLeagueHarnessMood = (typeof IDP_LEAGUE_HARNESS_MOODS)[number]

export const LONG_TEAM_NAME = 'The Blitzing Linebackers of Lower Saxony Fantasy Football Club'
export const MY_TEAM_NAME = 'Pick Six Syndicate'

export function leagueNameFor(mood: IdpLeagueHarnessMood) {
  return mood === 'preseason' ? 'Gridiron Defenders IDP' : 'Gridiron Defenders IDP League — Every Tackle Counts Edition'
}

export const isPreseason = (mood: IdpLeagueHarnessMood) => mood === 'preseason'
const hasDefenders = (mood: IdpLeagueHarnessMood) => mood !== 'empty' && mood !== 'preseason'

type P = SlimPlayer & { pts: number | null }
const pl = (id: string, name: string, position: string, team: string, pts: number | null): P => ({ id, name, position, team, pts })

/** My starters: QB RB RB WR WR TE FLEX K, then DL DL LB LB DB DB IDP-FLEX (IDPTeamDashboard's standard slot order). */
const MY_OFFENSE: P[] = [
  pl('9509', 'Jayden Daniels', 'QB', 'WAS', 24.3),
  pl('9226', 'Bijan Robinson', 'RB', 'ATL', 18.7),
  pl('8155', 'Breece Hall', 'RB', 'NYJ', null), // bye-week style: no game on file
  pl('7564', "Ja'Marr Chase", 'WR', 'CIN', 21.4),
  pl('9488', 'Jaxon Smith-Njigba', 'WR', 'SEA', 13.2),
  pl('8130', 'Trey McBride', 'TE', 'ARI', 9.8),
  pl('9493', 'Puka Nacua', 'WR', 'LAR', 16.1),
  pl('4195', 'Harrison Butker', 'K', 'KC', 8.0),
]
const MY_DEFENSE: P[] = [
  pl('7640', 'Aidan Hutchinson', 'DL', 'DET', 14.5),
  pl('6844', 'Myles Garrett', 'DL', 'CLE', 11.0),
  pl('5850', 'Fred Warner', 'LB', 'SF', 16.5),
  pl('4229', 'Roquan Smith', 'LB', 'BAL', 13.0),
  pl('8122', 'Kyle Hamilton', 'DB', 'BAL', 12.5),
  // The long player name.
  pl('90001', 'Maximilian Okonkwo-Fairweather III', 'DB', 'JAX', 6.0),
  pl('9997', 'Zack Baun', 'LB', 'PHI', null), // IDP flex; the stat line priced nothing this league scores
]
const MY_BENCH: P[] = [
  pl('8146', 'Garrett Wilson', 'WR', 'NYJ', 7.4),
  pl('9221', 'Jahmyr Gibbs', 'RB', 'DET', 19.9),
  pl('7611', 'Patrick Surtain II', 'DB', 'DEN', 4.0),
  pl('9998', 'Jack Campbell', 'LB', 'DET', 11.5),
]
const OPP: P[] = [
  pl('4984', 'Josh Allen', 'QB', 'BUF', 27.9),
  pl('4866', 'Saquon Barkley', 'RB', 'PHI', 22.6),
  pl('6794', 'Justin Jefferson', 'WR', 'MIN', 17.3),
  pl('8112', 'Drake London', 'WR', 'ATL', 11.4),
  pl('6786', 'CeeDee Lamb', 'WR', 'DAL', 15.0),
  pl('4033', 'Mark Andrews', 'TE', 'BAL', 4.2),
  pl('6011', 'T.J. Watt', 'DL', 'PIT', 12.0),
  pl('7533', 'Micah Parsons', 'DL', 'GB', 9.5),
  pl('6813', 'Bobby Okereke', 'LB', 'NYG', 15.5),
  pl('7600', 'Zaire Franklin', 'LB', 'IND', 18.0),
  pl('7570', 'Antoine Winfield Jr.', 'DB', 'TB', 10.5),
  pl('8170', 'Jessie Bates III', 'DB', 'ATL', null),
]

function myPlayers(mood: IdpLeagueHarnessMood) {
  if (isPreseason(mood)) return { starters: [] as P[], bench: [] as P[] }
  if (!hasDefenders(mood)) return { starters: MY_OFFENSE, bench: MY_BENCH.filter((p) => p.position !== 'DB' && p.position !== 'LB') }
  return { starters: [...MY_OFFENSE, ...MY_DEFENSE], bench: MY_BENCH }
}

/** The Sleeper-style player map TeamTab builds (`buildDisplayPlayerMap`) and passes to IDPTeamDashboard. */
export function playerMapFor(mood: IdpLeagueHarnessMood): PlayerMap {
  const { starters, bench } = myPlayers(mood)
  const map: PlayerMap = {}
  for (const { pts: _pts, ...p } of [...starters, ...bench]) map[p.id] = p satisfies SlimPlayer
  return map
}

/** TeamTab's `partitionRoster(payload.roster)` for this roster: starters and bench ids. */
export function lineupFor(mood: IdpLeagueHarnessMood) {
  const { starters, bench } = myPlayers(mood)
  return { starterIds: starters.map((p) => p.id), benchIds: bench.map((p) => p.id) }
}

const outcome = (p: P): ActualWeekOutcome =>
  p.pts != null
    ? { scored: true, points: p.pts, matchedKeys: 6 }
    : p.id === '9997'
      ? { scored: false, reason: 'unscored', lineKeys: 2 }
      : { scored: false, reason: 'no_game' }

const isDef = (pos: string) => ['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S'].includes(pos)

function side(rosterId: string, teamName: string, ps: P[], officialScore: number | null): IdpMatchupSide {
  const players = ps.map((p) => ({
    sleeperId: p.id, name: p.name, position: p.position, team: p.team,
    side: isDef(p.position) ? ('defense' as const) : ('offense' as const),
    points: outcome(p),
  }))
  const scored = ps.filter((p) => p.pts != null)
  return {
    rosterId, teamName, officialScore,
    ourRosterTotal: Math.round(scored.reduce((s, p) => s + (p.pts ?? 0), 0) * 100) / 100,
    scoredPlayers: scored.length, totalPlayers: ps.length, players,
  }
}

/** GET /api/idp/players?view=idp-matchup — `loadIdpMatchup`, with its one shared note and the per-side coverage notes. */
export function matchup(mood: IdpLeagueHarnessMood): IdpMatchupPayload {
  if (isPreseason(mood)) return { state: 'no_matchup', season: null, week: null, you: null, opponent: null, notes: [] }
  const { starters, bench } = myPlayers(mood)
  const opp = hasDefenders(mood) ? OPP : OPP.filter((p) => !isDef(p.position))
  // Live: Sunday afternoon of week 10, the platform's running score.
  const you = side(MY_ROSTER_ID, MY_TEAM_NAME, [...starters, ...bench], hasDefenders(mood) ? 131.6 : 96.4)
  const opponent = side('ckidplgroster0007', LONG_TEAM_NAME, opp, hasDefenders(mood) ? 127.25 : 104.8)
  const notes = [
    'The score is the platform’s own. The per-player points are ours, recomputed from stat ' +
      'lines under this league’s scoring — they cover every rostered player rather than that ' +
      'week’s starters, and we do not hold historical lineups, so they will not add up to the ' +
      'score.',
  ]
  for (const s of [you, opponent]) {
    if (s.scoredPlayers < s.totalPlayers) {
      notes.push(`${s.teamName}: priced ${s.scoredPlayers} of ${s.totalPlayers} rostered players from the stat lines we hold.`)
    }
  }
  return { state: 'ok', season: IDP_SEASON, week: IDP_WEEK, you, opponent, notes } satisfies IdpMatchupPayload
}

/** GET /api/idp/players?view=roster-week — `loadRosterWeekPoints`. */
export function rosterWeek(mood: IdpLeagueHarnessMood): RosterWeekPayload {
  if (isPreseason(mood)) return { season: null, week: null, points: {}, scored: false, reason: 'your roster has no players on file' }
  const { starters, bench } = myPlayers(mood)
  const points: Record<string, ActualWeekOutcome> = {}
  for (const p of [...starters, ...bench]) points[p.id] = outcome(p)
  return { season: IDP_SEASON, week: IDP_WEEK, points, scored: true, reason: null } satisfies RosterWeekPayload
}

/**
 * GET /api/app/league/[id]/overview → /api/league/roster's `source: 'db'` body (the fields IDPHome and its
 * SmartDataView see). `roster` is the Roster.playerData blob, which production stores as an OBJECT
 * (lib/core-app/myRoster.ts: 0 of 1,094 rows are arrays) — so IDPHome's `Array.isArray(data.roster)` reads it as empty.
 */
export function overview(mood: IdpLeagueHarnessMood) {
  const { starters, bench } = myPlayers(mood)
  return {
    source: 'db' as const,
    rosterId: MY_ROSTER_ID,
    roster: {
      players: [...starters, ...bench].map((p) => p.id),
      starters: starters.map((p) => p.id),
      taxi: [],
      reserve: [],
    },
    unifiedRoster: [...starters, ...bench].map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team })),
    faabRemaining: isPreseason(mood) ? 100 : 63,
    waiverPriority: isPreseason(mood) ? null : 7,
    sport: 'NFL',
    leagueVariant: 'idp',
    formatType: null,
    leagueWeek: isPreseason(mood) ? null : IDP_WEEK,
    maxWeek: 18,
  }
}

/** GET /api/leagues/[id]/idp/config — the IDP config route's `{ config, rosterPreview }`. */
export function idpConfig(mood: IdpLeagueHarnessMood) {
  const scoringPreset = mood === 'big_play_scoring' ? 'big_play_heavy' : mood === 'tackle_heavy' ? 'tackle_heavy' : 'balanced'
  return {
    config: {
      positionMode: 'standard', rosterPreset: 'standard', slotOverrides: null, scoringPreset, scoringOverrides: null,
      bestBallEnabled: false, draftType: 'snake', benchSlots: 7, irSlots: 2,
      settingsLockedAt: isPreseason(mood) ? null : '2026-09-01T16:00:00.000Z',
    },
    rosterPreview: null,
  }
}

/** GET /api/leagues/[id]/drama — LeagueDramaWidget's `{ events }`. */
function drama(mood: IdpLeagueHarnessMood) {
  if (isPreseason(mood)) return { events: [] }
  return {
    events: [
      {
        id: 'e2e-idp-drama-1', dramaType: 'RIVALRY', dramaScore: 82, createdAt: '2026-11-15T22:10:00.000Z',
        headline: `${MY_TEAM_NAME} and ${LONG_TEAM_NAME} meet again with first place on the line`,
        summary: 'Week 10 is the third meeting in two seasons; the last two were decided by under four points.',
      },
      {
        id: 'e2e-idp-drama-2', dramaType: 'STREAK', dramaScore: 61, createdAt: '2026-11-12T14:00:00.000Z',
        headline: 'Fred Warner has double-digit tackles in four straight weeks',
        summary: null,
      },
    ],
  }
}

/** GET /api/redraft/season — useRedraftRosterId reads `season.rosters[].ownerId`. Absent pre-draft (the route 404s). */
const season = {
  season: {
    season: IDP_SEASON, currentWeek: IDP_WEEK, totalWeeks: 17, playoffStartWeek: 15,
    rosters: [
      { id: MY_ROSTER_ID, ownerId: IDP_HARNESS_USER_ID, teamName: MY_TEAM_NAME },
      { id: 'ckidplgroster0007', ownerId: 'e2e-idp-opp', teamName: LONG_TEAM_NAME },
    ],
  },
}

/** No cap league: the six IDP cap tables are empty in production, so the contract chips render nothing. */
const contracts = { contracts: [] satisfies IdpSalaryRecordJson[] }

/** Every /api/ GET an IDP tab (and the workspace around it) makes, for this mood. First match wins. */
export function idpLeagueHarnessApi(mood: IdpLeagueHarnessMood): HarnessApiRoute[] {
  const pre = isPreseason(mood)
  return [
    { path: '/api/idp/players', query: { view: 'idp-matchup' }, body: matchup(mood) },
    { path: '/api/idp/players', query: { view: 'roster-week' }, body: rosterWeek(mood) },
    { path: `/api/app/league/${IDP_LEAGUE_ID}/overview`, body: overview(mood) },
    { path: `/api/leagues/${IDP_LEAGUE_ID}/idp/config`, body: idpConfig(mood) },
    { path: `/api/leagues/${IDP_LEAGUE_ID}/drama`, body: drama(mood) },
    { path: `/api/commissioner/leagues/${IDP_LEAGUE_ID}/invite`, body: { joinUrl: 'https://allfantasy.ai/join/E2EIDPLG' } },
    ...(pre ? [] : [{ path: '/api/redraft/season', body: season }]),
    { path: '/api/idp/cap', query: { type: 'contracts' }, body: contracts },
    // The workspace around the tab (same answers as the Big Brother harness).
    { path: `/api/commissioner/leagues/${IDP_LEAGUE_ID}/nfl-scoring`, body: { config: { presetLabel: 'PPR + IDP' } } },
    { path: '/api/subscription/entitlements', body: { hasAccess: true, entitlement: { plans: ['pro'], status: 'active' } } },
    { path: '/api/chat/unread', body: { byLeague: {} } },
    { path: '/api/core/rail-odds', body: { odds: pre ? {} : { [IDP_LEAGUE_ID]: 0.54 }, liveNow: !pre } },
    { path: '/api/guest-mode/status', body: { isGuest: false } },
  ]
}

/** Every /api/ call the harness saw and did not answer, for the verification script to read. */
export const UNANSWERED_KEY = '__idpLeagueHarnessUnanswered'

export function installIdpLeagueHarnessFetch(mood: IdpLeagueHarnessMood) {
  if (typeof window === 'undefined') return
  const w = window as typeof window & { __idpLeagueHarnessFetch?: boolean; [UNANSWERED_KEY]?: string[] }
  if (w.__idpLeagueHarnessFetch) return
  w.__idpLeagueHarnessFetch = true
  w[UNANSWERED_KEY] = []
  const routes = idpLeagueHarnessApi(mood)
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return real(input, init)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const hit =
      method === 'GET'
        ? routes.find((r) => r.path === url.pathname && Object.entries(r.query ?? {}).every(([key, v]) => url.searchParams.get(key) === v))
        : undefined
    if (hit) return new Response(JSON.stringify(hit.body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    // Unmatched, writes included: a visual harness answers nothing it was not built for.
    w[UNANSWERED_KEY]!.push(`${method} ${url.pathname}${url.search}`)
    return new Response(JSON.stringify({ error: 'Not part of this harness.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }
}
