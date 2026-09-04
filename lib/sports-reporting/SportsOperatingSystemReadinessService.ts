import type {
  DashboardAiToolAvailability,
  DashboardAiToolStatus,
  SportImportMatrixCell,
  SportImportMatrixRow,
} from "@/lib/admin-dashboard/SportImportMatrixService"
import type { LeagueFormatDefinition } from "@/lib/league/format-engine"
import { getLeagueFormatDefinitions } from "@/lib/league/format-engine"
import type { SportsIdentityHealthSnapshot } from "@/lib/sports-reporting/SportsIdentityHealthService"

export type SportsOsStatus = "ready" | "partial" | "missing"

export type SportsOsReadinessItem = {
  id: string
  label: string
  status: SportsOsStatus
  evidence: string[]
  gaps: string[]
  recommendation: string
}

export type SportsOsSportRow = {
  id: string
  label: string
  identityStatus: SportsOsStatus
  historicalStatus: SportsOsStatus
  currentFactsStatus: SportsOsStatus
  imageLogoStatus: SportsOsStatus
  aiGroundingStatus: SportsOsStatus
  missingData: string[]
  lastSyncedAt: string | null
}

export type SportsOsIntentRoute = {
  intent: string
  targetEngine: string
  status: SportsOsStatus
  requiredData: string[]
  tokenPolicy: string
  note: string
}

export type SportsOsLeagueFormatRow = {
  id: string
  label: string
  supportedSports: string[]
  deterministicFeatures: string[]
  premiumAiFeatures: string[]
  status: SportsOsStatus
  commissionerValue: string
}

export type SportsOperatingSystemAudit = {
  generatedAt: string
  summary: {
    ready: number
    partial: number
    missing: number
  }
  biggestDataHoles: string[]
  identityFindings: SportsOsReadinessItem[]
  historicalDataFindings: SportsOsReadinessItem[]
  imageLogoFindings: SportsOsReadinessItem[]
  fantasyValueEngine: SportsOsReadinessItem[]
  tradeAnalyzer: SportsOsReadinessItem[]
  draftAdvisor: SportsOsReadinessItem[]
  commissionerCopilot: SportsOsReadinessItem[]
  bracketIntelligence: SportsOsReadinessItem[]
  dataFreshness: SportsOsReadinessItem[]
  sports: SportsOsSportRow[]
  leagueFormats: SportsOsLeagueFormatRow[]
  chimmyIntentRoutes: SportsOsIntentRoute[]
  remainingGaps: string[]
}

const READY_IMPORT_STATUSES = new Set(["active_importer", "cached_only"])
const PARTIAL_IMPORT_STATUSES = new Set(["partial_importer", "provider_available_no_importer"])

function isReady(cell: SportImportMatrixCell | undefined): boolean {
  return Boolean(cell && READY_IMPORT_STATUSES.has(cell.status))
}

function isPartial(cell: SportImportMatrixCell | undefined): boolean {
  return Boolean(cell && (READY_IMPORT_STATUSES.has(cell.status) || PARTIAL_IMPORT_STATUSES.has(cell.status)))
}

function statusFromBooleans(ready: boolean, partial: boolean): SportsOsStatus {
  if (ready) return "ready"
  if (partial) return "partial"
  return "missing"
}

function worstStatus(items: SportsOsStatus[]): SportsOsStatus {
  if (items.includes("missing")) return "missing"
  if (items.includes("partial")) return "partial"
  return "ready"
}

function latestIso(values: Array<string | null | undefined>): string | null {
  let latest = 0
  for (const value of values) {
    if (!value) continue
    const stamp = new Date(value).getTime()
    if (Number.isFinite(stamp) && stamp > latest) latest = stamp
  }
  return latest ? new Date(latest).toISOString() : null
}

function missingCellLabels(row: SportImportMatrixRow, keys: Array<keyof SportImportMatrixRow["cells"]>): string[] {
  return keys
    .filter((key) => !isReady(row.cells[key]))
    .map((key) => row.cells[key]?.label ?? String(key))
}

function toolById(tools: DashboardAiToolAvailability[], id: string): DashboardAiToolAvailability | null {
  return tools.find((tool) => tool.id === id) ?? null
}

function toolStatus(status: DashboardAiToolStatus | undefined): SportsOsStatus {
  if (status === "active") return "ready"
  if (status === "preview") return "partial"
  return "missing"
}

// Data types the bracket-pool AI actually requires for World Cup answers.
// Players, injuries, news, playerStats, and projectionsRankings are NOT used by
// the World Cup plugin — it operates on teams + fixtures + standings + pool context.
const WORLD_CUP_AI_GROUNDING_KEYS = ["teams", "schedules", "standings"] as const satisfies Array<keyof SportImportMatrixRow["cells"]>

// Missing-data keys for the World Cup "Missing" admin column.
// We exclude players/injuries/news/playerStats/projectionsRankings because those
// are intentionally absent for the bracket product and should not show as gaps.
const WORLD_CUP_MISSING_DATA_KEYS = ["teams", "schedules", "liveScores", "standings"] as const satisfies Array<keyof SportImportMatrixRow["cells"]>

function buildSportsRows(rows: SportImportMatrixRow[]): SportsOsSportRow[] {
  return rows.map((row) => {
    const teamsReady = isReady(row.cells.teams)
    const playersReady = isReady(row.cells.players)
    const identityStatus =
      row.id === "world-cup"
        ? statusFromBooleans(teamsReady, isPartial(row.cells.teams))
        : statusFromBooleans(teamsReady && playersReady, isPartial(row.cells.teams) || isPartial(row.cells.players))
    const historicalStatus = statusFromBooleans(
      isReady(row.cells.playerStats) || isReady(row.cells.standings),
      isPartial(row.cells.playerStats) || isPartial(row.cells.standings) || isPartial(row.cells.liveScores)
    )
    const currentFactsStatus = statusFromBooleans(
      isReady(row.cells.schedules) && (isReady(row.cells.liveScores) || isReady(row.cells.standings)),
      isPartial(row.cells.schedules) || isPartial(row.cells.liveScores) || isPartial(row.cells.standings)
    )
    // World Cup teams are stored with flagUrl/crestUrl — if teams are ready, image assets are ready.
    // For other sports, team/player rows exist but live image URL health is not verified per-request,
    // so we return "partial" to reflect stored rows without confirmed live CDN availability.
    const imageLogoStatus =
      row.id === "world-cup"
        ? statusFromBooleans(teamsReady, isPartial(row.cells.teams))
        : statusFromBooleans(false, teamsReady || playersReady)

    // World Cup only tracks teams/fixtures/standings — exclude optional enrichments
    // (players, injuries, news, playerStats, projectionsRankings) so they don't
    // show as critical gaps in the admin "Missing" column.
    const missingData =
      row.id === "world-cup"
        ? missingCellLabels(row, WORLD_CUP_MISSING_DATA_KEYS)
        : missingCellLabels(row, [
            "teams",
            "players",
            "schedules",
            "liveScores",
            "standings",
            "injuries",
            "news",
            "playerStats",
            "projectionsRankings",
          ])

    // World Cup AI grounding is evaluated only on the 3 data types the bracket AI actually
    // consumes (teams, fixtures/schedules, standings).  The 6 generic sports data types
    // (players, injuries, news, playerStats, projectionsRankings, liveScores) are not used
    // by the WC plugin, so they must not push its status to "missing".
    const aiGroundingMissingCount =
      row.id === "world-cup"
        ? missingCellLabels(row, WORLD_CUP_AI_GROUNDING_KEYS).length
        : missingData.length

    const aiGroundingStatus =
      aiGroundingMissingCount === 0 ? "ready" : aiGroundingMissingCount <= 4 ? "partial" : "missing"

    return {
      id: row.id,
      label: row.label,
      identityStatus,
      historicalStatus,
      currentFactsStatus,
      imageLogoStatus,
      aiGroundingStatus,
      missingData,
      lastSyncedAt: latestIso(Object.values(row.cells).map((cell) => cell.lastSyncedAt)),
    }
  })
}

function item(input: SportsOsReadinessItem): SportsOsReadinessItem {
  return input
}

function buildPhaseItems(
  rows: SportImportMatrixRow[],
  tools: DashboardAiToolAvailability[],
  identityHealth?: SportsIdentityHealthSnapshot
): Pick<
  SportsOperatingSystemAudit,
  | "identityFindings"
  | "historicalDataFindings"
  | "imageLogoFindings"
  | "fantasyValueEngine"
  | "tradeAnalyzer"
  | "draftAdvisor"
  | "commissionerCopilot"
  | "bracketIntelligence"
  | "dataFreshness"
> {
  const sportsRows = buildSportsRows(rows)
  const identityReady = sportsRows.filter((row) => row.identityStatus === "ready").length
  const historyReady = sportsRows.filter((row) => row.historicalStatus === "ready").length
  const currentFactsReady = sportsRows.filter((row) => row.currentFactsStatus === "ready").length
  const imagePartial = sportsRows.some((row) => row.imageLogoStatus === "partial") || Boolean(identityHealth?.summary.totalPlayers)
  const trade = toolById(tools, "trade")
  const startSit = toolById(tools, "startSit")
  const power = toolById(tools, "power")
  const matchup = toolById(tools, "matchupPrep")
  const worldCup = toolById(tools, "worldCupAnalysis")
  const commissioner = toolById(tools, "commissionerReport")

  return {
    identityFindings: [
      item({
        id: "canonical-player-team-identity",
        label: "Canonical player/team identity",
        status: identityReady === rows.length ? "ready" : identityReady > 0 ? "partial" : "missing",
        evidence: [`${identityReady}/${rows.length} sport rows have usable team/player identity cache.`],
        gaps: sportsRows.filter((row) => row.identityStatus !== "ready").map((row) => `${row.label}: ${row.missingData.slice(0, 3).join(", ") || "identity incomplete"}`),
        recommendation: "Use SportsPlayer/SportsTeam/PlayerIdentityMap as the canonical identity source and block exact player answers when identity is missing.",
      }),
      item({
        id: "external-provider-mappings",
        label: "External provider mapping coverage",
        status: identityHealth ? "partial" : "missing",
        evidence: identityHealth
          ? [`Admin identity health tracks ${identityHealth.summary.identityProblems} cached identity problem(s).`]
          : ["PlayerIdentityMap exists in Prisma and provider-specific import code exists."],
        gaps: ["Per-provider mapping counts are still aggregated into problem totals instead of a full provider-by-provider grid."],
        recommendation: "Use the cached identity health panel for launch triage, then expand it into provider-specific mapping counts.",
      }),
    ],
    historicalDataFindings: [
      item({
        id: "historical-cache",
        label: "Historical sports data cache",
        status: historyReady === rows.length ? "ready" : historyReady > 0 ? "partial" : "missing",
        evidence: [`${historyReady}/${rows.length} sport rows have standings or player-stat history available.`],
        gaps: sportsRows.filter((row) => row.historicalStatus !== "ready").map((row) => `${row.label}: history/stat rows incomplete`),
        recommendation: "Prioritize player season stats, team season stats, standings, and game history imports before career-trend AI answers.",
      }),
    ],
    imageLogoFindings: [
      item({
        id: "headshots-logos",
        label: "Player headshots and team logos",
        status: imagePartial ? "partial" : "missing",
        evidence: identityHealth
          ? [`Cached image/logo health reports ${identityHealth.summary.imageProblems} metadata problem(s).`]
          : imagePartial
            ? ["Some team/player rows exist that may carry image fields."]
            : [],
        gaps: ["External HTTP image status sampling is intentionally not run from page requests."],
        recommendation: "Use cached image metadata for launch triage; run remote status sampling only from a bounded admin job.",
      }),
    ],
    fantasyValueEngine: [
      item({
        id: "value-engine",
        label: "Fantasy Value Engine",
        status: worstStatus([toolStatus(startSit?.status), toolStatus(trade?.status), toolStatus(power?.status)]),
        evidence: [
          `Start/Sit: ${startSit?.status ?? "missing"}`,
          `Trade: ${trade?.status ?? "missing"}`,
          `Power: ${power?.status ?? "missing"}`,
          "FantasyValueSnapshot contract now produces cached partial snapshots with missingData/confidence.",
        ],
        gaps: ["Not every legacy trade/draft route consumes FantasyValueSnapshot yet."],
        recommendation: "Route paid AI actions through FantasyValueSnapshot before model execution and refuse unsupported exact claims.",
      }),
    ],
    tradeAnalyzer: [
      item({
        id: "trade-analyzer",
        label: "Trade Analyzer",
        status: toolStatus(trade?.status),
        evidence: [`Admin AI tool status: ${trade?.status ?? "missing"}.`],
        gaps: trade?.missingData ?? ["players", "stats", "news"],
        recommendation: "Use FantasyValueSnapshot for cached value comparison; refuse and do not charge when critical value data is unavailable.",
      }),
    ],
    draftAdvisor: [
      item({
        id: "draft-advisor",
        label: "Draft Advisor",
        status: toolStatus(startSit?.status) === "ready" || toolStatus(power?.status) === "ready" ? "partial" : "missing",
        evidence: ["Draft room, live draft brain, ADP, and mock draft engines exist in code."],
        gaps: ["No admin-readiness row yet proves all sports have available-player pools, ADP, roster fit, and league-type scoring simultaneously."],
        recommendation: "Use FantasyValueSnapshot plus ADP/available-player context; refuse and do not charge when candidates cannot be valued.",
      }),
    ],
    commissionerCopilot: [
      item({
        id: "commissioner-copilot",
        label: "Commissioner Copilot",
        status: commissioner ? toolStatus(commissioner.status) : "partial",
        evidence: ["AI commissioner config, alerts, action logs, unified assessment, and league health engine exist."],
        gaps: commissioner?.missingData ?? ["Not all commissioner report data sources are proven per sport."],
        recommendation: "Use AF Commissioner gating for advanced reports and never send global/admin data into league-level commissioner prompts.",
      }),
    ],
    bracketIntelligence: [
      item({
        id: "bracket-intelligence",
        label: "World Cup / bracket intelligence",
        status: worldCup ? toolStatus(worldCup.status) : "missing",
        evidence: [`World Cup Analysis status: ${worldCup?.status ?? "missing"}.`, `Matchup Prep status: ${matchup?.status ?? "missing"}.`],
        gaps: worldCup?.missingData ?? ["World Cup teams", "fixtures", "standings"],
        recommendation: "Keep bracket AI on cached fixtures, standings, injuries, and user picks; future March Madness/playoff brackets need their own cached tables before AI answers.",
      }),
    ],
    dataFreshness: [
      item({
        id: "freshness-engine",
        label: "Data freshness engine",
        status: currentFactsReady === rows.length ? "ready" : currentFactsReady > 0 ? "partial" : "missing",
        evidence: [`${currentFactsReady}/${rows.length} sport rows have usable current schedule/score/standing facts.`],
        gaps: sportsRows.filter((row) => row.currentFactsStatus !== "ready").map((row) => `${row.label}: current facts incomplete`),
        recommendation: "Every user-facing AI action should check lastSyncedAt/sourceProvider/confidence and return unavailable rather than guessing.",
      }),
    ],
  }
}

function buildLeagueFormatRows(formats: LeagueFormatDefinition[]): SportsOsLeagueFormatRow[] {
  return formats.map((format) => {
    const hasDeterministic = format.capabilities.deterministicFeatures.length > 0
    const hasPremiumAi = format.capabilities.aiOptionalFeatures.length > 0
    // "ready"   = format has both deterministic automation AND AI-optional features wired
    //             (the capability is declared in the format registry and the commissioner/AI
    //              routing layer exists in the codebase)
    // "partial" = only deterministic features exist; AI upsell is not yet wired
    // "missing" = no capabilities declared at all
    const status: SportsOsStatus =
      hasDeterministic && hasPremiumAi ? "ready" : hasDeterministic ? "partial" : "missing"
    return {
      id: format.id,
      label: format.label,
      supportedSports: format.supportedSports.map(String),
      deterministicFeatures: format.capabilities.deterministicFeatures,
      premiumAiFeatures: format.capabilities.aiOptionalFeatures,
      status,
      commissionerValue: hasPremiumAi
        ? "AI features are gated behind AF Commissioner or token purchases; route all premium actions through the entitlement layer."
        : "Deterministic shell exists; premium commissioner value still needs explicit AI/report wiring.",
    }
  })
}

function buildIntentRoutes(tools: DashboardAiToolAvailability[]): SportsOsIntentRoute[] {
  const route = (
    intent: string,
    targetEngine: string,
    toolId: string | null,
    requiredData: string[],
    tokenPolicy: string,
    note: string
  ): SportsOsIntentRoute => {
    const tool = toolId ? toolById(tools, toolId) : null
    return {
      intent,
      targetEngine,
      status: toolId ? toolStatus(tool?.status) : "partial",
      requiredData,
      tokenPolicy,
      note,
    }
  }

  return [
    route("trade", "Trade Analyzer", "trade", ["identity", "roster", "scoring", "stats", "news"], "AF Pro/tokens; no charge when data unavailable.", "Existing tool availability is tracked."),
    route("draft", "Draft Advisor / Live Draft Brain", null, ["available players", "ADP", "roster needs", "league scoring"], "AF Pro/tokens for AI draft advice.", "Engines exist, but readiness is not represented as one admin tool row yet."),
    route("commissioner", "Commissioner Copilot", "commissionerReport", ["league activity", "integrity", "member activity", "pool context"], "AF Commissioner plus tokens for premium deep reports.", "Must never include global admin data in league-level prompts."),
    route("bracket", "Bracket Intelligence", "worldCupAnalysis", ["fixtures", "standings", "injuries", "user picks"], "Basic facts free; premium AI is AF Pro/tokens.", "World Cup is represented; future brackets need cached providers first."),
    route("injury", "Injury Engine", "injury", ["injuries", "player identity", "roster context"], "AF Pro/tokens for impact analysis.", "User tools should refuse stale/missing injury cache."),
    route("weather", "Weather Engine", null, ["game location", "kickoff time", "weather provider cache"], "No token charge unless provider data is available and AI is used.", "Weather provider/cache is not proven in the current admin matrix."),
    route("start_sit", "Lineup Advisor", "startSit", ["roster", "schedule", "stats/projections", "scoring"], "AF Pro/tokens for AI advice.", "Guarded by AI data availability route checks."),
  ]
}

function buildBiggestDataHoles(sports: SportsOsSportRow[], routes: SportsOsIntentRoute[]): string[] {
  const holes = new Set<string>()
  // Exclude World Cup — injuries/news/playerStats are optional enrichment for the bracket
  // product and are not tracked in the WC-specific tables. They must not inflate the
  // "Biggest Data Holes" list as critical gaps.
  const fantasyRows = sports.filter((row) => row.id !== "world-cup")
  const missingInjurySports = fantasyRows.filter((row) => row.missingData.includes("Injuries")).map((row) => row.label)
  const missingNewsSports = fantasyRows.filter((row) => row.missingData.includes("News")).map((row) => row.label)
  const missingStatsSports = fantasyRows.filter((row) => row.missingData.includes("Player stats")).map((row) => row.label)
  if (missingInjurySports.length) holes.add(`Injuries incomplete for: ${missingInjurySports.join(", ")}`)
  if (missingNewsSports.length) holes.add(`News incomplete for: ${missingNewsSports.join(", ")}`)
  if (missingStatsSports.length) holes.add(`Player stats/history incomplete for: ${missingStatsSports.join(", ")}`)
  if (routes.some((route) => route.intent === "weather" && route.status !== "ready")) holes.add("Weather engine cache/provider is not proven yet.")
  holes.add("Cross-sport image/logo verification is not fully tracked yet.")
  holes.add("Unified fantasy value output across all league types is not fully tracked yet.")
  return Array.from(holes).slice(0, 8)
}

export function buildSportsOperatingSystemAudit(input: {
  importMatrix: SportImportMatrixRow[]
  aiToolAvailability: DashboardAiToolAvailability[]
  leagueFormats?: LeagueFormatDefinition[]
  identityHealth?: SportsIdentityHealthSnapshot
}): SportsOperatingSystemAudit {
  const leagueFormats = buildLeagueFormatRows(input.leagueFormats ?? getLeagueFormatDefinitions())
  const sports = buildSportsRows(input.importMatrix)
  const phases = buildPhaseItems(input.importMatrix, input.aiToolAvailability, input.identityHealth)
  const chimmyIntentRoutes = buildIntentRoutes(input.aiToolAvailability)
  const statusList = [
    ...sports.flatMap((row) => [row.identityStatus, row.historicalStatus, row.currentFactsStatus, row.imageLogoStatus, row.aiGroundingStatus]),
    ...Object.values(phases).flat().map((row) => row.status),
    ...leagueFormats.map((row) => row.status),
    ...chimmyIntentRoutes.map((row) => row.status),
  ]

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      ready: statusList.filter((status) => status === "ready").length,
      partial: statusList.filter((status) => status === "partial").length,
      missing: statusList.filter((status) => status === "missing").length,
    },
    biggestDataHoles: buildBiggestDataHoles(sports, chimmyIntentRoutes),
    ...phases,
    sports,
    leagueFormats,
    chimmyIntentRoutes,
    remainingGaps: [
      "No automatic wrong-player/wrong-logo visual verification yet.",
      "FantasyValueSnapshot exists, but legacy trade/draft routes still need full adoption.",
      "Weather and betting/odds data are not approved as grounded user-facing sources in the current readiness matrix.",
      "Future bracket challenges need their own cache-first fixture/standings/injury tables before Chimmy can answer exact facts.",
      "Token reserve/commit/refund must remain enforced at the route wrapper level for every AI action.",
    ],
  }
}
