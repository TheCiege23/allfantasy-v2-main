/**
 * The partner front door's demo tenant (docs/os/OS_BACKBONE_PRINCIPLES.md §4, 2026-11-17).
 *
 * A sample platform with seeded leagues, so a prospect clicks around real charts before signing anything.
 * Everything here is SAMPLE DATA, labelled as such on every surface that shows it, and it never touches a
 * database: pure constants plus pure aggregation. The shapes mirror what the partner API serves
 * (`/api/v1/intelligence/leagues/[leagueId]/health`, `…/action-items`), so a signed-in portal can swap the
 * source without changing a chart.
 *
 * Customer-safe language only (B2B requirements: "Intelligence", "Assist"; never "AI").
 */

export type Tier = "strong" | "steady" | "watch" | "at_risk"
export type Workload = "light" | "standard" | "heavy"

export type DemoLeague = {
  id: string
  name: string
  sport: "NFL" | "NBA" | "MLB" | "NHL"
  format: string
  managers: number
  activeManagers: number
  /** 0–100, the league-health score the API returns. */
  health: number
  /** Share of lineups set before lock this week, 0–100. */
  lineupCompliance: number
  tradesThisSeason: number
  openActionItems: number
  commissionerWorkload: Workload
  /** Manager actions per week (lineups, claims, trades, chat), oldest → newest, eight weeks. */
  weeklyActions: readonly number[]
  risks: readonly { title: string; detail: string; severity: "elevated" | "high" }[]
  evidence: readonly { label: string; detail: string }[]
}

/** Eight weeks, labelled for the axis. */
export const DEMO_WEEKS = ["Wk 4", "Wk 5", "Wk 6", "Wk 7", "Wk 8", "Wk 9", "Wk 10", "Wk 11"] as const

export const DEMO_PLATFORM = {
  name: "Demo platform",
  note: "Sample data — a seeded demo tenant, not a real platform or real people.",
} as const

export const DEMO_LEAGUES: readonly DemoLeague[] = [
  {
    id: "iron-horse",
    name: "Iron Horse Dynasty",
    sport: "NFL",
    format: "Dynasty · Superflex",
    managers: 12,
    activeManagers: 11,
    health: 88,
    lineupCompliance: 92,
    tradesThisSeason: 7,
    openActionItems: 1,
    commissionerWorkload: "standard",
    weeklyActions: [214, 228, 241, 236, 249, 262, 255, 271],
    risks: [{ title: "One manager going quiet", detail: "Blue Ridge Bandits missed lineup deadlines two weeks running.", severity: "elevated" }],
    evidence: [
      { label: "Lineup compliance", detail: "11 of 12 teams set a lineup on time this week" },
      { label: "Trade activity", detail: "7 completed trades, above the league's 3-season average of 5" },
      { label: "Standings spread", detail: "1st to 8th place is two games apart" },
    ],
  },
  {
    id: "harbor-city",
    name: "Harbor City Redraft",
    sport: "NFL",
    format: "Redraft · PPR",
    managers: 10,
    activeManagers: 10,
    health: 91,
    lineupCompliance: 97,
    tradesThisSeason: 4,
    openActionItems: 0,
    commissionerWorkload: "light",
    weeklyActions: [168, 171, 180, 176, 183, 190, 188, 194],
    risks: [],
    evidence: [
      { label: "Lineup compliance", detail: "Every team set a lineup on time for five straight weeks" },
      { label: "Waiver activity", detail: "38 claims this season, spread across all 10 teams" },
    ],
  },
  {
    id: "summit-cap",
    name: "Summit Salary Cap",
    sport: "NFL",
    format: "Salary cap · Contracts",
    managers: 14,
    activeManagers: 12,
    health: 74,
    lineupCompliance: 84,
    tradesThisSeason: 11,
    openActionItems: 3,
    commissionerWorkload: "heavy",
    weeklyActions: [302, 296, 288, 281, 279, 270, 266, 259],
    risks: [
      { title: "Activity sliding", detail: "Weekly actions are down 14% over eight weeks.", severity: "elevated" },
      { title: "Two teams over the cap", detail: "Both need a contract move before the next deadline.", severity: "elevated" },
    ],
    evidence: [
      { label: "Cap compliance", detail: "12 of 14 teams under the cap" },
      { label: "Commissioner queue", detail: "3 open items: two cap reviews and one disputed trade" },
    ],
  },
  {
    id: "lakeshore-bb",
    name: "Lakeshore Best Ball",
    sport: "NFL",
    format: "Best ball",
    managers: 12,
    activeManagers: 12,
    health: 82,
    lineupCompliance: 100,
    tradesThisSeason: 0,
    openActionItems: 0,
    commissionerWorkload: "light",
    weeklyActions: [61, 58, 64, 60, 66, 63, 67, 70],
    risks: [],
    evidence: [{ label: "Format", detail: "Best ball sets lineups automatically, so compliance is always 100%" }],
  },
  {
    id: "prairie-guillotine",
    name: "Prairie Guillotine",
    sport: "NFL",
    format: "Guillotine",
    managers: 16,
    activeManagers: 9,
    health: 69,
    lineupCompliance: 89,
    tradesThisSeason: 2,
    openActionItems: 1,
    commissionerWorkload: "standard",
    weeklyActions: [240, 226, 210, 198, 181, 169, 152, 140],
    risks: [{ title: "Eliminated managers drift away", detail: "7 eliminated teams; 5 have not opened the league since.", severity: "elevated" }],
    evidence: [
      { label: "Format", detail: "One team is cut each week, so active managers fall by design" },
      { label: "Survivors", detail: "All 9 remaining teams set a lineup on time" },
    ],
  },
  {
    id: "blue-ridge-keepers",
    name: "Blue Ridge Keepers",
    sport: "NFL",
    format: "Keeper · 3 keepers",
    managers: 12,
    activeManagers: 8,
    health: 52,
    lineupCompliance: 67,
    tradesThisSeason: 1,
    openActionItems: 4,
    commissionerWorkload: "heavy",
    weeklyActions: [198, 182, 160, 151, 133, 120, 104, 96],
    risks: [
      { title: "Four managers inactive", detail: "No lineup, claim or message in three weeks.", severity: "high" },
      { title: "Renewal at risk", detail: "Leagues with this pattern lose a third of their managers by next season.", severity: "high" },
    ],
    evidence: [
      { label: "Lineup compliance", detail: "8 of 12 teams set a lineup this week" },
      { label: "Trade activity", detail: "1 trade this season, against a 3-season average of 6" },
    ],
  },
  {
    id: "midtown-hoops",
    name: "Midtown Hoops",
    sport: "NBA",
    format: "Points · Head to head",
    managers: 10,
    activeManagers: 9,
    health: 79,
    lineupCompliance: 88,
    tradesThisSeason: 5,
    openActionItems: 1,
    commissionerWorkload: "standard",
    weeklyActions: [142, 150, 155, 149, 158, 161, 166, 163],
    risks: [],
    evidence: [{ label: "Daily lineups", detail: "9 of 10 teams set lineups on most game days" }],
  },
  {
    id: "coastal-diamond",
    name: "Coastal Diamond",
    sport: "MLB",
    format: "Roto · 5x5",
    managers: 12,
    activeManagers: 11,
    health: 77,
    lineupCompliance: 86,
    tradesThisSeason: 9,
    openActionItems: 0,
    commissionerWorkload: "standard",
    weeklyActions: [186, 181, 190, 193, 188, 196, 199, 204],
    risks: [],
    evidence: [{ label: "Trade activity", detail: "9 trades, the most of any league on the platform" }],
  },
]

/** A league's tier from its health score — the same four bands everywhere a tier is shown. */
export function tierFor(health: number): Tier {
  if (health >= 85) return "strong"
  if (health >= 70) return "steady"
  if (health >= 60) return "watch"
  return "at_risk"
}

export const TIER_LABEL: Record<Tier, string> = {
  strong: "Strong",
  steady: "Steady",
  watch: "Watch",
  at_risk: "At risk",
}

/** Change in weekly actions from the first to the last week, as a whole percent. */
export function activityTrendPct(weeklyActions: readonly number[]): number {
  const first = weeklyActions[0]
  const last = weeklyActions[weeklyActions.length - 1]
  if (!first || last == null) return 0
  return Math.round(((last - first) / first) * 100)
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
}

export type TenantSummary = {
  leagues: number
  managers: number
  activeManagers: number
  activePct: number
  medianHealth: number
  needsAttention: number
  openActionItems: number
  /** Platform-wide weekly actions, summed across leagues, aligned to DEMO_WEEKS. */
  weeklyActions: number[]
}

/** The tiles and the platform activity line. A league "needs attention" when its tier is Watch or At risk. */
export function summarizeTenant(leagues: readonly DemoLeague[]): TenantSummary {
  const managers = leagues.reduce((n, l) => n + l.managers, 0)
  const activeManagers = leagues.reduce((n, l) => n + l.activeManagers, 0)
  const weeks = Math.max(0, ...leagues.map((l) => l.weeklyActions.length))
  const weeklyActions = Array.from({ length: weeks }, (_, i) => leagues.reduce((n, l) => n + (l.weeklyActions[i] ?? 0), 0))
  return {
    leagues: leagues.length,
    managers,
    activeManagers,
    activePct: managers ? Math.round((activeManagers / managers) * 100) : 0,
    medianHealth: median(leagues.map((l) => l.health)),
    needsAttention: leagues.filter((l) => {
      const t = tierFor(l.health)
      return t === "watch" || t === "at_risk"
    }).length,
    openActionItems: leagues.reduce((n, l) => n + l.openActionItems, 0),
    weeklyActions,
  }
}

/** Leagues ordered for the table: the ones that need attention first, then by health. */
export function leaguesByAttention(leagues: readonly DemoLeague[]): DemoLeague[] {
  const rank: Record<Tier, number> = { at_risk: 0, watch: 1, steady: 2, strong: 3 }
  return [...leagues].sort((a, b) => rank[tierFor(a.health)] - rank[tierFor(b.health)] || a.health - b.health)
}

export function findDemoLeague(id: string | null | undefined): DemoLeague | null {
  if (!id) return null
  return DEMO_LEAGUES.find((l) => l.id === id) ?? null
}

// ── What the engine recommended, and whether it helped ──────────────────────────────────────────────

export type DecisionRow = {
  kind: string
  /** Recommendations shown to managers. */
  shown: number
  /** Acted on: the manager made the recommended move. */
  actedOn: number
  /** Dismissed outright. */
  dismissed: number
  /** Acted-on recommendations whose outcome has been measured (the rest are still in play). */
  measured: number
  /** Of those measured, how many came out ahead of the alternative. */
  helped: number
  /** What "helped" means for this kind, in a sentence a partner can repeat. */
  helpedMeans: string
}

export const DEMO_DECISIONS: readonly DecisionRow[] = [
  { kind: "Start / sit", shown: 4210, actedOn: 1937, dismissed: 842, measured: 1810, helped: 1122, helpedMeans: "the started player outscored the benched one" },
  { kind: "Waiver claims", shown: 1860, actedOn: 614, dismissed: 521, measured: 540, helped: 313, helpedMeans: "the added player outscored the one dropped over the next three weeks" },
  { kind: "Trade grades", shown: 732, actedOn: 241, dismissed: 188, measured: 166, helped: 104, helpedMeans: "the side we graded higher outscored the other rest-of-season" },
  { kind: "Draft picks", shown: 2980, actedOn: 1460, dismissed: 611, measured: 1460, helped: 862, helpedMeans: "the pick outscored the next player taken at the position" },
]

/**
 * WHAT MANAGERS ACTUALLY PAY IN TRADES — the learned market, as a partner would see it for their own leagues
 * (sample numbers; the real tables are `lib/trade-market/*Learner.ts`, shown to the owner at /admin/trade-market).
 *
 * `premiumPct` is how far completed trades sit from the standard value chart: +15 = managers paid 15% more than the
 * chart says. `null` = not enough completed trades yet, so nothing is published and grades keep the standard chart —
 * the row is still shown, because "we do not know yet" is part of what a partner is buying.
 */
export type TradeMarketGroup = "Draft picks" | "Team situation" | "Roster need"
export type TradeMarketRow = {
  group: TradeMarketGroup
  label: string
  premiumPct: number | null
  /** Completed trades the number rests on. */
  trades: number
  /** Trades needed before a number is published (only read when `premiumPct` is null). */
  needed?: number
}

export const DEMO_TRADE_MARKET: readonly TradeMarketRow[] = [
  { group: "Draft picks", label: "Next draft, 1st round", premiumPct: 15, trades: 388 },
  { group: "Draft picks", label: "Next draft, 2nd round", premiumPct: 28, trades: 301 },
  { group: "Draft picks", label: "Two or more drafts out, 1st round", premiumPct: -9, trades: 164 },
  { group: "Team situation", label: "Contenders buying veterans", premiumPct: 8, trades: 210 },
  { group: "Team situation", label: "Rebuilding teams buying picks", premiumPct: 6, trades: 97 },
  { group: "Team situation", label: "Rebuilding teams buying young players", premiumPct: null, trades: 12, needed: 20 },
  { group: "Roster need", label: "Teams with an open tight end slot", premiumPct: 11, trades: 140 },
  { group: "Roster need", label: "Teams already deep at quarterback", premiumPct: -4, trades: 150 },
]

/** Rows in their groups, in the order given, plus the scale every bar shares (the largest move, at least 10%). PURE. */
export function tradeMarketView(rows: readonly TradeMarketRow[]): {
  groups: Array<{ group: TradeMarketGroup; rows: TradeMarketRow[] }>
  scalePct: number
  published: number
  tradesBehindPublished: number
} {
  const groups: Array<{ group: TradeMarketGroup; rows: TradeMarketRow[] }> = []
  for (const r of rows) {
    const g = groups.find((x) => x.group === r.group)
    if (g) g.rows.push(r)
    else groups.push({ group: r.group, rows: [r] })
  }
  const published = rows.filter((r) => r.premiumPct != null)
  const largest = published.reduce((m, r) => Math.max(m, Math.abs(r.premiumPct as number)), 0)
  return {
    groups,
    scalePct: Math.max(10, Math.ceil(largest / 5) * 5),
    published: published.length,
    tradesBehindPublished: published.reduce((n, r) => n + r.trades, 0),
  }
}

/** One row as a sentence — the bar's accessible name and the hover readout. PURE. */
export function tradeMarketSentence(r: TradeMarketRow): string {
  if (r.premiumPct == null) return `${r.label}: not enough completed trades yet (${r.trades} of ${r.needed ?? 20}), so the standard chart is used`
  if (r.premiumPct === 0) return `${r.label}: in line with the standard chart across ${r.trades.toLocaleString()} completed trades`
  return `${r.label}: paid ${Math.abs(r.premiumPct)}% ${r.premiumPct > 0 ? "more" : "less"} than the standard chart across ${r.trades.toLocaleString()} completed trades`
}

export function decisionShares(r: DecisionRow): { actedPct: number; dismissedPct: number; noResponsePct: number; helpedPct: number | null } {
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0)
  const actedPct = pct(r.actedOn, r.shown)
  const dismissedPct = pct(r.dismissed, r.shown)
  return {
    actedPct,
    dismissedPct,
    // The remainder, so the three always total 100 and the bar never over- or under-fills.
    noResponsePct: Math.max(0, 100 - actedPct - dismissedPct),
    helpedPct: r.measured > 0 ? pct(r.helped, r.measured) : null,
  }
}

// ── Data quality: partners trust a system that shows its own gaps ───────────────────────────────────

export type DataQualityRow = {
  source: string
  leagues: number
  /** Minutes since the last completed sync. */
  freshnessMinutes: number
  /** Leagues whose last sync completed in full, as a percent. */
  coveragePct: number
  /** Players matched to one canonical identity, as a percent. */
  identityPct: number
  gap: string | null
}

export const DEMO_DATA_QUALITY: readonly DataQualityRow[] = [
  { source: "Sleeper", leagues: 4, freshnessMinutes: 6, coveragePct: 100, identityPct: 99, gap: null },
  { source: "ESPN", leagues: 2, freshnessMinutes: 22, coveragePct: 100, identityPct: 97, gap: null },
  { source: "Yahoo", leagues: 1, freshnessMinutes: 41, coveragePct: 100, identityPct: 96, gap: null },
  { source: "MyFantasyLeague", leagues: 1, freshnessMinutes: 95, coveragePct: 88, identityPct: 93, gap: "One league's trade history is incomplete before 2024." },
]

export function freshnessLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min ago`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min ago` : `${h} h ago`
}

// ── How it works: the partner API, as it exists in app/api/v1 ───────────────────────────────────────

export const PARTNER_API_ENDPOINTS: readonly { method: "GET" | "POST"; path: string; what: string }[] = [
  { method: "GET", path: "/api/v1/intelligence/platform", what: "Platform summary across every league you manage" },
  { method: "GET", path: "/api/v1/intelligence/leagues/{leagueId}/health", what: "League health score, tier, risks and evidence" },
  { method: "GET", path: "/api/v1/intelligence/leagues/{leagueId}/action-items", what: "What the commissioner should look at next" },
  { method: "GET", path: "/api/v1/intelligence/leagues/{leagueId}/activity", what: "Recent league activity, newest first" },
  { method: "GET", path: "/api/v1/intelligence/leagues/{leagueId}/managers/{managerId}", what: "One manager's activity in the league (their own, or any manager for the commissioner)" },
  { method: "GET", path: "/api/v1/stories/leagues/{leagueId}/preview", what: "This week's league stories, built from real results" },
  { method: "GET", path: "/api/v1/sandbox/partner/widget-catalog", what: "Widgets your license tier can embed" },
  { method: "GET", path: "/api/v1/sandbox/partner/embed-instructions", what: "Step-by-step embed instructions per target" },
]
