/**
 * ChimmyGroundingPacket — the single structured object Chimmy AI reads from.
 *
 * Every AI response must be built exclusively from this packet.
 * The system prompt enforces: "Only answer using facts in this packet.
 * If the packet does not contain the fact, say what data is missing and
 * suggest where the user can check."
 *
 * This is a cross-sport type. Sport-specific assemblers live alongside
 * their sport module (e.g. buildWcChimmyGroundingPacket in this file).
 */
import type { WorldCupChimmyContext } from "@/lib/world-cup/worldCupChimmyContext"
import type { WorldCupChimmyGrounding } from "@/lib/world-cup/worldCupChimmyGroundingService"

// ---------------------------------------------------------------------------
// DataSourceDisclosure — tells Chimmy how fresh each data tier is
// ---------------------------------------------------------------------------

/**
 * Pre-built human-readable labels that Chimmy MUST use verbatim when opening
 * any answer that touches live scores, cached data, or pool standings.
 * This is what produces "Using live match data from 2:14 PM ET." in responses.
 */
type DataSourceDisclosure = {
  /**
   * Overall classification of sports data availability.
   * - live          → active live match feed with scores and minutes
   * - cached        → recently polled provider data, scores available
   * - schedule_only → fixture schedule exists but no live/final scores
   * - pool_only     → no sports provider data; pool/bracket data only
   * - none          → no reliable data of any kind
   */
  tier: "live" | "cached" | "schedule_only" | "pool_only" | "none"

  /**
   * Disclosure string Chimmy MUST prepend for live score / match event answers.
   * null when tier is not "live".
   * Example: "Using live match data from 2:14 PM EDT."
   */
  liveMatchLabel: string | null

  /**
   * Disclosure string Chimmy MUST prepend for cached or schedule answers.
   * null when tier is "live" or "none".
   * Example: "Using cached scores last updated 8 minutes ago."
   *          "Using fixture schedule data (no live scores yet)."
   */
  cachedDataLabel: string | null

  /**
   * Disclosure string Chimmy MUST use for pool standings / bracket answers.
   * Always present.
   * Example: "Pool standings as of 2:05 PM EDT."
   *          "Pool data last fetched 14 minutes ago."
   */
  poolDataLabel: string

  /**
   * If Chimmy cannot provide a sports-data answer, this sentence explains why
   * and suggests where the user can check instead.
   * Example: "I don't have live match data for this game yet — check the
   *           live scores tab or try again after the next data sync."
   */
  unavailableExplanation: string | null

  /** Age of sports provider data in minutes. null if no provider data. */
  sportsDataAgeMinutes: number | null

  /** Age of pool data in minutes (from fetchedAt). */
  poolDataAgeMinutes: number
}

// ---------------------------------------------------------------------------
// Core packet type — matches the user-defined contract exactly
// ---------------------------------------------------------------------------

type ChimmyGroundingPacket = {
  sport:
    | "world_cup"
    | "nfl"
    | "nba"
    | "mlb"
    | "nhl"
    | "epl"
    | "ufc"
    | "aew"
    | (string & {})

  feature:
    | "pool_chat"
    | "private_ai"
    | "commissioner_insights"
    | "bracket_recommendation"
    | "lineup_advice"
    | "matchup_preview"

  userQuestion: string

  userRole: "owner" | "commissioner" | "admin" | "guest"

  entitlements: {
    plan: "free" | "pro" | "commissioner" | "supreme" | "war_room"
    tokenBalance?: number
  }

  /**
   * Data freshness and source tier for each data domain.
   * Chimmy MUST reference these labels explicitly in responses.
   */
  dataSourceDisclosure: DataSourceDisclosure

  poolContext?: {
    poolId: string
    poolName: string
    scoringRules: object
    leaderboard: object[]
    userEntry: object
    championPick?: string
    bracketPath?: object
    incompletePicks?: object[]
  }

  sportsData: {
    source: "provider_live" | "provider_cached" | "database" | "mock" | "none"
    freshness: string
    fixtures?: object[]
    liveScores?: object[]
    standings?: object[]
    odds?: object[]
    injuries?: object[]
    playerStats?: object[]
  }

  /** Facts the AI is permitted to assert. Derived from available data inputs. */
  allowedClaims: string[]

  /** Data the user may have asked about that is not available. AI must name these explicitly. */
  missingData: string[]
}

// ---------------------------------------------------------------------------
// Time formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO UTC timestamp as a human-readable time in US Eastern.
 * Uses Intl.DateTimeFormat so DST (EDT/EST) is handled automatically.
 * Returns e.g. "2:14 PM EDT" for World Cup summer matches.
 */
function formatEasternTime(isoString: string): string {
  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return isoString.slice(11, 16) + " UTC"
    return date.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    })
  } catch {
    return isoString.slice(11, 16) + " UTC"
  }
}

/** Returns age of an ISO timestamp in whole minutes. null if unparseable. */
function ageMinutes(isoString: string | null | undefined): number | null {
  if (!isoString) return null
  const ageMs = Date.now() - new Date(isoString).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return null
  return Math.floor(ageMs / 60_000)
}

function pluralMin(n: number): string {
  return `${n} minute${n === 1 ? "" : "s"}`
}

// ---------------------------------------------------------------------------
// DataSourceDisclosure builder
// ---------------------------------------------------------------------------

function buildDataSourceDisclosure(input: {
  liveDataStatus: WorldCupChimmyContext["liveDataStatus"] | "unavailable"
  lastSyncedAt: string | null
  fetchedAt: string
  hasLiveScores: boolean
  hasCachedScores: boolean
  hasFixtures: boolean
}): DataSourceDisclosure {
  const { liveDataStatus, lastSyncedAt, fetchedAt } = input
  const sportsAge = ageMinutes(lastSyncedAt)
  const poolAge = ageMinutes(fetchedAt) ?? 0

  let tier: DataSourceDisclosure["tier"]
  let liveMatchLabel: string | null = null
  let cachedDataLabel: string | null = null
  let unavailableExplanation: string | null = null

  // --- Sports data tier -----------------------------------------------------
  if (liveDataStatus === "live" && input.hasLiveScores) {
    tier = "live"
    if (lastSyncedAt) {
      const timeStr = formatEasternTime(lastSyncedAt)
      liveMatchLabel =
        sportsAge !== null && sportsAge <= 1
          ? `Using live match data from ${timeStr}.`
          : `Using live match data, last synced ${pluralMin(sportsAge ?? 0)} ago (${timeStr}).`
    } else {
      liveMatchLabel = "Using live match data (sync timestamp unavailable)."
    }
  } else if (liveDataStatus === "live" && !input.hasLiveScores) {
    // live status but no scores loaded yet (game just kicked off)
    tier = "schedule_only"
    cachedDataLabel = lastSyncedAt
      ? `Using fixture schedule data from ${formatEasternTime(lastSyncedAt)} — live score not available yet.`
      : "Using fixture schedule data — live scores not loaded yet."
    unavailableExplanation =
      "I don't have live in-game scores yet for this match. Check back in a moment or refresh the live scores tab."
  } else if (liveDataStatus === "fixture_only") {
    // We have the schedule; recent matches may have final scores
    if (input.hasCachedScores) {
      tier = "cached"
      if (sportsAge !== null && lastSyncedAt) {
        const timeStr = formatEasternTime(lastSyncedAt)
        cachedDataLabel =
          sportsAge < 60
            ? `Using cached scores last updated ${pluralMin(sportsAge)} ago (${timeStr}).`
            : `Using cached scores from ${timeStr} — over ${Math.floor(sportsAge / 60)} hour${Math.floor(sportsAge / 60) === 1 ? "" : "s"} ago.`
      } else {
        cachedDataLabel = "Using cached match scores (freshness timestamp unavailable)."
      }
    } else {
      tier = "schedule_only"
      if (sportsAge !== null && lastSyncedAt) {
        cachedDataLabel = `Using fixture schedule last synced ${pluralMin(sportsAge)} ago — no live or final scores available yet.`
      } else if (input.hasFixtures) {
        cachedDataLabel = "Using fixture schedule data — no live or final scores available yet."
      } else {
        cachedDataLabel = null
      }
      unavailableExplanation =
        "I don't have live or final scores for this match. For real-time scores, check the live scores tab or an official World Cup feed."
    }
  } else if (liveDataStatus === "unavailable") {
    if (input.hasCachedScores) {
      // Edge case: status says unavailable but we have scores from DB
      tier = "cached"
      cachedDataLabel = lastSyncedAt
        ? `Using cached scores from ${formatEasternTime(lastSyncedAt)} — live feed is not active.`
        : "Using cached match scores — live feed is not active."
    } else {
      tier = input.hasFixtures ? "schedule_only" : "none"
      if (input.hasFixtures) {
        cachedDataLabel = "Using fixture schedule data — live match data is not synced."
      }
      unavailableExplanation =
        "I don't have live match data for this right now. I can still help with your bracket picks, pool standings, scoring rules, and path to win."
    }
  } else {
    // Fallback — pool data only
    tier = "pool_only"
    unavailableExplanation =
      "No live or cached match data is loaded. I can answer questions about your bracket, pool standings, and scoring."
  }

  // --- Pool data label -------------------------------------------------------
  const poolDataLabel =
    poolAge <= 3
      ? `Pool standings current as of ${formatEasternTime(fetchedAt)}.`
      : `Pool data last fetched ${pluralMin(poolAge)} ago.`

  return {
    tier,
    liveMatchLabel,
    cachedDataLabel,
    poolDataLabel,
    unavailableExplanation,
    sportsDataAgeMinutes: sportsAge,
    poolDataAgeMinutes: poolAge,
  }
}

// ---------------------------------------------------------------------------
// World Cup assembler helpers
// ---------------------------------------------------------------------------

function wcDataSource(
  status: WorldCupChimmyContext["liveDataStatus"] | "unavailable"
): ChimmyGroundingPacket["sportsData"]["source"] {
  if (status === "live") return "provider_live"
  if (status === "fixture_only") return "provider_cached"
  if (status === "unavailable") return "none"
  return "database"
}

function mapUserRole(
  role: "participant" | "commissioner" | "admin" | "non_member" | undefined
): ChimmyGroundingPacket["userRole"] {
  if (role === "commissioner") return "commissioner"
  if (role === "admin") return "admin"
  if (role === "non_member") return "guest"
  return "owner" // participant owns their own entry
}

// ---------------------------------------------------------------------------
// World Cup packet assembler — public API
// ---------------------------------------------------------------------------

/**
 * Build a ChimmyGroundingPacket from a World Cup pool context + grounding.
 * This becomes the ONLY data object sent to the LLM.
 *
 * The packet consolidates:
 *  - WorldCupChimmyGrounding (intent + data quality)
 *  - WorldCupChimmyContext (raw pool, bracket, match, standings data)
 *  - DataSourceDisclosure (per-tier freshness labels for Chimmy to cite)
 *  - entitlements (plan + token balance)
 */
export function buildWcChimmyGroundingPacket(input: {
  userQuestion: string
  context: WorldCupChimmyContext | null | undefined
  grounding: WorldCupChimmyGrounding
  entitlements?: {
    plan?: "free" | "pro" | "commissioner" | "supreme" | "war_room"
    tokenBalance?: number
  }
}): ChimmyGroundingPacket {
  const { context: ctx, grounding, userQuestion, entitlements } = input
  const entry = ctx?.entry ?? null
  const liveStatus = grounding.worldCupData.liveDataStatus

  // --- Data source disclosure -----------------------------------------------
  const dataSourceDisclosure = buildDataSourceDisclosure({
    liveDataStatus: liveStatus,
    lastSyncedAt: grounding.worldCupData.lastSyncedAt,
    fetchedAt: ctx?.fetchedAt ?? new Date().toISOString(),
    hasLiveScores: grounding.worldCupData.liveMatches.length > 0,
    hasCachedScores: grounding.worldCupData.hasCachedScores,
    hasFixtures:
      grounding.worldCupData.upcomingMatches.length > 0 ||
      grounding.worldCupData.recentMatches.length > 0,
  })

  // --- Pool context ---------------------------------------------------------
  const poolContext: ChimmyGroundingPacket["poolContext"] = ctx
    ? {
        poolId: ctx.challengeId,
        poolName: ctx.poolName,
        scoringRules: {
          roundOf32: ctx.scoring.roundOf32Points,
          roundOf16: ctx.scoring.roundOf16Points,
          quarterFinal: ctx.scoring.quarterFinalPoints,
          semiFinal: ctx.scoring.semiFinalPoints,
          final: ctx.scoring.finalPoints,
          championBonus: ctx.scoring.championBonusPoints,
        },
        leaderboard: grounding.leaderboard.rows.map((row) => ({
          rank: row.rank,
          entryName: row.entryName,
          totalScore: row.totalScore,
          maxPossibleScore: row.maxPossibleScore,
          championPick: row.championPickName ?? null,
        })),
        userEntry: entry
          ? {
              entryId: entry.entryId,
              entryName: entry.entryName,
              rank: entry.rank,
              totalScore: entry.totalScore,
              maxPossibleScore: entry.maxPossibleScore,
              isComplete: entry.isComplete,
              correctPicks: entry.correctPicks,
              incorrectPicks: entry.incorrectPicks,
              groupPicks: entry.groupPicks,
              knockoutPicks: entry.knockoutPicks,
              thirdPlacePicks: entry.thirdPlacePicks ?? [],
            }
          : { status: "not_entered" },
        championPick: entry?.championPick ?? undefined,
        bracketPath: entry
          ? {
              alivePicks: entry.knockoutPicks
                .filter((p) => p.isCorrect !== false)
                .map((p) => ({ round: p.round, team: p.pickedTeam })),
              eliminatedPicks: entry.knockoutPicks
                .filter((p) => p.isCorrect === false)
                .map((p) => ({ round: p.round, team: p.pickedTeam })),
              gapToLeader:
                ctx.leaderboard.length > 0 && entry.rank !== 1
                  ? Math.max(0, ctx.leaderboard[0].totalScore - entry.totalScore)
                  : 0,
              maxStillEarnable: entry.maxPossibleScore - entry.totalScore,
              isLeading: entry.rank === 1,
            }
          : undefined,
        incompletePicks: entry
          ? entry.knockoutPicks
              .filter((p) => p.isCorrect === false)
              .map((p) => ({ round: p.round, team: p.pickedTeam }))
          : undefined,
      }
    : undefined

  // --- Sports data ----------------------------------------------------------
  // fixtures = upcoming + finished/recent (distinguished by matchStatus)
  // liveScores = in-progress matches only
  const fixtureRows = [
    ...grounding.worldCupData.upcomingMatches.map((m) => ({
      matchStatus: "upcoming",
      home: m.homeTeamName,
      away: m.awayTeamName,
      round: m.round,
      startsAt: m.startsAt ?? null,
    })),
    ...grounding.worldCupData.recentMatches.map((m) => ({
      matchStatus: "finished",
      home: m.homeTeamName,
      away: m.awayTeamName,
      homeScore: m.homeScore ?? null,
      awayScore: m.awayScore ?? null,
      winner: m.winnerTeamName ?? null,
      round: m.round,
    })),
  ]

  const liveScoreRows = grounding.worldCupData.liveMatches.map((m) => ({
    home: m.homeTeamName,
    away: m.awayTeamName,
    homeScore: m.homeScore ?? null,
    awayScore: m.awayScore ?? null,
    minute: m.minute ?? null,
    round: m.round,
    status: m.status,
  }))

  const standingRows =
    ctx?.groupStandings.map((s) => ({
      group: s.groupName,
      team: s.teamName,
      points: s.points,
      isThirdPlaceAdvancer: s.isThirdPlaceAdvancer ?? false,
    })) ?? []

  const sportsData: ChimmyGroundingPacket["sportsData"] = {
    source: wcDataSource(liveStatus),
    freshness: grounding.dataQuality.freshness,
    fixtures: fixtureRows,
    liveScores: liveScoreRows,
    standings: standingRows,
    odds: [],
    injuries: [],
    playerStats: [],
  }

  // --- Allowed claims -------------------------------------------------------
  const allowedClaims: string[] = [
    ...grounding.dataQuality.availableInputs,
    ...(ctx
      ? ["pool name", "participant count", "scoring rules", "pool lock status"]
      : []),
    ...(entry
      ? [
          "user rank",
          "user total score",
          "user max possible score",
          "user champion pick",
          "user alive picks",
          "user eliminated picks",
          "gap to leader",
        ]
      : []),
    ...(ctx?.leaderboard.length
      ? ["leaderboard ranks", "leader entry name and score", "champion pick distribution"]
      : []),
    ...(grounding.worldCupData.liveMatches.length
      ? ["live match scores", "current match minutes"]
      : []),
    ...(grounding.worldCupData.upcomingMatches.length
      ? ["upcoming fixture schedule", "kickoff times"]
      : []),
    ...(grounding.worldCupData.recentMatches.length
      ? ["recent match results", "match winners"]
      : []),
    ...(ctx?.groupStandings.length
      ? ["group standings", "group points table"]
      : []),
    "stable soccer rules and tactics (offside, formations, pressing, counterattack, false nine, penalties, tiebreakers)",
  ]

  // --- Missing data ---------------------------------------------------------
  const missingData: string[] = [
    ...grounding.dataQuality.missingInputs,
    ...grounding.dataQuality.staleInputs.map((s) => `stale: ${s}`),
    ...grounding.dataQuality.unsupportedInputs.map(
      (u) => `${u} — not available for this pool; suggest checking official tournament sources`
    ),
  ]
  if (grounding.dataQuality.noChargeReason) {
    missingData.push(`note: ${grounding.dataQuality.noChargeReason}`)
  }

  return {
    sport: "world_cup",
    feature: "private_ai",
    userQuestion,
    userRole: mapUserRole(ctx?.userRole),
    entitlements: {
      plan: entitlements?.plan ?? "free",
      tokenBalance: entitlements?.tokenBalance,
    },
    dataSourceDisclosure,
    poolContext,
    sportsData,
    allowedClaims: [...new Set(allowedClaims)],
    missingData: [...new Set(missingData)],
  }
}

/**
 * Serialize a ChimmyGroundingPacket to the compact JSON string sent to the LLM.
 * This is the ONLY payload the LLM should receive besides the system prompt.
 */
export function serializeChimmyGroundingPacket(packet: ChimmyGroundingPacket): string {
  return JSON.stringify(packet, null, 2)
}
