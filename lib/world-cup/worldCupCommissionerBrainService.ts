import "server-only"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { analyzeWorldCupEntryPickCompletion } from "./worldCupBracketCompletionService"
import {
  isWorldCupChallengeLocked,
  resolveWorldCupEffectivePickLockAt,
} from "./worldCupBracketBuilder"
import { worldCupBracketPicksPublicUrl } from "./worldCupBracketReminderService"
import { buildWorldCupLeaderboardRows } from "./worldCupScoringService"
import type { DbEntryForLb, DbMatch, DbPick } from "./worldCupScoringService"
import type { WorldCupRound } from "./types"
import {
  buildPoolSwingAlertCard,
  buildChampionPickRiskCard,
  buildRootingGuideCard,
  buildCommissionerRecapCard,
  type InsightCard,
} from "./worldCupInsightCards"
import { routeTextCall } from "@/lib/ai/providerRouter"
import { applyValidationPipeline } from "@/lib/ai/responseValidator"
import { buildFreshnessLabel, type AIGroundingContract } from "@/lib/ai/aiGroundingContract"
import { logAiInteraction } from "@/lib/ai/auditLogger"
import type { UserRole, FeatureKey } from "@/lib/ai/engine/types"
import {
  hashGroundingPacket,
  getOrCreateWcCommissionerInsight,
} from "@/lib/ai/aiInsightCache"

// Re-export so callers only need one import
export type { InsightCard } from "./worldCupInsightCards"

type WorldCupCommissionerBrainSnapshot = {
  incompleteBracketCount: number
  completedBracketCount: number
  totalEntries: number
  totalMissingPicks: number
  maxEntriesPerParticipant: number
  lockCountdownMs: number | null
  effectiveLockAt: string | null
  isLocked: boolean
  mostPopularChampion: { teamName: string; count: number } | null
  /** Heuristic: pick that appears least often across entries (may be null). */
  mostUniqueLean: string | null
  usersMaxedEntries: number
  biggestUpsetLean: string | null
  /** Users who still have at least one incomplete bracket entry. */
  usersWithIncompleteBrackets: Array<{
    userId: string
    displayName: string
    incompleteEntryCount: number
    missingPicks: number
  }>
  /** Entries that still need picks (projection-based). */
  entriesMissingPicks: Array<{
    entryId: string
    entryName: string
    missingPicks: number
    userId: string
  }>
}

export type WorldCupAiRecapTone = "fun" | "serious" | "hype"

const COMMISSIONER_BRAIN_PICK_SELECT = {
  id: true,
  matchId: true,
  round: true,
  selectedTeamId: true,
  selectedSlotKey: true,
  selectedTeamName: true,
  pointsAwarded: true,
  isCorrect: true,
} satisfies Prisma.WorldCupBracketPickSelect

const COMMISSIONER_BRAIN_PICK_WITH_MATCH_SELECT = {
  ...COMMISSIONER_BRAIN_PICK_SELECT,
  match: true,
} satisfies Prisma.WorldCupBracketPickSelect

const FORBIDDEN_RECAP_TERMS = [
  /\bdfs\b/gi,
  /\bbetting\b/gi,
  /\bwager(?:ing|s|ed)?\b/gi,
  /\bsportsbook\b/gi,
  /\bodds\b/gi,
]

function sanitizeRecapLine(line: string) {
  return FORBIDDEN_RECAP_TERMS.reduce(
    (text, pattern) => text.replace(pattern, "prediction"),
    line
  ).replace(/\s+/g, " ").trim()
}

function toneLead(tone: WorldCupAiRecapTone) {
  if (tone === "serious") return "Commissioner recap"
  if (tone === "hype") return "Pool heat check"
  return "Chimmy pool recap"
}

export async function buildWorldCupAiPoolRecapLines(
  challengeId: string,
  tone: WorldCupAiRecapTone = "fun"
): Promise<string[]> {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    include: {
      matches: true,
      scoringProfile: true,
      entries: {
        where: {
          isComplete: true,
          submittedAt: { not: null },
        },
        include: {
          picks: { select: COMMISSIONER_BRAIN_PICK_SELECT },
          participant: true,
          groupRankingPicks: {
            select: {
              predictedRank: true,
              actualRank: true,
            },
          },
        },
      },
    },
  })
  if (!challenge) return []

  const finalizedEntries = challenge.entries
  const rows = buildWorldCupLeaderboardRows({
    entries: finalizedEntries as unknown as DbEntryForLb[],
    matches: challenge.matches as unknown as DbMatch[],
    scoring: challenge.scoringProfile,
  })
  const sortedRows = [...rows].sort((a, b) => a.rank - b.rank || b.totalScore - a.totalScore)
  const leader = sortedRows[0] ?? null
  const runnerUp = sortedRows[1] ?? null
  const scoreGap = leader && runnerUp ? Math.max(0, leader.totalScore - runnerUp.totalScore) : null

  const championCounts = new Map<string, number>()
  for (const entry of finalizedEntries) {
    const championName =
      entry.championTeamName?.trim() ||
      entry.picks?.find((pick) => pick.round === "final")?.selectedTeamName?.trim()
    if (!championName) continue
    championCounts.set(championName, (championCounts.get(championName) ?? 0) + 1)
  }
  const mostCommonChampion = [...championCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null
  const finalGroupMatches = challenge.matches.filter((match) => match.round === "group" && match.status === "final").length
  const totalGroupMatches = challenge.matches.filter((match) => match.round === "group").length
  const thirdPlacePickCount = finalizedEntries.reduce(
    (sum, entry) => sum + (entry.picks ?? []).filter((pick) => pick.round === "third_place").length,
    0
  )

  const lines = [
    `${toneLead(tone)}: ${challenge.name}`,
    leader
      ? `Current leader: ${leader.entryName} with ${leader.totalScore} points.`
      : "Current leader: no finalized leaderboard rows yet.",
    scoreGap != null
      ? scoreGap <= 5
        ? `Closest race: ${leader?.entryName} and ${runnerUp?.entryName} are separated by ${scoreGap} points.`
        : `Closest race: the top gap is ${scoreGap} points.`
      : "Closest race: waiting for a second finalized entry.",
    `Finalized entries included: ${finalizedEntries.length}.`,
    mostCommonChampion
      ? `Most common champion pick: ${mostCommonChampion[0]} on ${mostCommonChampion[1]} finalized entr${mostCommonChampion[1] === 1 ? "y" : "ies"}.`
      : "Most common champion pick: not available from finalized entries yet.",
    totalGroupMatches > 0
      ? `Group-stage status: ${finalGroupMatches}/${totalGroupMatches} group matches final.`
      : "Group-stage status: fixture data is still being prepared.",
    thirdPlacePickCount > 0
      ? `Chaos note: third-place choices are already shaping the bracket paths across finalized entries.`
      : `Chaos note: watch third-place paths once more finalized brackets land.`,
    "Prediction and scoring complexity only. No restricted pool-content language is included.",
  ]

  return lines.map(sanitizeRecapLine).filter(Boolean)
}

export async function getWorldCupCommissionerBrainSnapshot(
  challengeId: string
): Promise<WorldCupCommissionerBrainSnapshot | null> {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    include: {
      matches: true,
      scoringProfile: true,
      entries: {
        include: {
          picks: { select: COMMISSIONER_BRAIN_PICK_SELECT },
          participant: true,
          groupRankingPicks: {
            select: {
              predictedRank: true,
              actualRank: true,
            },
          },
        },
      },
    },
  })
  if (!challenge) return null

  const entries = challenge.entries
  const analyses = entries.map((e) =>
    analyzeWorldCupEntryPickCompletion({
      matches: challenge.matches as unknown as DbMatch[],
      picks: e.picks as unknown as DbPick[],
      includeThirdPlace: challenge.includeThirdPlace,
      entryId: e.id,
      userId: e.userId,
      entryName: e.name,
      displayName: e.participant?.displayName ?? "Player",
    })
  )
  const incompleteAnalyses = analyses.filter((a) => !a.isComplete)
  const completedAnalyses = analyses.filter((a) => a.isComplete)
  const incompleteBracketCount = incompleteAnalyses.length
  const completedBracketCount = completedAnalyses.length
  const totalMissingPicks = incompleteAnalyses.reduce(
    (s, a) => s + a.missingPickCount,
    0
  )

  const userAgg = new Map<
    string,
    { displayName: string; incompleteEntryCount: number; missingPicks: number }
  >()
  for (const a of incompleteAnalyses) {
    const cur = userAgg.get(a.userId) ?? {
      displayName: a.displayName,
      incompleteEntryCount: 0,
      missingPicks: 0,
    }
    cur.incompleteEntryCount += 1
    cur.missingPicks += a.missingPickCount
    userAgg.set(a.userId, cur)
  }
  const usersWithIncompleteBrackets = [...userAgg.entries()].map(([userId, v]) => ({
    userId,
    displayName: v.displayName,
    incompleteEntryCount: v.incompleteEntryCount,
    missingPicks: v.missingPicks,
  }))
  const entriesMissingPicks = incompleteAnalyses.map((a) => ({
    entryId: a.entryId,
    entryName: a.entryName,
    missingPicks: a.missingPickCount,
    userId: a.userId,
  }))

  const championCounts = new Map<string, number>()
  for (const e of entries) {
    const name =
      e.championTeamName?.trim() ||
      e.picks?.find((p) => p.round === "final")?.selectedTeamName?.trim()
    if (!name) continue
    championCounts.set(name, (championCounts.get(name) ?? 0) + 1)
  }
  let mostPopularChampion: { teamName: string; count: number } | null = null
  for (const [teamName, count] of championCounts) {
    if (!mostPopularChampion || count > mostPopularChampion.count) {
      mostPopularChampion = { teamName, count }
    }
  }

  const pickSignatures = entries.map((e) =>
    (e.picks ?? [])
      .map((p) => `${p.matchId}:${p.selectedTeamId ?? p.selectedTeamName}`)
      .sort()
      .join("|")
  )
  const sigCount = new Map<string, number>()
  for (const s of pickSignatures) sigCount.set(s, (sigCount.get(s) ?? 0) + 1)
  let mostUniqueLean: string | null = null
  let minC = Infinity
  for (const [sig, c] of sigCount) {
    if (c < minC && sig.length > 0) {
      minC = c
      mostUniqueLean = `Bracket signature shared by ${c} entr${c === 1 ? "y" : "ies"}`
    }
  }

  const byUser = new Map<string, number>()
  for (const e of entries) {
    byUser.set(e.userId, (byUser.get(e.userId) ?? 0) + 1)
  }
  const usersMaxedEntries = [...byUser.values()].filter(
    (n) => n >= challenge.maxEntriesPerParticipant
  ).length

  const eff = resolveWorldCupEffectivePickLockAt({
    pickLockStrategy: challenge.pickLockStrategy,
    pickLockAt: challenge.pickLockAt,
    matches: challenge.matches,
  })
  const effectiveLockAt = eff ? eff.toISOString() : null
  const lockMs = eff ? eff.getTime() - Date.now() : null

  const locked = isWorldCupChallengeLocked({
    challenge,
    matches: challenge.matches,
  }).locked

  const rows = buildWorldCupLeaderboardRows({
    entries: entries as unknown as DbEntryForLb[],
    matches: challenge.matches as unknown as DbMatch[],
    scoring: challenge.scoringProfile,
  })
  let biggestUpsetLean: string | null = null
  if (rows.length > 0) {
    const top = rows[0]
    biggestUpsetLean = `${top.entryName} leads at ${top.totalScore} pts — compare chalk vs darlings in pool chat.`
  }

  return {
    incompleteBracketCount,
    completedBracketCount,
    totalEntries: entries.length,
    totalMissingPicks,
    maxEntriesPerParticipant: challenge.maxEntriesPerParticipant,
    lockCountdownMs: lockMs,
    effectiveLockAt,
    isLocked: locked,
    mostPopularChampion,
    mostUniqueLean,
    usersMaxedEntries,
    biggestUpsetLean,
    usersWithIncompleteBrackets,
    entriesMissingPicks,
  }
}

async function buildIncompleteBracketReminderLines(challengeId: string) {
  const snap = await getWorldCupCommissionerBrainSnapshot(challengeId)
  if (!snap) return []
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    select: { name: true },
  })
  const lines: string[] = []
  lines.push(`You're not done yet — ${snap.incompleteBracketCount} bracket${snap.incompleteBracketCount === 1 ? "" : "s"} still incomplete in "${challenge?.name ?? "this pool"}".`)
  lines.push(`Tap Picks and finish every matchup before the lock.`)
  return lines
}

/** Full commissioner reminder: league name, lock time, missing picks, deep link, sample rows. */
export async function buildIncompleteBracketReminderDetailedLines(
  challengeId: string
): Promise<string[]> {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    select: { name: true },
  })
  const snap = await getWorldCupCommissionerBrainSnapshot(challengeId)
  if (!snap || !challenge) return []

  const lockLabel = snap.effectiveLockAt
    ? new Date(snap.effectiveLockAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "TBD"

  const url = worldCupBracketPicksPublicUrl(challengeId)
  const lines: string[] = [
    `Finish your bracket in "${challenge.name}" before the lock (${lockLabel}).`,
    `${snap.incompleteBracketCount} incomplete entr${snap.incompleteBracketCount === 1 ? "y" : "ies"}, ~${snap.totalMissingPicks} pick${snap.totalMissingPicks === 1 ? "" : "s"} still needed across the pool.`,
    `Open picks: ${url}`,
  ]
  if (snap.entriesMissingPicks.length > 0) {
    lines.push(
      snap.entriesMissingPicks
        .slice(0, 6)
        .map(
          (e) =>
            `• ${e.entryName}: missing ${e.missingPicks} pick${e.missingPicks === 1 ? "" : "s"}`
        )
        .join("\n")
    )
  }
  return lines
}

/** Generic pool reminder (no per-entry breakdown). */
export async function buildPoolBroadcastReminderLines(
  challengeId: string
): Promise<string[]> {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    select: { name: true },
  })
  const snap = await getWorldCupCommissionerBrainSnapshot(challengeId)
  const lockLabel = snap?.effectiveLockAt
    ? new Date(snap.effectiveLockAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "soon"
  const url = worldCupBracketPicksPublicUrl(challengeId)
  return [
    `Pool reminder: "${challenge?.name ?? "Bracket"}" — submit picks before ${lockLabel}.`,
    url,
  ]
}

export async function buildStandingsSummaryLines(challengeId: string) {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    include: {
      matches: true,
      scoringProfile: true,
      // Only finalized/submitted entries are included — unfinalized private picks
      // must not be sent to OpenAI or posted publicly.
      entries: {
        where: {
          isComplete: true,
          submittedAt: { not: null },
        },
        include: {
          picks: { select: COMMISSIONER_BRAIN_PICK_SELECT },
          participant: true,
          groupRankingPicks: {
            select: {
              predictedRank: true,
              actualRank: true,
            },
          },
        },
      },
    },
  })
  if (!challenge) return []
  if (challenge.entries.length === 0) {
    return [
      "No finalized brackets are available yet. Finalized entries will appear in the AI standings summary once participants submit their brackets.",
    ]
  }
  const rows = buildWorldCupLeaderboardRows({
    entries: challenge.entries as unknown as DbEntryForLb[],
    matches: challenge.matches as unknown as DbMatch[],
    scoring: challenge.scoringProfile,
  })
  const lines: string[] = [`Standings (${challenge.name})`]
  rows.slice(0, 12).forEach((r, i) => {
    lines.push(`${i + 1}. ${r.entryName} — ${r.totalScore} pts`)
  })
  return lines
}

async function buildLeagueHypeLines(challengeId: string) {
  const snap = await getWorldCupCommissionerBrainSnapshot(challengeId)
  if (!snap) return ["Let's go — bracket pool is heating up."]
  const crown = snap.mostPopularChampion
    ? `${snap.mostPopularChampion.teamName} (${snap.mostPopularChampion.count} picks)`
    : "split across the field"
  return [
    `${snap.totalEntries} brackets · ${snap.completedBracketCount} submitted`,
    `Chalk radar: ${crown}`,
    snap.lockCountdownMs != null && snap.lockCountdownMs > 0
      ? `Lock countdown ticking — finish picks.`
      : `Good luck — enjoy the tournament.`,
  ]
}

async function buildWhatToWatchLines(challengeId: string) {
  const matches = await prisma.worldCupBracketMatch.findMany({
    where: { challengeId },
    orderBy: [{ startsAt: "asc" }],
    take: 16,
  })
  const soon = matches.filter(
    (m) =>
      m.status !== "final" &&
      m.startsAt &&
      new Date(m.startsAt).getTime() - Date.now() < 48 * 3600 * 1000
  )
  const lines: string[] = ["What to watch"]
  for (const m of soon.slice(0, 8)) {
    const t = m.startsAt ? new Date(m.startsAt).toISOString() : "TBD"
    lines.push(`${m.homeTeamName} vs ${m.awayTeamName} — ${m.status} (${t})`)
  }
  if (lines.length === 1) lines.push("Sync live scores to populate kickoff times.")
  return lines
}

async function buildPostRoundRecapLines(challengeId: string, round: WorldCupRound) {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    include: {
      matches: true,
      scoringProfile: true,
      entries: {
        include: {
          picks: { select: COMMISSIONER_BRAIN_PICK_WITH_MATCH_SELECT },
          participant: true,
          groupRankingPicks: {
            select: {
              predictedRank: true,
              actualRank: true,
            },
          },
        },
      },
    },
  })
  if (!challenge) return []
  const inRound = challenge.matches.filter((m) => m.round === round && m.status === "final")
  const lines: string[] = [`${round.replace(/_/g, " ")} recap`]
  lines.push(`${inRound.length} match${inRound.length === 1 ? "" : "es"} final.`)

  const rows = buildWorldCupLeaderboardRows({
    entries: challenge.entries as unknown as DbEntryForLb[],
    matches: challenge.matches as unknown as DbMatch[],
    scoring: challenge.scoringProfile,
  })
  if (rows[0]) lines.push(`Leader: ${rows[0].entryName} (${rows[0].totalScore} pts)`)
  return lines
}

async function buildPathToWinLines(challengeId: string, entryId: string) {
  const entry = await prisma.worldCupBracketEntry.findUnique({
    where: { id: entryId },
    include: {
      picks: { select: COMMISSIONER_BRAIN_PICK_WITH_MATCH_SELECT },
      challenge: { include: { matches: true } },
    },
  })
  if (!entry || entry.challengeId !== challengeId) return []
  const remaining = entry.picks.filter((p) => p.match?.status !== "final").length
  return [
    `${entry.name}: ${remaining} matchup${remaining === 1 ? "" : "s"} still pending.`,
    `Max points path depends on remaining picks hitting favorites — stay sharp.`,
  ]
}

// Static minimal contract for commissioner brain validation.
// liveScores=null → score_invention rule fires if AI invents a score.
// oddsData=null   → odds_without_data rule fires if AI references favorites.
// plan="commissioner" → plan_gate_violation rule does NOT fire.
const COMMISSIONER_VALIDATION_CONTRACT: AIGroundingContract = {
  contractVersion: "af-contract-v1",
  sport: "world_cup",
  feature: "commissioner_brain" as FeatureKey,
  userRole: "commissioner" as UserRole,
  plan: "commissioner",
  locale: null,
  sourceFreshness: buildFreshnessLabel("pool_only", null),
  poolContext: {
    poolId: "commissioner-brain",
    poolName: "World Cup Pool",
    totalEntries: 0,
    sport: "world_cup",
    format: "bracket",
    currentPhase: "active",
    prizePool: null,
  },
  scoringContext: null,
  userPicks: null,
  leaderboard: null,
  providerFixtures: null,
  liveScores: null,
  oddsData: null,
  computedInsights: {},
  missingData: ["live match scores (live feed not loaded)", "odds and favorites data"],
  allowedClaims: ["AllFantasy pool data, pick distribution, and entry scores"],
  forbiddenClaims: [
    "any live match score or current result — live feed not loaded",
    "team favorite status or any odds/spread — no odds data loaded",
  ],
}

async function maybeEnhanceWithOpenAi(
  prompt: string,
  opts?: { featureHint?: string; challengeId?: string; kind?: string },
): Promise<string | null> {
  try {
    // ── AiInsightCache: skip LLM if same pool state + same kind was recently generated
    // groundingHash = sha256 of the deterministic prompt (captures pool state).
    // When pool data changes → base lines change → new prompt → new hash → cache miss.
    const groundingHash = hashGroundingPacket({ prompt })

    const cacheResult = opts?.challengeId
      ? await getOrCreateWcCommissionerInsight(
          {
            challengeId: opts.challengeId,
            kind: opts.kind ?? opts.featureHint ?? "generic",
            groundingHash,
          },
          async () => {
            const llmResult = await routeTextCall({
              messages: [
                {
                  role: "system",
                  content:
                    "You are Chimmy, calm bracket commissioner copywriter. Rewrite only the provided World Cup pool facts. Do not add scores, schedules, match minutes, player stats, injuries, odds, lineups, or standings that are not present in the prompt. If a requested fact is missing, say reliable data is not available yet. Short paragraphs, no hype slang.",
                },
                {
                  role: "user",
                  content:
                    "Source: stored AllFantasy pool data only; no external live feed is included in this request.\n\n" +
                    prompt,
                },
              ],
              profile: "cheap",
              temperature: 0.4,
              maxTokens: 400,
              skipCache: true,
            })
            if (!llmResult.ok) return { resultText: null }
            const rawText = llmResult.text?.trim() ?? null
            if (!rawText) return { resultText: null }
            const sanitized = sanitizeRecapLine(rawText)
            const validated = applyValidationPipeline(sanitized, COMMISSIONER_VALIDATION_CONTRACT)
            return {
              resultText: validated,
              tokensUsed: llmResult.tokensUsed ?? null,
              provider: llmResult.provider,
              model: llmResult.model,
            }
          }
        )
      : null

    if (cacheResult) {
      // Fire-and-forget audit log (skip token count on cache hits)
      logAiInteraction({
        sport: "world_cup",
        feature: opts?.featureHint ?? "commissioner_brain",
        route: "/api/brackets/world-cup/[challengeId]/commissioner-brain",
        plan: "commissioner",
        providerSource: cacheResult.cacheHit ? "cache" : (cacheResult.provider ?? "unknown"),
        freshnessTier: "pool_only",
        validatorResult: "clean",
        modelUsed: cacheResult.cacheHit ? null : cacheResult.model,
        tokenCost: cacheResult.cacheHit ? null : cacheResult.tokensUsed,
        wasDeterministic: false,
      })
      return cacheResult.text || null
    }

    // Fallback: no challengeId supplied — call LLM directly (legacy callers)
    const result = await routeTextCall({
      messages: [
        {
          role: "system",
          content:
            "You are Chimmy, calm bracket commissioner copywriter. Rewrite only the provided World Cup pool facts. Do not add scores, schedules, match minutes, player stats, injuries, odds, lineups, or standings that are not present in the prompt. If a requested fact is missing, say reliable data is not available yet. Short paragraphs, no hype slang.",
        },
        {
          role: "user",
          content:
            "Source: stored AllFantasy pool data only; no external live feed is included in this request.\n\n" +
            prompt,
        },
      ],
      profile: "cheap",
      temperature: 0.4,
      maxTokens: 400,
      skipCache: true,
    })
    if (!result.ok) return null
    const rawText = result.text?.trim() ?? null
    if (!rawText) return null

    const sanitized = sanitizeRecapLine(rawText)
    const validated = applyValidationPipeline(sanitized, COMMISSIONER_VALIDATION_CONTRACT)

    logAiInteraction({
      sport: "world_cup",
      feature: opts?.featureHint ?? "commissioner_brain",
      route: "/api/brackets/world-cup/[challengeId]/commissioner-brain",
      plan: "commissioner",
      providerSource: result.provider,
      freshnessTier: "pool_only",
      validatorResult: "clean",
      modelUsed: result.model,
      tokenCost: result.tokensUsed ?? null,
      wasDeterministic: false,
    })

    return validated
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// New proactive commissioner generators
// ---------------------------------------------------------------------------

/** Chalk concentration + "if X loses, the leaderboard flips" narrative. */
async function buildChalkBustNarrativeLines(challengeId: string): Promise<string[]> {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    include: {
      matches: true,
      scoringProfile: true,
      entries: {
        where: { isComplete: true, submittedAt: { not: null } },
        include: { picks: { select: COMMISSIONER_BRAIN_PICK_SELECT } },
      },
    },
  })
  if (!challenge || challenge.entries.length === 0) {
    return ["No finalized entries yet to analyze champion pick concentration."]
  }

  const entries = challenge.entries
  const champCounts = new Map<string, number>()
  const entryChampMap = new Map<string, string>()

  type EntryRow = { id: string; name: string; championTeamName?: string | null; picks?: Array<{ round: string; selectedTeamName?: string | null }> }
  for (const entry of entries as EntryRow[]) {
    const name =
      entry.championTeamName?.trim() ||
      entry.picks?.find((p) => p.round === "final")?.selectedTeamName?.trim()
    if (!name) continue
    champCounts.set(name, (champCounts.get(name) ?? 0) + 1)
    entryChampMap.set(entry.id, name)
  }

  const sortedChamps = [...champCounts.entries()].sort((a, b) => b[1] - a[1])
  const topChamp = sortedChamps[0]
  if (!topChamp) return ["Champion picks are not recorded yet."]

  const topChampPct = Math.round((topChamp[1] / entries.length) * 100)

  const rows = buildWorldCupLeaderboardRows({
    entries: entries as unknown as DbEntryForLb[],
    matches: challenge.matches as unknown as DbMatch[],
    scoring: challenge.scoringProfile,
  })
  const topEntries = rows.slice(0, 10)
  const topTenChalk = topEntries.filter((row) => {
    const entry = (entries as EntryRow[]).find((e) => e.name === row.entryName)
    return entry != null && entryChampMap.get(entry.id) === topChamp[0]
  }).length

  const lines: string[] = [
    `Chalk watch: ${topChamp[0]} is the champion pick on ${topChamp[1]} of ${entries.length} finalized entr${entries.length === 1 ? "y" : "ies"} (${topChampPct}%).`,
  ]

  if (topEntries.length > 0 && topTenChalk > 0) {
    lines.push(
      `${topTenChalk} of the top ${topEntries.length} entries are riding ${topChamp[0]} — if they get eliminated, the leaderboard reshuffles.`
    )
  }

  const secondChamp = sortedChamps[1]
  if (secondChamp && secondChamp[1] >= 2) {
    const secondPct = Math.round((secondChamp[1] / entries.length) * 100)
    lines.push(
      `Contrarian angle: ${secondChamp[0]} has ${secondChamp[1]} entries (${secondPct}%) — could be the sleeper if ${topChamp[0]} falters.`
    )
  }

  if (topChampPct >= 60) {
    lines.push(`Heavy chalk pool — one big upset and half the field takes damage.`)
  } else if (topChampPct <= 25 && entries.length >= 4) {
    lines.push(`Diverse picks across the pool — no single chalk pick dominates.`)
  }

  return lines.map(sanitizeRecapLine)
}

/** Which upcoming match has the biggest leaderboard swing potential. */
async function buildMatchSwingLines(challengeId: string): Promise<string[]> {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    include: {
      matches: true,
      scoringProfile: true,
      entries: {
        where: { isComplete: true, submittedAt: { not: null } },
        include: { picks: { select: COMMISSIONER_BRAIN_PICK_SELECT } },
      },
    },
  })
  if (!challenge) return []

  type MatchRow = { id: string; status: string; homeTeamName: string; awayTeamName: string; round: string; startsAt?: Date | string | null }
  type PickRow = { matchId: string; selectedTeamName: string | null }
  type EntryWithPicks = { picks?: PickRow[] }

  const upcoming = (challenge.matches as MatchRow[]).filter(
    (m) => m.status !== "final" && m.homeTeamName && m.awayTeamName
  )
  if (upcoming.length === 0) return ["No upcoming matches to analyze for leaderboard swing."]
  if (challenge.entries.length === 0) {
    return ["No finalized entries yet — swing analysis requires submitted brackets."]
  }

  const allPicks = (challenge.entries as EntryWithPicks[]).flatMap((e) => e.picks ?? [])
  const sc = challenge.scoringProfile
  const roundPoints: Record<string, number> = {
    group: sc?.roundOf32Points ?? 1,
    round_of_32: sc?.roundOf32Points ?? 1,
    round_of_16: sc?.roundOf16Points ?? 2,
    quarter_final: sc?.quarterFinalPoints ?? 4,
    semi_final: sc?.semiFinalPoints ?? 8,
    final: sc?.finalPoints ?? 16,
    third_place: 2,
  }

  type SwingCandidate = {
    home: string
    away: string
    homePicks: number
    awayPicks: number
    swingScore: number
    round: string
    pts: number
  }

  let topSwing: SwingCandidate | null = null

  for (const match of upcoming) {
    const matchPicks = allPicks.filter((p: PickRow) => p.matchId === match.id)
    const homePicks = matchPicks.filter((p: PickRow) => p.selectedTeamName === match.homeTeamName).length
    const awayPicks = matchPicks.filter((p: PickRow) => p.selectedTeamName === match.awayTeamName).length
    const totalPicks = homePicks + awayPicks
    if (totalPicks === 0) continue

    const pts = roundPoints[match.round] ?? 1
    const loserCount = Math.min(homePicks, awayPicks)
    const swingScore = loserCount * pts

    if (!topSwing || swingScore > topSwing.swingScore) {
      topSwing = { home: match.homeTeamName, away: match.awayTeamName, homePicks, awayPicks, swingScore, round: match.round, pts }
    }
  }

  if (!topSwing) {
    return ["No pick data found for upcoming matches yet — swing analysis needs submitted brackets."]
  }

  const biggerCount = Math.max(topSwing.homePicks, topSwing.awayPicks)
  const smallerCount = Math.min(topSwing.homePicks, topSwing.awayPicks)
  const biggerTeam = topSwing.homePicks >= topSwing.awayPicks ? topSwing.home : topSwing.away
  const smallerTeam = topSwing.homePicks >= topSwing.awayPicks ? topSwing.away : topSwing.home

  return [
    `Biggest leaderboard swing: ${topSwing.home} vs ${topSwing.away} (${topSwing.round.replace(/_/g, " ")}).`,
    `${biggerCount} ${biggerCount === 1 ? "entry" : "entries"} picked ${biggerTeam} · ${smallerCount} picked ${smallerTeam}.`,
    `The ${smallerCount} ${smallerTeam} side each risk losing ${topSwing.pts} pts — whoever is wrong drops. Watch this one closely.`,
  ].map(sanitizeRecapLine)
}

/** Playful trash-talk prompt ready to post to the group. */
async function buildTrashTalkLines(challengeId: string): Promise<string[]> {
  const [snap, challenge] = await Promise.all([
    getWorldCupCommissionerBrainSnapshot(challengeId),
    prisma.worldCupBracketChallenge.findUnique({
      where: { id: challengeId },
      select: { name: true },
    }),
  ])
  if (!snap || !challenge) return []

  const leader = snap.biggestUpsetLean?.split(" leads")[0]?.trim() ?? null
  const popular = snap.mostPopularChampion?.teamName ?? null

  const lines: string[] = []

  if (leader) {
    lines.push(`${leader} is sitting on top of "${challenge.name}" right now. Comfortable? Don't be. 👀`)
  }

  if (popular && snap.mostPopularChampion && snap.mostPopularChampion.count >= 2) {
    lines.push(
      `${snap.mostPopularChampion.count} of you went chalk and picked ${popular} to win it all. Bold. Hope you're right. 🏆`
    )
  }

  if (snap.mostUniqueLean) {
    lines.push(`Someone in this pool has a completely unique bracket. You already know who you are. 🎯`)
  }

  if (snap.incompleteBracketCount > 0 && !snap.isLocked) {
    lines.push(
      `Still ${snap.incompleteBracketCount} bracket${snap.incompleteBracketCount === 1 ? "" : "s"} not submitted — don't be that person when the results start landing. 🔒`
    )
  }

  lines.push(`Let's gooo 🔥 — ${challenge.name}`)

  return lines.map(sanitizeRecapLine)
}

/** Entries that face a steep uphill to reach the leader — names the gap explicitly. */
async function buildAtRiskUsersLines(challengeId: string): Promise<string[]> {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    include: {
      matches: true,
      scoringProfile: true,
      entries: {
        where: { isComplete: true, submittedAt: { not: null } },
        include: {
          picks: { select: COMMISSIONER_BRAIN_PICK_SELECT },
          participant: true,
        },
      },
    },
  })
  if (!challenge || challenge.entries.length < 2) {
    return ["Not enough finalized entries for an at-risk report yet."]
  }

  const rows = buildWorldCupLeaderboardRows({
    entries: challenge.entries as unknown as DbEntryForLb[],
    matches: challenge.matches as unknown as DbMatch[],
    scoring: challenge.scoringProfile,
  })
  const leader = rows[0]
  if (!leader) return ["No ranked entries available yet."]

  const remainingMatches = (challenge.matches as Array<{ status: string }>).filter((m) => m.status !== "final").length
  const sc = challenge.scoringProfile
  const avgPointsPerMatch =
    ((sc?.roundOf16Points ?? 2) + (sc?.quarterFinalPoints ?? 4)) / 2
  const approxRemaining = Math.round(remainingMatches * avgPointsPerMatch * 0.6)

  const atRisk = rows.filter((row, i) => {
    if (i === 0) return false
    const gap = leader.totalScore - row.totalScore
    return approxRemaining > 0 ? gap > approxRemaining * 0.5 : gap >= 10
  }).slice(0, 6)

  if (atRisk.length === 0) {
    return [
      `Pool is still wide open — every entry has a realistic path.`,
      `${leader.entryName} leads at ${leader.totalScore} pts with ~${approxRemaining} pts still available.`,
    ]
  }

  const lines: string[] = [
    `${leader.entryName} leads at ${leader.totalScore} pts. These entries face a tough climb:`,
  ]
  for (const row of atRisk) {
    const gap = leader.totalScore - row.totalScore
    lines.push(`• ${row.entryName}: ${row.totalScore} pts — ${gap} pts behind.`)
  }
  if (approxRemaining > 0) {
    lines.push(`~${approxRemaining} pts still on the table — possible, but they need results to break their way.`)
  }
  return lines.map(sanitizeRecapLine)
}

/** Ready-to-share social post to invite more participants. */
async function buildSocialInviteLines(challengeId: string): Promise<string[]> {
  const [challenge, snap] = await Promise.all([
    prisma.worldCupBracketChallenge.findUnique({
      where: { id: challengeId },
      select: { name: true, maxParticipants: true },
    }),
    getWorldCupCommissionerBrainSnapshot(challengeId),
  ])
  if (!snap || !challenge) return []

  const url = worldCupBracketPicksPublicUrl(challengeId)
  const lockLabel = snap.effectiveLockAt
    ? new Date(snap.effectiveLockAt).toLocaleString("en-US", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/New_York",
      })
    : "soon"

  const spotsLeft =
    challenge.maxParticipants != null
      ? Math.max(0, challenge.maxParticipants - snap.totalEntries)
      : null

  const joinLine =
    spotsLeft != null && spotsLeft > 0
      ? `Only ${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left — ${snap.totalEntries} entr${snap.totalEntries === 1 ? "y" : "ies"} already in.`
      : snap.totalEntries > 0
        ? `${snap.totalEntries} ${snap.totalEntries === 1 ? "entry" : "entries"} in. Come compete.`
        : "Brackets are open — be the first in."

  return [
    `Join "${challenge.name}" — World Cup bracket pool on AllFantasy.`,
    joinLine,
    `Picks lock: ${lockLabel} ET.`,
    url,
  ].map(sanitizeRecapLine)
}

/** Engagement message ready to post — sparks pool activity. */
async function buildEngagementNudgeLines(challengeId: string): Promise<string[]> {
  const [snap, challenge] = await Promise.all([
    getWorldCupCommissionerBrainSnapshot(challengeId),
    prisma.worldCupBracketChallenge.findUnique({
      where: { id: challengeId },
      select: { name: true },
    }),
  ])
  if (!snap || !challenge) return []

  const popular = snap.mostPopularChampion?.teamName ?? null
  const entryCount = snap.totalEntries
  const incomplete = snap.incompleteBracketCount

  const lines: string[] = [
    popular
      ? `${entryCount} bracket${entryCount === 1 ? "" : "s"} in for "${challenge.name}" — ${popular} is the most popular champion pick.`
      : `${entryCount} bracket${entryCount === 1 ? "" : "s"} in for "${challenge.name}" so far.`,
  ]

  if (incomplete > 0 && !snap.isLocked) {
    lines.push(
      `${incomplete} ${incomplete === 1 ? "entry is" : "entries are"} still incomplete — finish your picks before the lock!`
    )
  } else if (snap.isLocked) {
    lines.push(`Picks are locked — let the tournament handle the rest. Good luck! 🏆`)
  }

  if (snap.biggestUpsetLean) {
    lines.push(snap.biggestUpsetLean)
  }

  lines.push(`Drop your takes in the chat 👇`)

  return lines.map(sanitizeRecapLine)
}

/** Hype post for tomorrow's matches — kickoff times ET + round. */
async function buildTomorrowHypeLines(challengeId: string): Promise<string[]> {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  const dayAfterTomorrow = new Date(tomorrow)
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1)

  const [challenge, tomorrowMatches] = await Promise.all([
    prisma.worldCupBracketChallenge.findUnique({
      where: { id: challengeId },
      select: { name: true },
    }),
    prisma.worldCupBracketMatch.findMany({
      where: {
        challengeId,
        status: { not: "final" },
        startsAt: { gte: tomorrow.toISOString(), lt: dayAfterTomorrow.toISOString() },
      },
      orderBy: [{ startsAt: "asc" }],
    }),
  ])

  // Fallback to next 4 upcoming if nothing is scheduled tomorrow
  const matches =
    tomorrowMatches.length > 0
      ? tomorrowMatches
      : await prisma.worldCupBracketMatch.findMany({
          where: {
            challengeId,
            status: { not: "final" },
            startsAt: { gte: new Date().toISOString() },
          },
          orderBy: [{ startsAt: "asc" }],
          take: 4,
        })

  if (matches.length === 0) {
    return ["No upcoming matches found in the schedule yet — check back after the next sync."]
  }

  const label = tomorrowMatches.length > 0 ? "Tomorrow" : "Coming up"
  const lines: string[] = [`${label} in "${challenge?.name ?? "the pool"}":` ]

  for (const m of matches.slice(0, 5)) {
    const time = m.startsAt
      ? new Date(m.startsAt).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: "America/New_York",
        }) + " ET"
      : "Time TBD"
    lines.push(`${m.homeTeamName} vs ${m.awayTeamName} — ${time} (${m.round.replace(/_/g, " ")})`)
  }

  lines.push(`Who are you rooting for? 🏆`)
  return lines.map(sanitizeRecapLine)
}

// ---------------------------------------------------------------------------
// AI-wrapped dispatcher — includes all actions
// ---------------------------------------------------------------------------

export async function generateAiWrappedLines(
  kind:
    | "hype"
    | "standings"
    | "watch"
    | "recap"
    | "path"
    | "reminder"
    | "incomplete_reminder"
    | "pool_broadcast"
    | "chalk_bust"
    | "match_swing"
    | "trash_talk"
    | "at_risk"
    | "social_invite"
    | "quiet_pool"
    | "tomorrow_hype",
  challengeId: string,
  extra?: { round?: WorldCupRound; entryId?: string }
): Promise<string[]> {
  let base: string[] = []
  switch (kind) {
    case "hype":
      base = await buildLeagueHypeLines(challengeId)
      break
    case "standings":
      base = await buildStandingsSummaryLines(challengeId)
      break
    case "watch":
      base = await buildWhatToWatchLines(challengeId)
      break
    case "recap":
      base = await buildPostRoundRecapLines(challengeId, extra?.round ?? "round_of_16")
      break
    case "path":
      base = extra?.entryId ? await buildPathToWinLines(challengeId, extra.entryId) : []
      break
    case "reminder":
      base = await buildIncompleteBracketReminderLines(challengeId)
      break
    case "incomplete_reminder":
      base = await buildIncompleteBracketReminderDetailedLines(challengeId)
      break
    case "pool_broadcast":
      base = await buildPoolBroadcastReminderLines(challengeId)
      break
    case "chalk_bust":
      base = await buildChalkBustNarrativeLines(challengeId)
      break
    case "match_swing":
      base = await buildMatchSwingLines(challengeId)
      break
    case "trash_talk":
      base = await buildTrashTalkLines(challengeId)
      break
    case "at_risk":
      base = await buildAtRiskUsersLines(challengeId)
      break
    case "social_invite":
      base = await buildSocialInviteLines(challengeId)
      break
    case "quiet_pool":
      base = await buildEngagementNudgeLines(challengeId)
      break
    case "tomorrow_hype":
      base = await buildTomorrowHypeLines(challengeId)
      break
    default:
      base = []
  }

  const aiVoiceHint: Partial<Record<typeof kind, string>> = {
    trash_talk: "Voice: playful, confident, light trash-talk energy for a friend group — fun, not mean.",
    quiet_pool: "Voice: warm commissioner nudge — energetic, inviting, short.",
    social_invite: "Voice: punchy social copy — one strong hook, clear CTA, under 3 lines.",
    tomorrow_hype: "Voice: exciting preview — build anticipation without inventing facts.",
    chalk_bust: "Voice: sharp analyst — make the stakes clear without sensationalism.",
    at_risk: "Voice: honest commissioner — factual, not cruel.",
    incomplete_reminder: "Voice: confident commissioner nudge — clear, energetic, professional.",
  }

  const hint = aiVoiceHint[kind]
  const ai = hint
    ? await maybeEnhanceWithOpenAi(`${base.join("\n")}\n\n${hint}`, {
        featureHint: "commissioner_brain",
        challengeId,
        kind,
      })
    : await maybeEnhanceWithOpenAi(base.join("\n"), {
        featureHint: "commissioner_brain",
        challengeId,
        kind,
      })

  return ai ? [ai] : base
}

// ---------------------------------------------------------------------------
// Structured Insight Card generator
// Deterministic builders compute all numbers; AI writes ONLY the narrative.
// ---------------------------------------------------------------------------

/**
 * Generate a structured InsightCard with deterministic data + a short AI narrative.
 * The AI call receives ONLY the pre-computed facts — it cannot invent scores or picks.
 */
export async function generateInsightCard(
  kind: "pool_swing" | "rooting_guide" | "champion_risk" | "commissioner_recap",
  challengeId: string,
  extra?: { entryId?: string },
): Promise<InsightCard | null> {
  switch (kind) {
    case "pool_swing": {
      const card = await buildPoolSwingAlertCard(challengeId)
      if (!card) return null
      const prompt = [
        `Pool swing analysis for a World Cup bracket pool.`,
        `Match: ${card.homeTeam} vs ${card.awayTeam} (${card.roundLabel}).`,
        `${card.favoredCount} entries picked ${card.favoredTeam}, ${card.underdogCount} picked ${card.underdogTeam}.`,
        `Max leaderboard points at risk: ${card.maxPointsAtRisk}. Chaos rating: ${card.chaosRating}/10.`,
        `Voice: sharp analyst, 1-2 sentences. Do NOT invent scores, odds, or facts not listed here.`,
      ].join(" ")
      const ai = await maybeEnhanceWithOpenAi(prompt, {
        featureHint: "commissioner_insight_pool_swing",
        challengeId,
        kind: "pool_swing",
      })
      return { ...card, aiNarrative: ai }
    }

    case "rooting_guide": {
      const card = await buildRootingGuideCard(challengeId, extra?.entryId)
      if (!card) return null
      const above = card.usersAboveWithThreat.length
      const abovePhrase = above > 0
        ? `${above} higher-ranked entr${above === 1 ? "y" : "ies"} picked ${card.threatTeam}.`
        : `No higher-ranked entries chose ${card.threatTeam}.`
      const prompt = [
        `Rooting guide for a World Cup bracket pool.`,
        `Entry "${card.entryName}" (rank ${card.rank}, ${card.currentScore} pts; leader at ${card.leaderScore} pts).`,
        `They need ${card.rootFor} to beat ${card.threatTeam} in the ${card.roundLabel}.`,
        `Points at risk: ${card.pointsAtRisk}. ${abovePhrase}`,
        `Voice: 1 sentence, clear stakes, no invented scores or odds.`,
      ].join(" ")
      const ai = await maybeEnhanceWithOpenAi(prompt, {
        featureHint: "commissioner_insight_rooting_guide",
        challengeId,
        kind: "rooting_guide",
      })
      return { ...card, aiNarrative: ai }
    }

    case "champion_risk": {
      const card = await buildChampionPickRiskCard(challengeId, extra?.entryId)
      if (!card) return null
      const altPhrase = card.alternativeLeverage.length > 0
        ? `Alternative picks: ${card.alternativeLeverage.join(", ")}.`
        : ""
      const prompt = [
        `Champion pick risk for a World Cup bracket pool.`,
        `${card.topChampion} is picked by ${card.topChampionCount} of ${card.totalEntries} entries (${card.poolPickPercent}%).`,
        `Differentiation: ${card.differentiation}.`,
        altPhrase,
        `Voice: 1 sentence, analyst take on the pool's risk profile. No invented results.`,
      ].filter(Boolean).join(" ")
      const ai = await maybeEnhanceWithOpenAi(prompt, {
        featureHint: "commissioner_insight_champion_risk",
        challengeId,
        kind: "champion_risk",
      })
      return { ...card, aiNarrative: ai }
    }

    case "commissioner_recap": {
      const card = await buildCommissionerRecapCard(challengeId)
      if (!card) return null
      // Build a facts-only prompt for the suggested group-chat post
      const lines: string[] = [
        `Commissioner recap for ${card.periodLabel} in a World Cup bracket pool.`,
      ]
      if (card.biggestWinner) {
        lines.push(
          `Biggest winner this round: ${card.biggestWinner.displayName} ("${card.biggestWinner.entryName}") — ${card.biggestWinner.roundScore} pts, now rank ${card.biggestWinner.rank}.`,
        )
      }
      if (card.biggestLoser) {
        lines.push(
          `Struggled most: ${card.biggestLoser.displayName} ("${card.biggestLoser.entryName}") — ${card.biggestLoser.roundScore} pts, rank ${card.biggestLoser.rank}.`,
        )
      }
      if (card.bestUpcomingMatch) {
        const m = card.bestUpcomingMatch
        lines.push(
          `Best upcoming match: ${m.homeTeam} vs ${m.awayTeam} (${m.roundLabel}${m.kickoffEt ? `, ${m.kickoffEt}` : ""}) — chaos ${m.chaosRating}/10.`,
        )
      }
      lines.push(
        `Current leader: ${card.leaderName ?? "TBD"} at ${card.leaderScore} pts. ${card.totalEntries} entries total.`,
        `Write a short, energetic commissioner message ready to post to the group chat. Use names. Under 3 sentences. No invented facts.`,
      )
      const ai = await maybeEnhanceWithOpenAi(lines.join("\n"), {
        featureHint: "commissioner_insight_recap",
        challengeId,
        kind: "commissioner_recap",
      })
      return { ...card, suggestedPost: ai }
    }
  }
}
