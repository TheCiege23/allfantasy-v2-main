import type { ChimmyIntent } from "@/lib/chimmy-context/intent/IntentClassifier"
import type { ChimmyContextBundle } from "@/lib/chimmy-context/types"

export const CHIMMY_STRUCTURED_PROMPT_PAYLOAD_SCHEMA =
  "chimmy_nfl_ncaaf_prompt_payload_v1"

export const CHIMMY_MISSING_LIVE_DATA_MESSAGE =
  "I don't have live data for that yet."

export type ChimmyAnswerMode =
  | "draft_advice"
  | "start_sit"
  | "waiver_advice"
  | "trade_advice"
  | "commissioner_rules"
  | "league_summary"
  | "player_comparison"
  | "injury_news_explanation"
  | "ncaaf_devy_prospect_advice"
  | "live_schedule"
  | "current_score"

export type ChimmyStructuredPayloadSport = "NFL" | "NCAAF"

export type ChimmyPayloadFieldKey =
  | "league"
  | "userTeam"
  | "roster"
  | "scoringSettings"
  | "standings"
  | "schedule"
  | "draftState"
  | "availablePlayers"
  | "projections"
  | "injuries"
  | "recentStats"

export type ChimmyPayloadFreshnessStatus =
  | "fresh"
  | "missing"
  | "stale"
  | "unknown"

export type ChimmySourceFreshnessEntry = {
  status: ChimmyPayloadFreshnessStatus
  source: string
  updatedAt: string | null
  detail?: string
}

export type ChimmyStructuredPromptPayload = {
  schemaVersion: typeof CHIMMY_STRUCTURED_PROMPT_PAYLOAD_SCHEMA
  sport: ChimmyStructuredPayloadSport
  answerMode: ChimmyAnswerMode
  league: Record<string, unknown> | null
  userTeam: Record<string, unknown> | null
  roster: Record<string, unknown> | null
  scoringSettings: Record<string, unknown> | null
  standings: Array<Record<string, unknown>> | null
  schedule: Array<Record<string, unknown>> | null
  draftState: Record<string, unknown> | null
  availablePlayers: Array<Record<string, unknown>> | null
  projections: Record<string, unknown> | null
  injuries: Array<Record<string, unknown>> | null
  recentStats: Array<Record<string, unknown>> | null
  sourceFreshness: Record<ChimmyPayloadFieldKey, ChimmySourceFreshnessEntry>
  allowedActions: ChimmyAnswerMode[]
  missingData: ChimmyPayloadFieldKey[]
  staleData: ChimmyPayloadFieldKey[]
  blockedActions: ChimmyAnswerMode[]
  responsePolicy: {
    shouldFallback: boolean
    fallbackMessage: typeof CHIMMY_MISSING_LIVE_DATA_MESSAGE
    reason: string | null
    requiredFields: ChimmyPayloadFieldKey[]
    missingRequiredFields: ChimmyPayloadFieldKey[]
    staleRequiredFields: ChimmyPayloadFieldKey[]
    guardrails: string[]
  }
}

export type BuildStructuredPayloadOptions = {
  sport?: string | null
  message?: string | null
  history?: Array<{ role: "user" | "assistant" | string; content: string }>
  intent?: ChimmyIntent | null
}

export type BuildStructuredPayloadFromLooseContextOptions =
  BuildStructuredPayloadOptions & {
    leagueSettings?: Record<string, unknown> | null
    deterministicContext?: Record<string, unknown> | null
    statisticsPayload?: Record<string, unknown> | null
  }

const PAYLOAD_FIELD_KEYS: ChimmyPayloadFieldKey[] = [
  "league",
  "userTeam",
  "roster",
  "scoringSettings",
  "standings",
  "schedule",
  "draftState",
  "availablePlayers",
  "projections",
  "injuries",
  "recentStats",
]

const ALL_ANSWER_MODES: ChimmyAnswerMode[] = [
  "draft_advice",
  "start_sit",
  "waiver_advice",
  "trade_advice",
  "commissioner_rules",
  "league_summary",
  "player_comparison",
  "injury_news_explanation",
  "ncaaf_devy_prospect_advice",
  "live_schedule",
  "current_score",
]

const REQUIRED_FIELDS_BY_MODE: Record<ChimmyAnswerMode, ChimmyPayloadFieldKey[]> = {
  draft_advice: ["league", "scoringSettings", "draftState", "availablePlayers", "projections"],
  start_sit: ["league", "userTeam", "roster", "scoringSettings", "projections"],
  waiver_advice: ["league", "roster", "scoringSettings", "availablePlayers", "projections"],
  trade_advice: ["league", "roster", "scoringSettings", "projections", "recentStats"],
  commissioner_rules: ["league", "scoringSettings"],
  league_summary: [],
  player_comparison: ["league", "scoringSettings", "projections", "recentStats"],
  injury_news_explanation: ["injuries"],
  ncaaf_devy_prospect_advice: [
    "league",
    "scoringSettings",
    "availablePlayers",
    "projections",
    "recentStats",
  ],
  live_schedule: ["schedule"],
  current_score: ["schedule"],
}

const FRESH_REQUIRED_MODES = new Set<ChimmyAnswerMode>([
  "draft_advice",
  "start_sit",
  "waiver_advice",
  "trade_advice",
  "player_comparison",
  "injury_news_explanation",
  "ncaaf_devy_prospect_advice",
  "live_schedule",
  "current_score",
])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null
  const rows = value.filter((item): item is Record<string, unknown> => {
    return Boolean(item && typeof item === "object" && !Array.isArray(item))
  })
  return rows.length > 0 ? rows : null
}

function hasUsableValue(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === "string") return value.trim().length > 0
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value === "boolean") return true
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0
  return false
}

function normalizeStructuredSport(sport: string | null | undefined): ChimmyStructuredPayloadSport | null {
  const normalized = String(sport ?? "").trim().toUpperCase().replace(/[-\s]+/g, "_")
  if (normalized === "NFL") return "NFL"
  if (
    normalized === "NCAAF" ||
    normalized === "COLLEGE_FOOTBALL" ||
    normalized === "COLLEGEFOOTBALL" ||
    normalized === "DEVY" ||
    normalized === "C2C" ||
    normalized === "CAMPUS_TO_CANTON"
  ) {
    return "NCAAF"
  }
  return null
}

export function isNflNcaafChimmySport(sport: string | null | undefined): boolean {
  return normalizeStructuredSport(sport) != null
}

function compactRecord(value: Record<string, unknown> | null, maxKeys = 18): Record<string, unknown> | null {
  if (!value) return null
  const entries = Object.entries(value).slice(0, maxKeys)
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

function compactRows(
  value: Array<Record<string, unknown>> | null,
  maxRows = 25,
  maxKeys = 12
): Array<Record<string, unknown>> | null {
  if (!value?.length) return null
  return value.slice(0, maxRows).map((row) => compactRecord(row, maxKeys) ?? {})
}

function buildModeText(input: BuildStructuredPayloadOptions): string {
  const history = (input.history ?? [])
    .slice(-3)
    .map((h) => h.content)
    .join(" ")
  return `${input.message ?? ""} ${history}`.trim()
}

export function classifyChimmyAnswerMode(input: BuildStructuredPayloadOptions): ChimmyAnswerMode {
  const text = buildModeText(input)

  if (/\b(current|live|latest)?\s*(score|scores)|\bscoreboard\b|\bfinal\s+score\b|\bwho\s+(won|is\s+winning)\b/i.test(text)) {
    return "current_score"
  }
  if (/\bschedule\b|\bkickoff\b|\bgame\s+time\b|\bwhen\s+(do|does|is|are)\b|\bwho\s+(do|does|is|are).*\b(play|playing)\b|\bopponent\b|\bbye\s+week\b/i.test(text)) {
    return "live_schedule"
  }
  if (/\b(devy|c2c|campus\s+to\s+canton|college\s+football|ncaaf|prospect)\b/i.test(text)) {
    return "ncaaf_devy_prospect_advice"
  }
  if (/\binjur(?:y|ies|ed)|\bquestionable\b|\bdoubtful\b|\binactives?\b|\bnews\b/i.test(text)) {
    return "injury_news_explanation"
  }
  if (/\bstart\b.*\bsit\b|\bsit\b.*\bstart\b|\bstart\/sit\b|\blineup\b|\bflex\b/i.test(text)) {
    return "start_sit"
  }
  if (/\bwaiver|waivers|faab|free[-\s]?agent|pickup|add\/drop|\bdrop\b/i.test(text)) {
    return "waiver_advice"
  }
  if (/\btrade|trading|offer|counter[-\s]?offer|buy[-\s]?low|sell[-\s]?high|swap\b/i.test(text)) {
    return "trade_advice"
  }
  if (/\bdraft|mock\s+draft|rookie\s+draft|pick\s+\d|\bwar\s+room\b/i.test(text)) {
    return "draft_advice"
  }
  if (/\bcommissioner|commish|rules?|settings?|veto|trade\s+deadline|waiver\s+rules?\b/i.test(text)) {
    return "commissioner_rules"
  }
  if (/\bcompare|comparison|\bvs\.?\b|better|who\s+should\s+i\b/i.test(text)) {
    return "player_comparison"
  }
  if (/\bsummary|summarize|recap|standings|league\s+overview|how\s+am\s+i\s+doing\b/i.test(text)) {
    return "league_summary"
  }

  switch (input.intent) {
    case "draft":
      return "draft_advice"
    case "start_sit":
      return "start_sit"
    case "waiver":
      return "waiver_advice"
    case "trade":
      return "trade_advice"
    case "commissioner":
      return "commissioner_rules"
    case "injury":
      return "injury_news_explanation"
    case "dynasty":
    case "rankings":
    case "matchup":
      return "player_comparison"
    case "sports_schedule":
      return "live_schedule"
    default:
      return "league_summary"
  }
}

function makeFreshness(
  values: Record<ChimmyPayloadFieldKey, unknown>,
  source: string,
  updatedAt: string | null,
  overrides?: Partial<Record<ChimmyPayloadFieldKey, ChimmySourceFreshnessEntry>>
): Record<ChimmyPayloadFieldKey, ChimmySourceFreshnessEntry> {
  const out = {} as Record<ChimmyPayloadFieldKey, ChimmySourceFreshnessEntry>
  for (const key of PAYLOAD_FIELD_KEYS) {
    out[key] =
      overrides?.[key] ?? {
        status: hasUsableValue(values[key]) ? "fresh" : "missing",
        source: hasUsableValue(values[key]) ? source : "not_loaded",
        updatedAt: hasUsableValue(values[key]) ? updatedAt : null,
        detail: hasUsableValue(values[key])
          ? "Loaded into structured Chimmy payload."
          : "No structured cached value was provided for this turn.",
      }
  }
  return out
}

function finalizePayload(args: {
  sport: ChimmyStructuredPayloadSport
  answerMode: ChimmyAnswerMode
  values: Record<ChimmyPayloadFieldKey, unknown>
  sourceFreshness: Record<ChimmyPayloadFieldKey, ChimmySourceFreshnessEntry>
}): ChimmyStructuredPromptPayload {
  const missingData = PAYLOAD_FIELD_KEYS.filter((key) => !hasUsableValue(args.values[key]))
  const staleData = PAYLOAD_FIELD_KEYS.filter((key) => args.sourceFreshness[key]?.status === "stale")
  const allowedActions = ALL_ANSWER_MODES.filter((mode) => {
    const requiredFieldsForMode = REQUIRED_FIELDS_BY_MODE[mode]
    const hasRequiredFields = requiredFieldsForMode.every((field) => !missingData.includes(field))
    const hasFreshRequiredFields =
      !FRESH_REQUIRED_MODES.has(mode) || requiredFieldsForMode.every((field) => !staleData.includes(field))
    return hasRequiredFields && hasFreshRequiredFields
  })
  const blockedActions = ALL_ANSWER_MODES.filter((mode) => !allowedActions.includes(mode))
  const requiredFields = REQUIRED_FIELDS_BY_MODE[args.answerMode]
  const missingRequiredFields = requiredFields.filter((field) => missingData.includes(field))
  const staleRequiredFields = FRESH_REQUIRED_MODES.has(args.answerMode)
    ? requiredFields.filter((field) => staleData.includes(field))
    : []
  const shouldFallback = missingRequiredFields.length > 0 || staleRequiredFields.length > 0

  return {
    schemaVersion: CHIMMY_STRUCTURED_PROMPT_PAYLOAD_SCHEMA,
    sport: args.sport,
    answerMode: args.answerMode,
    league: compactRecord(asRecord(args.values.league)),
    userTeam: compactRecord(asRecord(args.values.userTeam)),
    roster: compactRecord(asRecord(args.values.roster), 24),
    scoringSettings: compactRecord(asRecord(args.values.scoringSettings), 24),
    standings: compactRows(asRecordArray(args.values.standings), 20, 10),
    schedule: compactRows(asRecordArray(args.values.schedule), 20, 10),
    draftState: compactRecord(asRecord(args.values.draftState), 24),
    availablePlayers: compactRows(asRecordArray(args.values.availablePlayers), 30, 12),
    projections: compactRecord(asRecord(args.values.projections), 24),
    injuries: compactRows(asRecordArray(args.values.injuries), 30, 12),
    recentStats: compactRows(asRecordArray(args.values.recentStats), 30, 12),
    sourceFreshness: args.sourceFreshness,
    allowedActions,
    missingData,
    staleData,
    blockedActions,
    responsePolicy: {
      shouldFallback,
      fallbackMessage: CHIMMY_MISSING_LIVE_DATA_MESSAGE,
      reason: shouldFallback
        ? [
            missingRequiredFields.length
              ? `Missing required data for ${args.answerMode}: ${missingRequiredFields.join(", ")}`
              : null,
            staleRequiredFields.length
              ? `Stale required data for ${args.answerMode}: ${staleRequiredFields.join(", ")}`
              : null,
          ]
            .filter(Boolean)
            .join("; ")
        : null,
      requiredFields,
      missingRequiredFields,
      staleRequiredFields,
      guardrails: [
        "Use only fields present in this structured payload.",
        "Do not invent injuries, news, projections, available players, draft state, recent stats, schedules, scores, or league context.",
        `If required fields for the requested answer mode are missing or stale, start with: ${CHIMMY_MISSING_LIVE_DATA_MESSAGE}`,
        "Allowed actions are the only answer modes with enough structured data for advice.",
      ],
    },
  }
}

function extractScoringSettingsFromLeague(league: ChimmyContextBundle["activeLeague"]): Record<string, unknown> | null {
  if (!league) return null
  if (league.scoringSummary) {
    return {
      label: league.scoring,
      deterministicSummary: league.scoringSummary,
    }
  }
  if (league.scoring) {
    return { label: league.scoring }
  }
  return null
}

function extractProjectionsFromBundle(bundle: ChimmyContextBundle): Record<string, unknown> | null {
  const values: Record<string, unknown> = {}
  if (bundle.matchup?.yourProjectedPoints != null || bundle.matchup?.opponentProjectedPoints != null) {
    values.matchup = {
      week: bundle.matchup.week,
      yourProjectedPoints: bundle.matchup.yourProjectedPoints,
      opponentProjectedPoints: bundle.matchup.opponentProjectedPoints,
      projectedMargin: bundle.matchup.projectedMargin,
      projectedLeader: bundle.matchup.projectedLeader,
      projectedWinProbability: bundle.matchup.projectedWinProbability,
    }
  }
  if (bundle.roster?.starterProjectedTotal != null) {
    values.rosterStarterProjectedTotal = bundle.roster.starterProjectedTotal
  }
  return hasUsableValue(values) ? values : null
}

export function buildChimmyStructuredPromptPayloadFromBundle(
  bundle: ChimmyContextBundle,
  options: BuildStructuredPayloadOptions = {}
): ChimmyStructuredPromptPayload | null {
  const sport = normalizeStructuredSport(options.sport ?? bundle.activeLeague?.sport ?? null)
  if (!sport) return null

  const answerMode = classifyChimmyAnswerMode(options)
  const league = bundle.activeLeague
    ? {
        id: bundle.activeLeague.id,
        name: bundle.activeLeague.name,
        platform: bundle.activeLeague.platform,
        sport: bundle.activeLeague.sport,
        season: bundle.activeLeague.season,
        format: bundle.activeLeague.format,
        numTeams: bundle.activeLeague.numTeams,
        role: bundle.activeLeague.role,
        isCommissioner: bundle.activeLeague.isCommissioner,
      }
    : null
  const userTeam = bundle.roster
    ? {
        leagueId: bundle.roster.leagueId,
        teamId: bundle.roster.teamId,
        starterProjectedTotal: bundle.roster.starterProjectedTotal ?? null,
        teamIdentityHint: bundle.roster.teamIdentityHint ?? null,
        weaknessSignals: bundle.roster.weaknessSignals ?? [],
        strengthSignals: bundle.roster.strengthSignals ?? [],
      }
    : null
  const roster = bundle.roster
    ? {
        starters: bundle.roster.starters,
        bench: bundle.roster.bench,
        byPosition: bundle.roster.byPosition ?? null,
        depthByPosition: bundle.roster.depthByPosition ?? null,
      }
    : null
  const schedule = bundle.sportsSchedule?.hasRealData ? bundle.sportsSchedule.games : null
  const values: Record<ChimmyPayloadFieldKey, unknown> = {
    league,
    userTeam,
    roster,
    scoringSettings: extractScoringSettingsFromLeague(bundle.activeLeague),
    standings: bundle.standings?.rows.length ? bundle.standings.rows : null,
    schedule,
    draftState: null,
    /*
     * ⚠ `ncaaf_devy_prospect_advice` REQUIRES `availablePlayers` AND THIS WAS
     * ALWAYS NULL, so that answer mode could never satisfy its own contract --
     * it was declared in ALL_ANSWER_MODES and REQUIRED_FIELDS_BY_MODE but
     * structurally unanswerable regardless of what data existed.
     *
     * The devy board is precisely what "available players" means in a devy
     * question, so it fills the field for THAT MODE ONLY. Draft and waiver
     * advice also require this key and mean something completely different by
     * it; handing them college prospects would be worse than the null.
     *
     * Null when the board is empty rather than an empty array, so the mode
     * reports "missing required data" instead of silently answering off nothing.
     */
    availablePlayers:
      answerMode === 'ncaaf_devy_prospect_advice' && bundle.devy?.topProspects?.length
        ? {
            prospects: bundle.devy.topProspects,
            // Coverage travels WITH the list: the board ranks a minority of the
            // pool, and "the best devy QB" is a different claim from "the best
            // of the ones we can rank".
            ranked: bundle.devy.ranked,
            unranked: bundle.devy.unranked,
            coverage: bundle.devy.coverage,
            gaps: bundle.devy.gaps,
          }
        : null,
    projections: extractProjectionsFromBundle(bundle),
    injuries: null,
    recentStats: null,
  }

  return finalizePayload({
    sport,
    answerMode,
    values,
    sourceFreshness: makeFreshness(values, "chimmy-context-engine", bundle.meta.builtAt),
  })
}

function firstRecordFromKeys(
  sources: Array<Record<string, unknown> | null | undefined>,
  keys: string[]
): Record<string, unknown> | null {
  for (const source of sources) {
    if (!source) continue
    for (const key of keys) {
      const value = asRecord(source[key])
      if (value && hasUsableValue(value)) return value
    }
  }
  return null
}

function firstRowsFromKeys(
  sources: Array<Record<string, unknown> | null | undefined>,
  keys: string[]
): Array<Record<string, unknown>> | null {
  for (const source of sources) {
    if (!source) continue
    for (const key of keys) {
      const value = asRecordArray(source[key])
      if (value && hasUsableValue(value)) return value
    }
  }
  return null
}

function extractSourceFreshness(
  sources: Array<Record<string, unknown> | null | undefined>
): Partial<Record<ChimmyPayloadFieldKey, ChimmySourceFreshnessEntry>> | undefined {
  for (const source of sources) {
    const freshness = asRecord(source?.sourceFreshness)
    if (!freshness) continue
    const out: Partial<Record<ChimmyPayloadFieldKey, ChimmySourceFreshnessEntry>> = {}
    for (const key of PAYLOAD_FIELD_KEYS) {
      const row = asRecord(freshness[key])
      if (!row) continue
      const status = typeof row.status === "string" ? row.status : "unknown"
      out[key] = {
        status:
          status === "fresh" || status === "missing" || status === "stale"
            ? status
            : "unknown",
        source: typeof row.source === "string" ? row.source : "unknown",
        updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
        detail: typeof row.detail === "string" ? row.detail : undefined,
      }
    }
    return out
  }
  return undefined
}

export function buildChimmyStructuredPromptPayloadFromLooseContext(
  options: BuildStructuredPayloadFromLooseContextOptions
): ChimmyStructuredPromptPayload | null {
  const sport = normalizeStructuredSport(options.sport)
  if (!sport) return null

  const deterministic = options.deterministicContext ?? null
  const existingPayload = asRecord(deterministic?.chimmyStructuredPromptPayload)
  if (existingPayload?.schemaVersion === CHIMMY_STRUCTURED_PROMPT_PAYLOAD_SCHEMA) {
    return existingPayload as ChimmyStructuredPromptPayload
  }
  const statistics = options.statisticsPayload ?? null
  const leagueSettings = options.leagueSettings ?? null
  const sources = [deterministic, statistics, leagueSettings]
  const answerMode = classifyChimmyAnswerMode(options)
  const baseLeague =
    firstRecordFromKeys(sources, ["league", "leagueContext"]) ??
    (leagueSettings
      ? {
          sport,
          settings: leagueSettings,
        }
      : null)
  const conceptPresetSummary = firstRecordFromKeys(sources, [
    "conceptPresetSummary",
    "conceptPreset",
    "conceptPresetSnapshot",
  ])
  const league =
    baseLeague && conceptPresetSummary
      ? {
          ...baseLeague,
          conceptPreset: conceptPresetSummary,
        }
      : baseLeague
  const scoringSettings =
    firstRecordFromKeys(sources, ["scoringSettings", "scoring", "scoringPreset"]) ??
    (leagueSettings ? asRecord(leagueSettings.scoringSettings) : null)

  const values: Record<ChimmyPayloadFieldKey, unknown> = {
    league,
    userTeam: firstRecordFromKeys(sources, ["userTeam", "team", "teamContext"]),
    roster: firstRecordFromKeys(sources, ["roster", "lineup", "teamRoster"]),
    scoringSettings,
    standings: firstRowsFromKeys(sources, ["standings", "leagueStandings"]),
    schedule: firstRowsFromKeys(sources, ["schedule", "games"]),
    draftState: firstRecordFromKeys(sources, ["draftState", "draft"]),
    availablePlayers: firstRowsFromKeys(sources, ["availablePlayers", "waiverPool", "draftPool"]),
    projections: firstRecordFromKeys(sources, ["projections", "projectionSummary"]),
    injuries: firstRowsFromKeys(sources, ["injuries", "injuryNews"]),
    recentStats: firstRowsFromKeys(sources, ["recentStats", "statLines", "stats"]),
  }

  return finalizePayload({
    sport,
    answerMode,
    values,
    sourceFreshness: makeFreshness(
      values,
      "request-deterministic-context",
      new Date().toISOString(),
      extractSourceFreshness(sources)
    ),
  })
}

export function buildChimmyMissingDataFallback(
  payload: ChimmyStructuredPromptPayload | null
): string | null {
  if (!payload?.responsePolicy.shouldFallback) return null
  const missing = payload.responsePolicy.missingRequiredFields.join(", ")
  const stale = payload.responsePolicy.staleRequiredFields.join(", ")
  const details = [
    missing ? `Missing required ${payload.answerMode.replace(/_/g, " ")} data: ${missing}.` : null,
    stale ? `Stale required ${payload.answerMode.replace(/_/g, " ")} data: ${stale}.` : null,
  ].filter(Boolean)
  return [
    CHIMMY_MISSING_LIVE_DATA_MESSAGE,
    details.join(" "),
    "I can still help identify the importer, projection, roster, or provider backfill needed before giving that advice.",
  ].join(" ")
}

export function renderChimmyStructuredPromptPayloadForPrompt(
  payload: ChimmyStructuredPromptPayload | null,
  options: { maxChars?: number } = {}
): string {
  if (!payload) return ""
  const json = JSON.stringify(payload, null, 2)
  const cap = options.maxChars ?? 6000
  const body = json.length > cap ? `${json.slice(0, cap)}\n... truncated` : json
  return [
    "## CHIMMY STRUCTURED PROMPT PAYLOAD",
    "Use this JSON as the only structured NFL/NCAAF fantasy context for this turn.",
    `Missing-data fallback phrase: ${CHIMMY_MISSING_LIVE_DATA_MESSAGE}`,
    "Do not guess fields that are null, listed in missingData, or listed in staleData. Do not mention injuries, news, projections, available players, draft state, schedules, scores, or recent stats unless the matching payload key has fresh data.",
    "```json",
    body,
    "```",
  ].join("\n")
}
