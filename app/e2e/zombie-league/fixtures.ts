/**
 * Zombie league (in-league tab) harness fixtures (2026-11-23). A 12-team NFL Zombie league in week 10 of 17,
 * rendered by the real ZombieHome / ZombieWarRoomShortcuts inside the real NativeLeagueWorkspace, with every
 * `/api/` answer served in the browser so no request reaches a database or a provider. Labelled fixture data,
 * not real teams.
 *
 * Shapes: the summary is typed against `ZombieSummary` (components/zombie/types.ts) and its board, turn moment
 * and matchup view against the lib types. The role-workflow, ambush and season-operations bodies have no
 * exported type — they are typed against mirrors of the components' own local parsing (ZombieRoleActions,
 * ZombieSeasonOperations), copied below, so a component that changes what it reads will not be caught by the
 * typecheck here. The universe standings are typed against `UniverseRow` (lib/zombie/zombieHomeView.ts).
 *
 * The numbers are the engine's for NFL (lib/zombie/zombieRules.ts: bash and maul both 60, knife 100, bow 120,
 * axe 20, 3 serums to revive) and the summary route's 2025 policy (`beta_2025`: shares of 1). Two things a live
 * NFL board could not show and this one does, on purpose, so the layout carries every row kind:
 *   - a BASHING row: with the 2025 NFL lines at 60/60 every blowout is a mauling;
 *   - an INFECTION on the survivor mood's current, unresolved week: infections land once the week resolves.
 */
import type { HarnessApiRoute } from '../harnessApi'
import type { ZombieSummary } from '@/components/zombie/types'
import type { ZombieBoardEntry, ZombieTurnMoment } from '@/lib/zombie/zombieHomeSummary'
import type { ZombieMatchupView } from '@/lib/zombie/zombieMatchupBoard'
import type { UniverseRow } from '@/lib/zombie/zombieHomeView'

export const ZOMBIE_LEAGUE_HARNESS_TABS = ['zombie', 'war_room'] as const
export type ZombieLeagueHarnessTab = (typeof ZOMBIE_LEAGUE_HARNESS_TABS)[number]
export const ZOMBIE_LEAGUE_HARNESS_MOODS = ['survivor', 'zombie', 'turn', 'whisperer', 'preseason'] as const
export type ZombieLeagueHarnessMood = (typeof ZOMBIE_LEAGUE_HARNESS_MOODS)[number]

export const ZOMBIE_LEAGUE_ID = 'e2e-zombie-league'
export const ZOMBIE_LEAGUE_NAME = 'Outbreak Sunday'
export const ZOMBIE_TOTAL_WEEKS = 17
const WEEK = 10
const UNIVERSE_ID = 'e2e-zombie-universe'

/** r07 is the 40+ character team name; r11 has no team name, so the route falls back to its manager's name. */
const NAMES: Record<string, string> = {
  r01: 'Brainstorm Brigade', r02: 'Rotting Receivers', r03: 'The Whispering Pines', r04: 'Last Light FC',
  r05: 'Grave Diggers', r06: 'Bunker Busters', r07: 'The Undead Fantasy Football Dynasty of Ohio', r08: 'Shamblers United',
  r09: 'Night of the Living Ref', r10: 'Safe House', r11: 'Maximiliano Alejandro Thibodeaux-Fairweather', r12: 'Second Chance Serum',
}
const IDS = Object.keys(NAMES)
const LONG_MANAGER = 'Maximiliano Alejandro Thibodeaux-Fairweather'

/** Stored statuses before week 10 resolves: r03 is the Whisperer; four Zombies; r12 came back with serums. */
const BEFORE: Record<string, string> = {
  r01: 'Survivor', r02: 'Zombie', r03: 'Whisperer', r04: 'Survivor', r05: 'Zombie', r06: 'Survivor',
  r07: 'Survivor', r08: 'Zombie', r09: 'Survivor', r10: 'Survivor', r11: 'Zombie', r12: 'Survivor',
}

const NFL_RULES: NonNullable<ZombieSummary['rules']> = {
  bashingMargin: 60, maulingMargin: 60, knifeScore: 100, bowScore: 120, axeMargin: 20, reviveSerums: 3,
  winningsPolicy: 'beta_2025', bashShare: 1, maulShare: 1,
}

const CONFIG: ZombieSummary['config'] = {
  whispererSelection: 'random', infectionLossToWhisperer: true, infectionLossToZombie: true, serumReviveCount: 3, zombieTradeBlocked: true,
}

function statusLists(statuses: Record<string, string>) {
  return {
    statuses: IDS.map((rosterId) => ({ rosterId, status: statuses[rosterId]! })),
    survivors: IDS.filter((id) => statuses[id] === 'Survivor'),
    zombies: IDS.filter((id) => statuses[id] === 'Zombie'),
  }
}

function league(currentWeek: number, universeId: string | null): NonNullable<ZombieSummary['league']> {
  return {
    name: ZOMBIE_LEAGUE_NAME, sport: 'NFL', season: 2026, currentWeek, totalWeeks: ZOMBIE_TOTAL_WEEKS,
    status: currentWeek === 0 ? 'setup' : 'active', backgroundTheme: 'infested-city', teamCount: IDS.length, universeId,
  }
}

/** Week 10's board, with scores and the 2025 units each event moved. See the header for the two deliberate liberties. */
function weekBoard(victim: string, infector: string, victimScore: number, infectorScore: number): ZombieBoardEntry[] {
  return [
    { kind: 'infection', victimRosterId: victim, infectorRosterId: infector, winnerScore: infectorScore, loserScore: victimScore, amount: 6 },
    { kind: 'mauling', winnerRosterId: 'r01', loserRosterId: 'r02', margin: 71.3, winnerScore: 152.9, loserScore: 81.6, amount: 4 },
    { kind: 'bashing', winnerRosterId: 'r06', loserRosterId: 'r05', margin: 41.5, winnerScore: 133.4, loserScore: 91.9, amount: 2 },
  ]
}

const side = (rosterId: string, status: string, score: number) => ({ rosterId, name: NAMES[rosterId]!, status, score })

/** The viewer (r07, Survivor) trails the Zombie r08 in a week that is not final: at risk. */
function survivorSummary(): ZombieSummary {
  const view = {
    id: 'm-w10-r07', home: side('r07', 'Survivor', 88.4), away: side('r08', 'Zombie', 97.2), final: false, margin: 8.8,
    leader: 'away', atRisk: 'home', outcome: null, transfer: null, winningsPolicy: 'beta_2025', mySide: 'home',
  } satisfies ZombieMatchupView
  return {
    config: CONFIG,
    ...statusLists(BEFORE),
    whispererRosterId: 'r03',
    whispererHidden: false,
    week: WEEK,
    movementWatch: [],
    rosterDisplayNames: NAMES,
    myRosterId: 'r07',
    myResources: { serums: 2, weapons: 1, ambush: 0 },
    league: league(WEEK, UNIVERSE_ID),
    myStatus: 'Survivor',
    revivedRosterIds: ['r12'],
    weeklyBoard: weekBoard('r09', 'r03', 102.2, 131.6),
    myMatchup: { opponentRosterId: 'r08', opponentName: NAMES.r08!, opponentStatus: 'Zombie', myScore: 88.4, opponentScore: 97.2, final: false },
    myWinnings: { week: null, total: 18 },
    myMatchupView: view,
    lastResolvedWeek: 9,
    turnMoment: null,
    myInfections: [],
    whispererPublic: true,
    rules: NFL_RULES,
  }
}

/** Week 10 resolved: the viewer lost to the Zombie r08 and turned. `turn` adds the once-only overlay. */
function zombieSummary(withMoment: boolean): ZombieSummary {
  const after = { ...BEFORE, r07: 'Zombie', r09: 'Zombie' }
  const view = {
    id: 'm-w10-r07', home: side('r07', 'Zombie', 88.4), away: side('r08', 'Zombie', 97.2), final: true, margin: 8.8,
    leader: 'away', atRisk: null, outcome: { kind: 'infection', final: true },
    transfer: { fromRosterId: 'r07', toRosterId: 'r08', amount: 6 }, winningsPolicy: 'beta_2025', winAward: 0, mySide: 'home',
  } satisfies ZombieMatchupView
  const moment = { kind: 'turned', week: WEEK, opponentName: NAMES.r08!, myScore: 88.4, opponentScore: 97.2, key: `turned:${WEEK}` } satisfies ZombieTurnMoment
  return {
    config: CONFIG,
    ...statusLists(after),
    whispererRosterId: 'r03',
    whispererHidden: false,
    week: WEEK,
    movementWatch: [],
    rosterDisplayNames: NAMES,
    myRosterId: 'r07',
    myResources: { serums: 2, weapons: 1, ambush: 0 },
    league: league(WEEK, null),
    myStatus: 'Zombie',
    revivedRosterIds: ['r12'],
    weeklyBoard: [
      { kind: 'infection', victimRosterId: 'r07', infectorRosterId: 'r08', winnerScore: 97.2, loserScore: 88.4, amount: 6 },
      ...weekBoard('r09', 'r03', 102.2, 131.6),
    ],
    myMatchup: { opponentRosterId: 'r08', opponentName: NAMES.r08!, opponentStatus: 'Zombie', myScore: 88.4, opponentScore: 97.2, final: true },
    myWinnings: { week: -6, total: 12 },
    myMatchupView: view,
    lastResolvedWeek: WEEK,
    turnMoment: withMoment ? moment : null,
    myInfections: [],
    whispererPublic: true,
    rules: NFL_RULES,
  }
}

/** The viewer is the (secret) Whisperer, r03, who turned r09 this week; their horde is three teams. */
function whispererSummary(): ZombieSummary {
  const after = { ...BEFORE, r09: 'Zombie' }
  const view = {
    id: 'm-w10-r03', home: side('r03', 'Whisperer', 131.6), away: side('r09', 'Zombie', 102.2), final: true, margin: 29.4,
    leader: 'home', atRisk: null, outcome: { kind: 'infection', final: true },
    transfer: { fromRosterId: 'r09', toRosterId: 'r03', amount: 6 }, winningsPolicy: 'beta_2025', winAward: 0, mySide: 'home',
  } satisfies ZombieMatchupView
  return {
    config: CONFIG,
    ...statusLists(after),
    whispererRosterId: 'r03',
    whispererHidden: false,
    week: WEEK,
    movementWatch: [],
    rosterDisplayNames: NAMES,
    myRosterId: 'r03',
    myResources: { serums: 0, weapons: 2, ambush: 2 },
    league: league(WEEK, null),
    myStatus: 'Whisperer',
    revivedRosterIds: ['r12'],
    weeklyBoard: weekBoard('r09', 'r03', 102.2, 131.6),
    myMatchup: { opponentRosterId: 'r09', opponentName: NAMES.r09!, opponentStatus: 'Zombie', myScore: 131.6, opponentScore: 102.2, final: true },
    myWinnings: { week: 6, total: 41 },
    myMatchupView: view,
    lastResolvedWeek: WEEK,
    turnMoment: null,
    myInfections: ['r02', 'r05', 'r09'],
    whispererPublic: false,
    rules: NFL_RULES,
  }
}

/** Before activation: everyone is a Survivor, no Whisperer drawn yet, nothing on the board. */
function preseasonSummary(): ZombieSummary {
  const all = Object.fromEntries(IDS.map((id) => [id, 'Survivor']))
  return {
    config: CONFIG,
    ...statusLists(all),
    whispererRosterId: null,
    whispererHidden: false,
    week: 1,
    movementWatch: [],
    rosterDisplayNames: NAMES,
    myRosterId: 'r07',
    myResources: { serums: 0, weapons: 0, ambush: 0 },
    league: league(0, null),
    myStatus: 'Survivor',
    revivedRosterIds: [],
    weeklyBoard: [],
    myMatchup: null,
    myWinnings: null,
    myMatchupView: null,
    lastResolvedWeek: null,
    turnMoment: null,
    myInfections: [],
    whispererPublic: true,
    rules: NFL_RULES,
  }
}

export function zombieLeagueSummary(mood: ZombieLeagueHarnessMood): ZombieSummary {
  switch (mood) {
    case 'survivor': return survivorSummary()
    case 'zombie': return zombieSummary(false)
    case 'turn': return zombieSummary(true)
    case 'whisperer': return whispererSummary()
    case 'preseason': return preseasonSummary()
  }
}

/** Another week picked in the selector: the same league and statuses, nothing recorded for the viewer that week. */
function otherWeek(s: ZombieSummary, week: number): ZombieSummary {
  return { ...s, week, weeklyBoard: [], myMatchup: null, myMatchupView: null, myWinnings: s.myWinnings ? { week: null, total: s.myWinnings.total } : null, turnMoment: null }
}

/* ---- Role workflows (components/zombie/ZombieRoleActions.tsx — local types, mirrored) ---- */

type RoleWorkflow = { id: string; kind: string; status: string; week: number | null; deadlineAt: string | null; canRespond: boolean; choices: string[]; offerIndex?: number }
type RoleWorkflowsBody = {
  supported: boolean; owner?: boolean; canStartDraw?: boolean; canAmbush?: boolean; correctionHoldFromWeek?: number | null
  nominees?: Array<{ id: string; name: string; veteran?: boolean }>; workflows: RoleWorkflow[]
}
type AmbushPreview = { week: number; previewHash: string; remaining: number; matches: Array<{ id: string; homeRosterId: string; awayRosterId: string; homeName: string; awayName: string; locked: boolean }> }

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

function roleWorkflows(mood: ZombieLeagueHarnessMood): RoleWorkflowsBody {
  const base = { supported: true, owner: true, canStartDraw: false, canAmbush: false, correctionHoldFromWeek: null, nominees: [] }
  if (mood === 'preseason') {
    return {
      ...base,
      canStartDraw: true,
      nominees: IDS.map((id, i) => ({ id: `u-${id}`, name: id === 'r11' ? LONG_MANAGER : NAMES[id]!, veteran: i % 3 === 0 })),
      workflows: [],
    } satisfies RoleWorkflowsBody
  }
  if (mood === 'whisperer') return { ...base, canAmbush: true, workflows: [] } satisfies RoleWorkflowsBody
  if (mood === 'survivor') {
    // Week 9: the viewer bashed a fellow Survivor and decides whether to spare them (the route's survivor_bash choices).
    return {
      ...base,
      workflows: [{ id: 'wf-1', kind: 'survivor_bash', status: 'pending', week: 9, deadlineAt: inHours(30), canRespond: true, choices: ['spare', 'infect'] }],
    } satisfies RoleWorkflowsBody
  }
  return { ...base, workflows: [] } satisfies RoleWorkflowsBody
}

const AMBUSH_PAIRS: Array<[string, string, boolean]> = [
  ['r03', 'r10', false], ['r01', 'r04', true], ['r02', 'r06', false], ['r05', 'r07', false], ['r08', 'r12', false], ['r09', 'r11', false],
]
const ambushPreview = (): AmbushPreview => ({
  week: WEEK + 1,
  previewHash: 'e2e-preview',
  remaining: 2,
  matches: AMBUSH_PAIRS.map(([h, a, locked], i) => ({ id: `w11-m${i + 1}`, homeRosterId: h, awayRosterId: a, homeName: NAMES[h]!, awayName: NAMES[a]!, locked })),
})

/* ---- Season operations (components/zombie/ZombieSeasonOperations.tsx — local types, mirrored) ---- */

type SeasonOpsBody = {
  scope: string; userId: string; userNames?: Record<string, string>; season: number; canManage: boolean; denominator: string
  teams: Array<{ id: string; leagueId: string; userId: string }>; records: Array<{ id: string; kind: string; payload: Record<string, unknown> }>
}
type SportsEvidence = { sports: Array<{ sport: string; completedMatchups: number; finalizedPlayerRows: number; savedCalendarGames: number; status: string; configuredBashing: number }> }

function seasonOps(mood: ZombieLeagueHarnessMood): SeasonOpsBody {
  const me = mood === 'whisperer' ? 'u-r03' : 'u-r07'
  return {
    // The survivor mood is the one in a universe (the route scopes it `u:`, which opens proposals and votes).
    scope: mood === 'survivor' ? `u:${UNIVERSE_ID}` : `l:${ZOMBIE_LEAGUE_ID}`,
    userId: me,
    userNames: Object.fromEntries(IDS.map((id) => [`u-${id}`, id === 'r11' ? LONG_MANAGER : `${NAMES[id]} manager`])),
    season: 2026,
    canManage: true,
    denominator: 'votes_cast',
    teams: IDS.map((id) => ({ id, leagueId: ZOMBIE_LEAGUE_ID, userId: `u-${id}` })),
    records: mood === 'preseason' ? [] : [
      { id: 'oc-1', kind: 'owner_contact', payload: { userId: 'u-r11', status: 'awaiting_response', deadline: inHours(40) } },
      ...(mood === 'survivor'
        ? [{ id: 'p-1', kind: 'proposal', payload: { title: 'Serums carry over one season', text: 'Unused serums should carry into next season, capped at one, so a late revival is not wasted.', proposer: 'u-r04', secondedBy: 'u-r06', status: 'voting', deadline: inHours(20), effectiveSeason: 2027 } }]
        : []),
    ],
  }
}

const SPORTS: SportsEvidence = {
  sports: ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'].map((sport, i) => ({
    sport, completedMatchups: i === 0 ? 54 : 0, finalizedPlayerRows: i === 0 ? 1840 : 0, savedCalendarGames: i === 0 ? 272 : 0,
    status: 'acceptance_pending', configuredBashing: i === 0 ? 60 : 30,
  })),
}

/* ---- Universe standings (ZombieUniverseMap reads `standings` as UniverseRow[]) ---- */

function universeStandings(summary: ZombieSummary): { standings: UniverseRow[] } {
  const mine = summary.statuses.map((s) => ({ leagueId: ZOMBIE_LEAGUE_ID, rosterId: s.rosterId, levelId: 'beta', levelName: 'Beta', status: s.status, leagueName: ZOMBIE_LEAGUE_NAME }))
  const other = (leagueId: string, leagueName: string, levelId: string, levelName: string, zombies: number, whisperer: boolean) =>
    Array.from({ length: 12 }, (_, i) => ({
      leagueId, rosterId: `${leagueId}-r${i + 1}`, levelId, levelName, leagueName,
      status: whisperer && i === 0 ? 'Whisperer' : i <= zombies ? 'Zombie' : 'Survivor',
    }))
  return {
    standings: [
      ...other('alpha-1', 'Alpha Dead Zone', 'alpha', 'Alpha', 7, true),
      ...mine,
      ...other('beta-2', 'Quarantine Kings', 'beta', 'Beta', 3, true),
      ...other('gamma-1', 'Fresh Meat League', 'gamma', 'Gamma', 1, false),
    ],
  }
}

/**
 * Every `/api/` answer for one mood, as the shared harness route list (first match wins, query entries are
 * exact). The summary carries `?week=` once a week is picked, so each week gets its own entry ahead of the
 * path-only default; the War Room's first load has no query.
 */
export function zombieLeagueHarnessApi(mood: ZombieLeagueHarnessMood): HarnessApiRoute[] {
  const summary = zombieLeagueSummary(mood)
  const current = summary.week
  const summaryPath = `/api/leagues/${ZOMBIE_LEAGUE_ID}/zombie/summary`
  const q = { leagueId: ZOMBIE_LEAGUE_ID }
  return [
    ...Array.from({ length: ZOMBIE_TOTAL_WEEKS }, (_, i) => i + 1).map((w) => ({
      path: summaryPath, query: { week: String(w) }, body: w === current ? summary : otherWeek(summary, w),
    })),
    { path: summaryPath, body: summary },
    { path: '/api/zombie/role-workflows', query: q, body: roleWorkflows(mood) },
    { path: '/api/zombie/ambush', query: q, body: ambushPreview() },
    { path: '/api/zombie/season-operations', query: { ...q, view: 'sports' }, body: SPORTS },
    { path: '/api/zombie/season-operations', query: q, body: seasonOps(mood) },
    ...(summary.league?.universeId
      ? [{ path: `/api/zombie-universe/${summary.league.universeId}/standings`, body: universeStandings(summary) }]
      : []),
    { path: '/api/subscription/entitlements', body: { hasAccess: true, entitlement: { plans: ['pro'], status: 'active' } } },
    { path: '/api/guest-mode/status', body: { isGuest: false } },
  ]
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function matches(route: HarnessApiRoute, url: URL): boolean {
  if (route.path !== url.pathname) return false
  return Object.entries(route.query ?? {}).every(([k, v]) => url.searchParams.get(k) === v)
}

/**
 * Install once per page, synchronously, before any child effect fetches. Same-origin `/api/` GETs are answered
 * from `zombieLeagueHarnessApi(mood)`; a write, or a GET nothing matches, gets a 503 — a widget the harness did
 * not feed shows its own error state rather than reaching a route. Everything else passes through.
 */
export function installZombieLeagueHarnessFetch(mood: ZombieLeagueHarnessMood) {
  if (typeof window === 'undefined') return
  const w = window as typeof window & { __zlHarnessFetch?: boolean }
  if (w.__zlHarnessFetch) return
  w.__zlHarnessFetch = true
  const routes = zombieLeagueHarnessApi(mood)
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return real(input, init)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const hit = method === 'GET' ? routes.find((r) => matches(r, url)) : undefined
    return hit ? json(hit.body) : json({ error: 'Not part of this harness.' }, 503)
  }
}
