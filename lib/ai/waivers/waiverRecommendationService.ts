/**
 * AI Waiver Recommendation Service
 *
 * Generates personalized waiver wire recommendations considering:
 * - current roster, starting lineup, bench depth
 * - injuries, bye weeks, upcoming schedule
 * - league scoring, FAAB budget, waiver priority
 * - league format, opponent needs, playoff outlook
 * - app-wide add/drop trends, user waiver preferences/history
 *
 * Returns explainable, recommendation-only output. Does NOT submit claims.
 * Deeper analysis routes to Chimmy AI chat (/chimmy/chat?topic=waiver-analysis&leagueId=...).
 *
 * ⚠ WHEN DATA IS MISSING THIS RETURNS NOTHING, NOT A FALLBACK. It used to emit a fabricated
 * placeholder pick whenever the roster or free-agent read failed — and since both reads failed
 * unconditionally (see the note in generateWaiverRecommendations), that placeholder WAS the
 * feature for every AF Pro subscriber. `meta.dataGaps` states why a list is empty; the route
 * turns that into `insufficientData` for the UI.
 */

import { prisma } from "@/lib/prisma"
import { getEffectiveLeagueWaiverSettings } from "@/lib/waiver-wire/settings-service"
import { getRosterPlayerIds } from "@/lib/waiver-wire/roster-utils"
import { getPlayerPoolForSport } from "@/lib/sport-teams/SportPlayerPoolResolver"

export type WaiverRecommendationInput = {
  userId: string
  leagueId: string
  week?: number
  mode: "quick" | "deep"
  includeFaab?: boolean
}

export type WaiverRecommendation = {
  addPlayerId: string
  addPlayerName: string
  dropPlayerId: string | null
  dropPlayerName: string | null
  priority: number
  suggestedFaabBid: number | null
  confidence: "high" | "medium" | "low"
  risk: "high" | "medium" | "low"
  reasoning: string
  deeperAnalysisPath: string
  tags: string[]
}

export type WaiverRecommendationOutput = {
  recommendations: WaiverRecommendation[]
  rosterNeeds: string[]
  leagueContext: {
    leagueId: string
    waiverType: string
    faabBudget: number | null
    faabRemaining: number | null
  }
  generatedAt: string
  meta?: {
    dataGaps: string[]
    mode: "quick" | "deep"
  }
}

/**
 * Generates waiver wire recommendations for a user in a league.
 * Recommendation only — does not submit waiver claims.
 */
export async function generateWaiverRecommendations(
  input: WaiverRecommendationInput
): Promise<WaiverRecommendationOutput> {
  const dataGaps: string[] = []
  const generatedAt = new Date().toISOString()

  // Load league waiver settings
  let waiverSettings: Awaited<ReturnType<typeof getEffectiveLeagueWaiverSettings>> | null = null
  try {
    waiverSettings = await getEffectiveLeagueWaiverSettings(input.leagueId)
  } catch {
    dataGaps.push("waiver_settings_unavailable")
  }

  const waiverType =
    waiverSettings?.normalizedWaiverType ?? waiverSettings?.waiverType ?? "rolling"
  const isFaab = waiverType === "faab"
  const includeFaab = input.includeFaab ?? isFaab

  /*
   * ⚠ THE READS BELOW ARE DELIBERATELY UNGUARDED, AND THAT IS THE FIX.
   *
   * Both of them used to sit in bare `catch {}` blocks that pushed a string onto `dataGaps` and
   * carried on. That turned two permanent, unconditional failures into a 200 with a well-formed
   * recommendation attached: the roster select named `faabBalance` and a `players` relation
   * (Roster has `faabRemaining` and a `playerData` JSON column — neither field exists, so Prisma
   * threw `PrismaClientValidationError` on EVERY call), and the free-agent query read
   * `prisma.leaguePlayer`, a model that has never existed, so it threw `TypeError: Cannot read
   * properties of undefined`. Every subscriber got hardcoded output built on an empty roster and
   * an empty player pool, and nothing anywhere reported a problem.
   *
   * A recommender that cannot read the roster must fail, not guess. Let these throw.
   */
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { id: true, sport: true },
  })
  const sport = (league?.sport ?? "NFL").toUpperCase()

  // Every roster in the league: the user's own drives needs + FAAB, the union drives availability.
  const leagueRosters = await prisma.roster.findMany({
    where: { leagueId: input.leagueId },
    select: { id: true, platformUserId: true, playerData: true, faabRemaining: true },
  })

  /* `platformUserId` holds the session user id — the same key every /api/waiver-wire route uses. */
  const myRoster = leagueRosters.find((r) => r.platformUserId === input.userId) ?? null

  const rosterPlayerIds: string[] = myRoster ? getRosterPlayerIds(myRoster.playerData) : []
  const faabRemaining: number | null =
    typeof myRoster?.faabRemaining === "number" ? myRoster.faabRemaining : null

  if (!myRoster) dataGaps.push("roster_not_found")

  const rosteredIds = new Set<string>()
  for (const r of leagueRosters) {
    for (const id of getRosterPlayerIds(r.playerData)) rosteredIds.add(id)
  }

  // Load user's recent waiver preferences/history. Optional signal — a miss degrades ranking
  // quality without making the answer wrong, so this one stays non-fatal.
  let preferenceContext: string[] = []
  try {
    const { getWaiverPreferenceHints } = await import(
      "@/lib/ai/waivers/waiverPreferenceService"
    )
    preferenceContext = await getWaiverPreferenceHints(input.userId, input.leagueId)
  } catch {
    dataGaps.push("preference_history_unavailable")
  }

  // Roster needs, from the positions actually on the roster.
  const rosterNeeds = await analyzeRosterNeeds(sport, rosterPlayerIds, dataGaps)

  /*
   * Free agents = the sport's fantasy-relevant pool minus everyone rostered in this league.
   * `getPlayerPoolForSport` is the same resolver the Waiver Intelligence tool and the War Room
   * use, so the two surfaces cannot disagree about who is available.
   */
  const pool = await getPlayerPoolForSport(sport, {
    limit: input.mode === "quick" ? 120 : 300,
  })

  const availablePlayers: Array<{ id: string; name: string; position: string }> = pool
    .filter((p) => {
      const ids = [p.player_id, p.external_source_id].filter(Boolean) as string[]
      return !ids.some((id) => rosteredIds.has(id))
    })
    .map((p) => ({
      id: p.player_id,
      name: p.full_name,
      position: (p.position ?? "FLEX").toUpperCase(),
    }))

  if (availablePlayers.length === 0) dataGaps.push("free_agent_pool_empty")

  // Generate recommendations. No data => no recommendations; see buildRecommendations.
  const recommendations = buildRecommendations({
    userId: input.userId,
    leagueId: input.leagueId,
    mode: input.mode,
    rosterPlayerIds,
    rosterNeeds,
    availablePlayers,
    isFaab,
    includeFaab,
    faabRemaining,
    preferenceContext,
    dataGaps,
  })

  const leagueFaabBudget = waiverSettings?.faabBudget ?? null

  return {
    recommendations,
    rosterNeeds,
    leagueContext: {
      leagueId: input.leagueId,
      waiverType,
      faabBudget: typeof leagueFaabBudget === "number" ? leagueFaabBudget : null,
      faabRemaining,
    },
    generatedAt,
    meta: {
      dataGaps,
      mode: input.mode,
    },
  }
}

/**
 * Minimum starters worth carrying, per sport. Any position below its minimum is a need.
 *
 * ⚠ THIS RETURNS `[]` WHEN THE ROSTER IS UNREADABLE, AND THAT IS DELIBERATE.
 * It used to return `["WR_depth", "RB_depth"]` on an empty roster and
 * `["WR_depth", "RB_depth", "TE_upgrade"]` otherwise — the same two or three strings for every
 * user in every league in every sport, regardless of what they actually rostered. Paired with a
 * roster query that always threw, that hardcoded pair WAS the product: it is what
 * `buildReasoning` cited back to the user as "fills a roster need". An empty list is honest and
 * the caller reports it through `dataGaps`; an invented list is indistinguishable from analysis.
 */
const POSITION_MINIMUMS: Record<string, Record<string, number>> = {
  NFL: { QB: 1, RB: 2, WR: 2, TE: 1 },
  NCAAF: { QB: 1, RB: 2, WR: 2, TE: 1 },
  NBA: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1 },
  NCAAB: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1 },
  NHL: { C: 1, LW: 1, RW: 1, D: 1, G: 1 },
  MLB: { P: 2, C: 1, OF: 2 },
  SOCCER: { FWD: 1, MID: 1, DEF: 1, GK: 1 },
}

async function analyzeRosterNeeds(
  sport: string,
  rosterPlayerIds: string[],
  dataGaps: string[]
): Promise<string[]> {
  if (rosterPlayerIds.length === 0) {
    dataGaps.push("cannot_analyze_roster_needs_no_roster")
    return []
  }

  const minimums = POSITION_MINIMUMS[sport]
  if (!minimums) {
    dataGaps.push(`no_position_minimums_for_sport_${sport.toLowerCase()}`)
    return []
  }

  /* One query, not one per player — this runs on a request path. Roster ids arrive in whichever
   * id space the source platform used, so all three are matched. */
  const ids = rosterPlayerIds.slice(0, 200)
  const rows = await prisma.sportsPlayer.findMany({
    where: {
      sport,
      OR: [{ id: { in: ids } }, { externalId: { in: ids } }, { sleeperId: { in: ids } }],
    },
    select: { position: true },
  })

  if (rows.length === 0) {
    dataGaps.push("roster_players_unresolved")
    return []
  }
  if (rows.length < ids.length) {
    dataGaps.push(`roster_players_partially_resolved_${rows.length}_of_${ids.length}`)
  }

  const counts = new Map<string, number>()
  for (const r of rows) {
    const pos = (r.position ?? "UNK").toUpperCase()
    counts.set(pos, (counts.get(pos) ?? 0) + 1)
  }

  const needs: string[] = []
  for (const [pos, min] of Object.entries(minimums)) {
    if ((counts.get(pos) ?? 0) < min) needs.push(pos)
  }
  return needs
}

type BuildRecsInput = {
  userId: string
  leagueId: string
  mode: "quick" | "deep"
  rosterPlayerIds: string[]
  rosterNeeds: string[]
  availablePlayers: Array<{ id: string; name: string; position: string }>
  isFaab: boolean
  includeFaab: boolean
  faabRemaining: number | null
  preferenceContext: string[]
  dataGaps: string[]
}

function buildRecommendations(ctx: BuildRecsInput): WaiverRecommendation[] {
  const count = ctx.mode === "quick" ? 3 : 5

  /*
   * ⚠ NO RECOMMENDATIONS IS A VALID ANSWER. DO NOT PUT A PLACEHOLDER HERE.
   *
   * This branch used to return one fabricated pick — `addPlayerId: "unknown"`, name
   * "Best available WR", a real-looking FAAB bid computed off the user's actual budget, and prose
   * about "target share and upcoming schedule" that no data supported. Because the free-agent
   * query above always threw, this was the ONLY branch that ever ran, so that invented WR was the
   * entire feature. The `TODO:data_gap` tag was the sole marker, and nothing in the UI surfaced
   * it. Callers should read `meta.dataGaps` and tell the user why the list is empty.
   */
  if (ctx.availablePlayers.length === 0) return []

  return ctx.availablePlayers.slice(0, count).map((player, i) => {
    const faabBid = ctx.includeFaab && ctx.faabRemaining != null
      ? suggestFaabBid(i, ctx.faabRemaining)
      : null

    return {
      addPlayerId: player.id,
      addPlayerName: player.name,
      dropPlayerId: null,
      dropPlayerName: null,
      priority: i + 1,
      suggestedFaabBid: faabBid,
      confidence: i === 0 ? "medium" : "low",
      risk: "medium",
      reasoning: buildReasoning(player, ctx),
      deeperAnalysisPath: buildDeeperAnalysisPath(ctx.leagueId),
      tags: buildTags(player, ctx),
    }
  })
}

function suggestFaabBid(priority: number, faabRemaining: number): number {
  // Tiered bid strategy: higher priority = larger slice of remaining budget
  const slices = [0.15, 0.1, 0.07, 0.05, 0.03]
  const slice = slices[priority] ?? 0.03
  return Math.max(1, Math.floor(faabRemaining * slice))
}

function buildReasoning(
  player: { name: string; position: string },
  ctx: BuildRecsInput
): string {
  /* Only claim a need when one was actually computed. The previous copy asserted "fills a roster
   * need" for every player unconditionally, including when `rosterNeeds` was empty. */
  const fillsNeed = ctx.rosterNeeds.includes(player.position)
  const needsStr = fillsNeed
    ? ` Fills a roster need at ${player.position}.`
    : ""
  return `${player.name} (${player.position}) is available in this league.${needsStr} Deeper analysis via Chimmy recommended.`
}

/*
 * `id` is in the parameter type because the body reads it. It was typed `{ name; position }` while
 * dereferencing `player.id`, so `matches_preference` compared `undefined` against the preference
 * list and could never be true — the tag existed but never once applied. One of the standing
 * baseline errors in this file, and a real behavioural bug rather than type noise.
 */
function buildTags(
  player: { id: string; name: string; position: string },
  ctx: BuildRecsInput
): string[] {
  const tags = [player.position, "waiver_target"]
  if (ctx.isFaab) tags.push("faab")
  if (ctx.preferenceContext.includes(player.id)) tags.push("matches_preference")
  return tags
}

function buildDeeperAnalysisPath(leagueId: string): string {
  return `/chimmy/chat?topic=waiver-analysis&leagueId=${encodeURIComponent(leagueId)}`
}
