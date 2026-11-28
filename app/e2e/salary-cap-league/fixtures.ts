/**
 * Fixture data for the Salary Cap league-tab harness (/e2e/salary-cap-league/<tab>?mood=<mood>). Browser-side fetch
 * override only: no route handler, no Prisma, no database. The one read every cap view needs is
 * `GET /api/leagues/[leagueId]/salary-cap/summary`; its shape is `SalaryCapSummary` (components/salary-cap/types.ts),
 * and the derived fields (ledger, futureProjection, expiring / extension / tag counts, dead money, the contract rows'
 * `yearsRemaining`) are computed here the way app/api/leagues/[leagueId]/salary-cap/summary/route.ts and
 * lib/salary-cap/FutureCapProjectionService.ts compute them, so the screens agree with each other as they would live.
 *
 * Harness-only.
 */
import type { HarnessApiRoute } from '../harnessApi'
import type { SalaryCapSummary } from '@/components/salary-cap/types'
import { SALARY_CAP_TABS } from '@/lib/salary-cap/workspaceTabs'

export const SALARY_CAP_LEAGUE_ID = 'e2e-salary-cap-league'
/** Every LeagueShell tab that renders SalaryCapHome (lib/salary-cap/workspaceTabs.ts), Cap home included. */
export const SALARY_CAP_HARNESS_TABS = SALARY_CAP_TABS.map((t) => t.id)
/**
 * in_season: NFL 2026, week 10 of 17, under the cap with a 16-contract book, Puka Nacua tagged, four more in their final year, two cuts' dead money
 * over_cap: the same team after a $40 free-agent signing, over the cap this year
 * auction: a new native league before its startup AUCTION (the only draft type StartupAuctionView renders differently)
 * commissioner: in_season, but the league was imported from Sleeper and the viewer is its commissioner (contract upload)
 * imported: imported from Sleeper with no contracts on file — the "not in AllFantasy" note over every view
 * empty: a brand-new native league, snake startup, no contracts
 */
export const SALARY_CAP_HARNESS_MOODS = ['in_season', 'over_cap', 'auction', 'commissioner', 'imported', 'empty'] as const
export type SalaryCapHarnessMood = (typeof SALARY_CAP_HARNESS_MOODS)[number]

/** The summary route's cap year is `new Date().getFullYear()`; the harness pins the season it depicts. */
export const CAP_YEAR = 2026
const MY_ROSTER = 'r-cap-me'


type SummaryConfig = SalaryCapSummary['config']
type ContractRow = SalaryCapSummary['contracts'][number]

const BASE_CONFIG: SummaryConfig = {
  mode: 'dynasty',
  startupCap: 250,
  capGrowthPercent: 5,
  contractMinYears: 1,
  contractMaxYears: 4,
  rookieContractYears: 3,
  minimumSalary: 1,
  deadMoneyEnabled: true,
  deadMoneyPercentPerYear: 50,
  rolloverEnabled: true,
  rolloverMax: 15,
  capFloorEnabled: false,
  capFloorAmount: null,
  extensionsEnabled: true,
  franchiseTagEnabled: true,
  startupDraftType: 'snake',
  futureDraftType: 'snake_rookie_scale',
  auctionHoldback: 20,
  weightedLotteryEnabled: true,
  offseasonPhase: null,
}

/** One PlayerContract row as the route selects it; `yearsRemaining` is derived exactly as the route derives it. */
const k = (
  id: string,
  playerName: string,
  position: string,
  salary: number,
  yearsTotal: number,
  contractYear: number,
  source: string,
  status = 'active',
): ContractRow => ({
  id: `pc-${id}`,
  playerId: `nfl-${id}`,
  playerName,
  position,
  salary,
  yearsTotal,
  contractYear,
  yearsRemaining: yearsTotal - contractYear,
  status,
  source,
})

/** The in-season book: $219 of active contracts. One long name; Puka Nacua tagged; Kelce, Brown, Mayfield and McLaughlin in their final year. */
const IN_SEASON_CONTRACTS: ContractRow[] = [
  k('jchase', "Ja'Marr Chase", 'WR', 38, 4, 2, 'startup_auction'),
  k('jallen', 'Josh Allen', 'QB', 32, 4, 2, 'startup_auction'),
  k('bijan', 'Bijan Robinson', 'RB', 29, 4, 3, 'startup_auction'),
  k('nacua', 'Puka Nacua', 'WR', 22, 1, 1, 'startup_auction', 'tagged'),
  k('kelce', 'Travis Kelce', 'TE', 16, 3, 3, 'startup_auction'),
  k('aj-brown', 'A.J. Brown', 'WR', 15, 3, 3, 'startup_auction'),
  k('gibbs', 'Jahmyr Gibbs', 'RB', 14, 4, 1, 'extension'),
  k('nabers', 'Malik Nabers', 'WR', 12, 3, 2, 'rookie_draft'),
  k('long', 'Jaxon Smith-Njigba-Worthington III', 'WR', 9, 3, 1, 'waiver_bid'),
  k('bowers', 'Brock Bowers', 'TE', 7, 3, 2, 'rookie_draft'),
  k('jeanty', 'Ashton Jeanty', 'RB', 8, 3, 1, 'rookie_draft'),
  k('mcmillan', 'Tetairoa McMillan', 'WR', 5, 3, 1, 'rookie_draft'),
  k('pacheco', 'Isiah Pacheco', 'RB', 4, 2, 1, 'waiver_bid'),
  k('mayfield', 'Baker Mayfield', 'QB', 3, 2, 2, 'waiver_bid'),
  k('bucs-k', 'Chase McLaughlin', 'K', 2, 1, 1, 'waiver_bid'),
  k('ravens-def', 'Baltimore Ravens', 'DEF', 3, 2, 1, 'waiver_bid'),
]
/** The over-cap mood's one extra signing: a $40 four-year deal that tips this year and next over. */
const OVER_CAP_SIGNING = k('saquon', 'Saquon Barkley', 'RB', 40, 4, 1, 'waiver_bid')

/** Cut contracts still charging dead money; `deadMoneyRemaining` keyed by cap year, as DeadMoneyService writes it. */
const CUTS = [
  { id: 'pc-cut-cmc', playerName: 'Christian McCaffrey', position: 'RB', deadMoneyRemaining: { 2026: 7, 2027: 3.5 } },
  { id: 'pc-cut-cooks', playerName: 'Brandin Cooks', position: 'WR', deadMoneyRemaining: { 2026: 2 } },
]
const ROLLOVER_USED = 6

const DAY = 86_400_000

/** Cap hit of `contracts` in `year`: a contract counts while `year - CAP_YEAR <= yearsRemaining`. */
function capHitIn(contracts: ContractRow[], year: number) {
  return contracts.filter((c) => year - CAP_YEAR <= c.yearsRemaining).reduce((s, c) => s + c.salary, 0)
}
function deadIn(cuts: typeof CUTS, year: number) {
  return cuts.reduce((s, c) => s + ((c.deadMoneyRemaining as Record<number, number>)[year] ?? 0), 0)
}

/**
 * The route's response for a book. Ceiling grows `capGrowthPercent` a year; this year's ceiling adds rollover, as
 * FutureCapProjectionService's effectiveCap does; projectedSpace = ceiling − hit − dead.
 */
function summaryFor(opts: {
  config: SummaryConfig
  contracts: ContractRow[]
  cuts: typeof CUTS
  rollover: number
  name: string
  contractsNote?: string | null
  canImportContracts?: boolean
}): SalaryCapSummary {
  const { config, contracts, cuts, rollover } = opts
  const years = [CAP_YEAR, CAP_YEAR + 1, CAP_YEAR + 2, CAP_YEAR + 3]
  const futureProjection = years.map((y, i) => {
    const capCeiling = Math.round(config.startupCap * (1 + config.capGrowthPercent / 100) ** i * 10) / 10 + (i === 0 ? rollover : 0)
    const totalCapHit = capHitIn(contracts, y)
    const deadMoney = deadIn(cuts, y)
    return {
      capYear: y,
      capCeiling,
      totalCapHit,
      deadMoney,
      projectedSpace: Math.round((capCeiling - totalCapHit - deadMoney) * 10) / 10,
      contractCount: contracts.filter((c) => y - CAP_YEAR <= c.yearsRemaining).length,
    }
  })
  const totalCapHit = capHitIn(contracts, CAP_YEAR)
  const deadMoneyHit = deadIn(cuts, CAP_YEAR)
  const active = contracts.filter((c) => c.status === 'active' || c.status === 'tagged' || c.status === 'option_exercised')
  const finalYear = active.filter((c) => c.contractYear >= c.yearsTotal)
  const anyTagged = contracts.some((c) => c.status === 'tagged')
  return {
    config,
    myRosterId: MY_ROSTER,
    contractsNote: opts.contractsNote ?? null,
    canImportContracts: opts.canImportContracts ?? false,
    ledger: {
      rosterId: MY_ROSTER,
      capYear: CAP_YEAR,
      totalCapHit,
      deadMoneyHit,
      rolloverUsed: rollover,
      capSpace: Math.round((config.startupCap + rollover - totalCapHit - deadMoneyHit) * 10) / 10,
    },
    futureProjection,
    contracts: active,
    expiringCount: finalYear.length,
    extensionCandidatesCount: config.extensionsEnabled ? finalYear.filter((c) => c.status !== 'tagged').length : 0,
    tagCandidatesCount: config.franchiseTagEnabled && !anyTagged ? finalYear.length : 0,
    deadMoneyTotal: deadMoneyHit,
    rookieContractCount: active.filter((c) => c.source === 'rookie_draft').length,
    events: cuts.map((c, i) => ({
      eventType: 'contract_cut',
      metadata: { contractId: c.id, playerName: c.playerName },
      createdAt: new Date(Date.now() - (6 + i * 17) * DAY).toISOString(),
    })),
    lottery: null,
    league: { name: opts.name, sport: 'NFL', season: CAP_YEAR, teamCount: 12, capYear: CAP_YEAR },
    deadContracts: cuts
      .map((c) => ({ id: c.id, playerName: c.playerName, position: c.position, deadThisYear: deadIn([c], CAP_YEAR) }))
      .filter((c) => c.deadThisYear > 0),
  }
}

const IMPORTED_NOTE =
  'This league’s contracts are not in AllFantasy. It was imported from Sleeper, which does not carry salaries or contract years, so the cap space, contracts and team builder here show an empty cap, not your league’s real one.'

export function leagueNameFor(mood: SalaryCapHarnessMood) {
  return mood === 'empty' || mood === 'auction' ? 'Cap Space Rookies' : 'Contract Year Dynasty of the Greater Northeast Ohio Cap-Space Accountants'
}

export function summary(mood: SalaryCapHarnessMood): SalaryCapSummary {
  const name = leagueNameFor(mood)
  switch (mood) {
    case 'over_cap':
      return summaryFor({ config: BASE_CONFIG, contracts: [OVER_CAP_SIGNING, ...IN_SEASON_CONTRACTS], cuts: CUTS, rollover: ROLLOVER_USED, name })
    case 'auction':
      return summaryFor({ config: { ...BASE_CONFIG, startupDraftType: 'auction', offseasonPhase: 'draft' }, contracts: [], cuts: [], rollover: 0, name })
    case 'commissioner':
      // Imported, contracts on file (uploaded): the route sets no note, and canImportContracts for its commissioner.
      return summaryFor({ config: BASE_CONFIG, contracts: IN_SEASON_CONTRACTS, cuts: CUTS, rollover: ROLLOVER_USED, name, canImportContracts: true })
    case 'imported':
      return summaryFor({ config: BASE_CONFIG, contracts: [], cuts: [], rollover: 0, name, contractsNote: IMPORTED_NOTE, canImportContracts: true })
    case 'empty':
      return summaryFor({ config: BASE_CONFIG, contracts: [], cuts: [], rollover: 0, name })
    default:
      return summaryFor({ config: BASE_CONFIG, contracts: IN_SEASON_CONTRACTS, cuts: CUTS, rollover: ROLLOVER_USED, name })
  }
}

/** Every /api/ GET a cap tab makes, for this mood. First match wins (app/e2e/harnessApi.ts). */
export function salaryCapHarnessApi(mood: SalaryCapHarnessMood): HarnessApiRoute[] {
  return [
    { path: `/api/leagues/${SALARY_CAP_LEAGUE_ID}/salary-cap/summary`, body: summary(mood) },
    // NativeLeagueWorkspace's scoring chip (it reads `config.presetLabel`).
    { path: `/api/commissioner/leagues/${SALARY_CAP_LEAGUE_ID}/nfl-scoring`, body: { config: { presetLabel: 'Half PPR' } } },
    // The Cap Chimmy tab's FeatureGate (hooks/useEntitlement): an entitled viewer, so the button renders unlocked.
    { path: '/api/subscription/entitlements', body: { hasAccess: true, entitlement: { plans: ['pro'], status: 'active' } } },
    // The workspace rail's unread badges: none.
    { path: '/api/chat/unread', body: { byLeague: {} } },
    // The league list's odds bar (components/core-app/useRailOdds): a week-10 win chance in season, none before the draft.
    { path: '/api/core/rail-odds', body: { odds: mood === 'empty' || mood === 'auction' ? {} : { [SALARY_CAP_LEAGUE_ID]: 0.58 }, liveNow: false } },
    // The rail's live score poll for an imported (Sleeper) league (components/core-app/useLiveRailScores): no update yet.
    { path: '/api/core/rail-scores', query: { league: SALARY_CAP_LEAGUE_ID }, body: { updates: {}, unavailable: [] } },
    // FeatureGate's guest check on the Cap Chimmy tab.
    { path: '/api/guest-mode/status', body: { isGuest: false } },
  ]
}

/** Every /api/ call the harness saw and did not answer, for the verification script to read. */
export const UNANSWERED_KEY = '__salaryCapHarnessUnanswered'

export function installSalaryCapHarnessFetch(mood: SalaryCapHarnessMood) {
  if (typeof window === 'undefined') return
  const w = window as typeof window & { __salaryCapHarnessFetch?: boolean; [UNANSWERED_KEY]?: string[] }
  if (w.__salaryCapHarnessFetch) return
  w.__salaryCapHarnessFetch = true
  w[UNANSWERED_KEY] = []
  const routes = salaryCapHarnessApi(mood)
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
