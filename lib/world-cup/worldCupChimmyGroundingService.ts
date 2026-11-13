import type {
  ChimmyLeaderboardRow,
  ChimmyMatchSummary,
  WorldCupChimmyContext,
} from "./worldCupChimmyContext"

export type WorldCupChimmyUserRole = "participant" | "commissioner" | "admin" | "non_member"

type WorldCupChimmyIntentCategory =
  | "pool_leaderboard"
  | "user_path_to_win"
  | "pool_summary"
  | "scoring_rules"
  | "group_stage"
  | "knockout_bracket"
  | "commissioner_report"
  | "match_schedule_scores"
  | "soccer_knowledge"
  | "unsupported_live_provider_data"
  | "general"

type WorldCupChimmyAccessPolicy = {
  freeAllowed: boolean
  proRequired: boolean
  commissionerRequired: boolean
  tokenPolicy: "no_charge" | "charge_after_success" | "blocked_no_charge"
}

type WorldCupChimmyIntentRoute = {
  category: WorldCupChimmyIntentCategory
  requiredData: string[]
  optionalData: string[]
  access: WorldCupChimmyAccessPolicy
  fallbackBehavior: string
}

export type WorldCupChimmyGrounding = {
  contractVersion: "wc-chimmy-grounding-v1"
  builtAt: string
  prompt: {
    normalized: string
    intent: WorldCupChimmyIntentRoute
  }
  pool: {
    challengeId: string | null
    name: string
    userRole: WorldCupChimmyUserRole
    participantCount: number
    entryCount: number | null
    finalizedEntryCount: number | null
    inviteCount: number | null
    isLocked: boolean
    lockReason: string | null
    scoring: WorldCupChimmyContext["scoring"] | null
    commissionerSettingsAvailable: boolean
    fetchedAt: string | null
  }
  bracket: {
    entryId: string | null
    entryName: string | null
    rank: number | null
    totalScore: number | null
    maxPossibleScore: number | null
    championPick: string | null
    isComplete: boolean | null
    groupPickCount: number
    knockoutPickCount: number
    thirdPlacePickCount: number
    correctPicks: number | null
    incorrectPicks: number | null
  }
  leaderboard: {
    rows: ChimmyLeaderboardRow[]
    leader: ChimmyLeaderboardRow | null
    topThree: ChimmyLeaderboardRow[]
    championPickCounts: Array<{ teamName: string; count: number }>
  }
  worldCupData: {
    liveMatches: ChimmyMatchSummary[]
    upcomingMatches: ChimmyMatchSummary[]
    recentMatches: ChimmyMatchSummary[]
    groupStandingCount: number
    hasCachedFixtures: boolean
    hasCachedScores: boolean
    hasCachedStandings: boolean
    hasCachedInjuries: false
    hasCachedOdds: false
    liveDataStatus: WorldCupChimmyContext["liveDataStatus"] | "unavailable"
    lastSyncedAt: string | null
  }
  dataQuality: {
    availableInputs: string[]
    missingInputs: string[]
    staleInputs: string[]
    unsupportedInputs: string[]
    freshness: string
    confidence: "high" | "medium" | "low" | "none"
    noChargeReason: string | null
  }
}

function normalizedPrompt(prompt: string) {
  return prompt
    .replace(/(^|[\s*_~\]])@chimmy\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

function route(
  category: WorldCupChimmyIntentCategory,
  requiredData: string[],
  optionalData: string[],
  access: WorldCupChimmyAccessPolicy,
  fallbackBehavior: string
): WorldCupChimmyIntentRoute {
  return { category, requiredData, optionalData, access, fallbackBehavior }
}

export function classifyWorldCupChimmyIntent(prompt: string): WorldCupChimmyIntentRoute {
  const p = normalizedPrompt(prompt).toLowerCase()

  if (/\b(odds|spread|over\s*\/\s*under|over-under|injur(?:y|ies|ed)|lineups?|rosters?|player\s+stats?|goalscorers?|cards?)\b/.test(p)) {
    return route(
      "unsupported_live_provider_data",
      ["verified provider cache for requested current fact"],
      ["pool context"],
      { freeAllowed: true, proRequired: false, commissionerRequired: false, tokenPolicy: "blocked_no_charge" },
      "Refuse the unavailable current fact and pivot to saved pool/bracket context."
    )
  }

  if (/\b(live\s+score|score\s+now|current\s+score|what'?s\s+the\s+score|when\s+(is|does|do)|kickoff|schedule|fixture|next\s+match|games?\s+today|play\s+next)\b/.test(p)) {
    return route(
      "match_schedule_scores",
      ["cached fixtures or live match cache"],
      ["user picks", "leaderboard"],
      { freeAllowed: true, proRequired: false, commissionerRequired: false, tokenPolicy: "no_charge" },
      "Use cached fixtures/scores only; if missing, say what cache is missing."
    )
  }

  if (/\b(false\s+nine|pressing|low\s+block|counter(?:attack|ing)|offside|penalt(?:y|ies)|shootout|formation|tiebreakers?|tie-breakers?|group\s+stage\s+rules|why\s+is\s+\w+\s+dangerous)\b/.test(p)) {
    return route(
      "soccer_knowledge",
      ["stable soccer rules or clearly general tactical knowledge"],
      ["cached team context"],
      { freeAllowed: true, proRequired: false, commissionerRequired: false, tokenPolicy: "no_charge" },
      "Answer as general soccer knowledge and disclose when fresh team data is not loaded."
    )
  }

  if (/\b(commissioner|pool\s+health|engagement|incomplete|not\s+completed|announcement|integrity)\b/.test(p)) {
    return route(
      "commissioner_report",
      ["pool summary", "entry completion counts"],
      ["leaderboard", "invite counts", "commissioner settings"],
      { freeAllowed: false, proRequired: false, commissionerRequired: true, tokenPolicy: "charge_after_success" },
      "For non-commissioner or missing data, provide a safe basic pool summary with no private member claims."
    )
  }

  if (/\b(path\s+to\s+win|can\s+i\s+still\s+win|how\s+can\s+i\s+win|picks?\s+matter|champion\s+pick|my\s+bracket|show\s+my\s+champion)\b/.test(p)) {
    return route(
      "user_path_to_win",
      ["current user entry"],
      ["leaderboard", "cached matches"],
      { freeAllowed: true, proRequired: false, commissionerRequired: false, tokenPolicy: "no_charge" },
      "Use saved user picks; if no entry exists, ask the user to create/open a bracket."
    )
  }

  if (/\b(scoring|points?\s+work|how\s+many\s+points|my\s+points|what'?s\s+my\s+score|round\s+of\s+32|champion\s+bonus)\b/.test(p)) {
    return route(
      "scoring_rules",
      ["pool scoring rules"],
      ["current user entry"],
      { freeAllowed: true, proRequired: false, commissionerRequired: false, tokenPolicy: "no_charge" },
      "Explain configured scoring and saved user score if requested."
    )
  }

  if (/\b(standing|leaderboard|rank|who\s+is\s+leading|top\s+3|best\s+bracket|most\s+picked\s+champion|popular\s+champion)\b/.test(p)) {
    return route(
      "pool_leaderboard",
      ["leaderboard"],
      ["current user entry"],
      { freeAllowed: true, proRequired: false, commissionerRequired: false, tokenPolicy: "no_charge" },
      "Use stored leaderboard rows; if absent, say no ranked entries are available yet."
    )
  }

  if (/\b(group|grupo).*\b(danger|dangerous|tough|strong|tight|upset|advance|advances)\b/.test(p)) {
    return route(
      "group_stage",
      ["cached group standings or user group picks"],
      ["cached teams"],
      { freeAllowed: true, proRequired: false, commissionerRequired: false, tokenPolicy: "no_charge" },
      "Use cached standings/picks; if absent, do not invent form or strength."
    )
  }

  if (/\b(knockout|quarterfinal|semifinal|final|matchup|bracket\s+path)\b/.test(p)) {
    return route(
      "knockout_bracket",
      ["user knockout picks"],
      ["cached matches", "leaderboard"],
      { freeAllowed: true, proRequired: false, commissionerRequired: false, tokenPolicy: "no_charge" },
      "Use saved bracket picks and cached match state only."
    )
  }

  if (/\b(summarize|summary|recap|storylines?|what\s+is\s+happening)\b/.test(p)) {
    return route(
      "pool_summary",
      ["pool summary"],
      ["leaderboard", "current user entry", "cached matches"],
      { freeAllowed: true, proRequired: false, commissionerRequired: false, tokenPolicy: "no_charge" },
      "Summarize what is visible in stored pool data."
    )
  }

  return route(
    "general",
    ["grounded context"],
    ["leaderboard", "user entry", "cached fixtures"],
    { freeAllowed: false, proRequired: true, commissionerRequired: false, tokenPolicy: "charge_after_success" },
    "Answer only after grounding; otherwise provide a safe unavailable response."
  )
}

function championPickCounts(rows: ChimmyLeaderboardRow[]) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const team = row.championPickName?.trim()
    if (!team) continue
    counts.set(team, (counts.get(team) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([teamName, count]) => ({ teamName, count }))
    .sort((a, b) => b.count - a.count || a.teamName.localeCompare(b.teamName))
}

function hasScore(match: ChimmyMatchSummary) {
  return typeof match.homeScore === "number" && typeof match.awayScore === "number"
}

function freshnessLabel(ctx: WorldCupChimmyContext | null | undefined) {
  if (!ctx) return "No pool context loaded."
  if (ctx.lastSyncedAt) return `Provider cache last synced at ${ctx.lastSyncedAt}. Pool context fetched at ${ctx.fetchedAt}.`
  return `Pool context fetched at ${ctx.fetchedAt}. Provider freshness timestamp is not available.`
}

function staleInputs(ctx: WorldCupChimmyContext | null | undefined) {
  if (!ctx?.lastSyncedAt) return ctx?.liveMatches.length || ctx?.upcomingMatches.length || ctx?.recentMatches.length ? ["provider freshness timestamp"] : []
  const ageMs = Date.now() - new Date(ctx.lastSyncedAt).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return []
  return ageMs > 24 * 60 * 60 * 1000 ? ["World Cup provider cache older than 24h"] : []
}

function requiredDataAvailable(intent: WorldCupChimmyIntentRoute, ctx: WorldCupChimmyContext | null | undefined) {
  if (!ctx) return false
  switch (intent.category) {
    case "pool_leaderboard":
      return ctx.leaderboard.length > 0
    case "user_path_to_win":
    case "knockout_bracket":
      return Boolean(ctx.entry)
    case "scoring_rules":
      return Boolean(ctx.scoring)
    case "group_stage":
      return ctx.groupStandings.length > 0 || Boolean(ctx.entry?.groupPicks.length)
    case "match_schedule_scores":
      return ctx.liveMatches.length + ctx.upcomingMatches.length + ctx.recentMatches.length > 0
    case "commissioner_report":
      return ctx.participantCount > 0
    case "pool_summary":
      return true
    case "soccer_knowledge":
      return true
    case "unsupported_live_provider_data":
      return false
    default:
      return ctx.leaderboard.length > 0 || Boolean(ctx.entry) || ctx.upcomingMatches.length > 0 || ctx.groupStandings.length > 0
  }
}

export function buildWorldCupChimmyGrounding(input: {
  prompt: string
  context: WorldCupChimmyContext | null | undefined
  userRole?: WorldCupChimmyUserRole | null
  hasPro?: boolean
  hasCommissioner?: boolean
}): WorldCupChimmyGrounding {
  const ctx = input.context ?? null
  const intent = classifyWorldCupChimmyIntent(input.prompt)
  const role = input.userRole ?? ctx?.userRole ?? "participant"
  const entry = ctx?.entry ?? null
  const matches = ctx ? [...ctx.liveMatches, ...ctx.upcomingMatches, ...ctx.recentMatches] : []
  const availableInputs: string[] = []
  const missingInputs: string[] = []
  const unsupportedInputs: string[] = []

  if (ctx) availableInputs.push("pool context")
  else missingInputs.push("pool context")
  if (ctx?.leaderboard.length) availableInputs.push("leaderboard")
  else missingInputs.push("leaderboard")
  if (entry) availableInputs.push("current user entry")
  else missingInputs.push("current user entry")
  if (matches.length) availableInputs.push("cached fixtures/matches")
  else missingInputs.push("cached fixtures/matches")
  if (matches.some(hasScore)) availableInputs.push("cached scores")
  else missingInputs.push("cached scores")
  if (ctx?.groupStandings.length) availableInputs.push("cached group standings")
  else missingInputs.push("cached group standings")

  unsupportedInputs.push("live odds", "injuries", "lineups", "player stats")

  const hasRequired = requiredDataAvailable(intent, ctx)
  const confidence: WorldCupChimmyGrounding["dataQuality"]["confidence"] =
    !ctx ? "none" : intent.category === "unsupported_live_provider_data" ? "low" : hasRequired ? (staleInputs(ctx).length ? "medium" : "high") : "low"

  const noChargeReason =
    intent.category === "unsupported_live_provider_data"
      ? "Requested current provider data is not cached for this pool."
      : !ctx
        ? "No World Cup pool context was available."
        : !hasRequired
          ? `Missing required data for ${intent.category}.`
          : intent.access.tokenPolicy === "no_charge"
            ? "Deterministic answer uses stored pool/cache data."
            : null

  return {
    contractVersion: "wc-chimmy-grounding-v1",
    builtAt: new Date().toISOString(),
    prompt: {
      normalized: normalizedPrompt(input.prompt),
      intent,
    },
    pool: {
      challengeId: ctx?.challengeId ?? null,
      name: ctx?.poolName ?? "World Cup Pool",
      userRole: role,
      participantCount: ctx?.participantCount ?? 0,
      entryCount: ctx?.entryCount ?? null,
      finalizedEntryCount: ctx?.finalizedEntryCount ?? null,
      inviteCount: ctx?.inviteCount ?? null,
      isLocked: Boolean(ctx?.isLocked),
      lockReason: ctx?.lockReason ?? null,
      scoring: ctx?.scoring ?? null,
      commissionerSettingsAvailable: Boolean(ctx?.commissionerSettings),
      fetchedAt: ctx?.fetchedAt ?? null,
    },
    bracket: {
      entryId: entry?.entryId ?? null,
      entryName: entry?.entryName ?? null,
      rank: entry?.rank ?? null,
      totalScore: entry?.totalScore ?? null,
      maxPossibleScore: entry?.maxPossibleScore ?? null,
      championPick: entry?.championPick ?? null,
      isComplete: entry?.isComplete ?? null,
      groupPickCount: entry?.groupPicks.length ?? 0,
      knockoutPickCount: entry?.knockoutPicks.length ?? 0,
      thirdPlacePickCount: entry?.thirdPlacePicks?.length ?? 0,
      correctPicks: entry?.correctPicks ?? null,
      incorrectPicks: entry?.incorrectPicks ?? null,
    },
    leaderboard: {
      rows: ctx?.leaderboard ?? [],
      leader: ctx?.leaderboard[0] ?? null,
      topThree: (ctx?.leaderboard ?? []).slice(0, 3),
      championPickCounts: championPickCounts(ctx?.leaderboard ?? []),
    },
    worldCupData: {
      liveMatches: ctx?.liveMatches ?? [],
      upcomingMatches: ctx?.upcomingMatches ?? [],
      recentMatches: ctx?.recentMatches ?? [],
      groupStandingCount: ctx?.groupStandings.length ?? 0,
      hasCachedFixtures: matches.length > 0,
      hasCachedScores: matches.some(hasScore),
      hasCachedStandings: Boolean(ctx?.groupStandings.length),
      hasCachedInjuries: false,
      hasCachedOdds: false,
      liveDataStatus: ctx?.liveDataStatus ?? "unavailable",
      lastSyncedAt: ctx?.lastSyncedAt ?? null,
    },
    dataQuality: {
      availableInputs,
      missingInputs,
      staleInputs: staleInputs(ctx),
      unsupportedInputs,
      freshness: freshnessLabel(ctx),
      confidence,
      noChargeReason,
    },
  }
}

export function serializeWorldCupChimmyGrounding(grounding: WorldCupChimmyGrounding): string {
  return JSON.stringify(grounding, null, 2)
}
