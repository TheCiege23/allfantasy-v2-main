/**
 * worldCupExplainBracketService.ts
 *
 * Private AI narrative generator for "Explain My Bracket" (AF Pro).
 *
 * - Verifies entry ownership via Prisma (`userId` match).
 * - Loads only the current user's own picks.
 * - Sends a compact, PII-free prompt to OpenAI via the existing safe helper.
 * - Falls back to a deterministic explanation if the OpenAI provider is
 *   unavailable (missing key, network error, rate limit, etc.).
 * - Sanitizes output: strips wagering terms, removes markdown tables, caps
 *   line length, caps total line count.
 *
 * Never sees, sends, or returns:
 *   - other users' picks
 *   - emails or user IDs
 *   - hidden/private pool data outside the current entry
 */
import "server-only"
import { prisma } from "@/lib/prisma"
import { routeTextCall } from "@/lib/ai/providerRouter"
import { applyValidationPipeline } from "@/lib/ai/responseValidator"
import {
  buildFreshnessLabel,
  type AIGroundingContract,
} from "@/lib/ai/aiGroundingContract"
import type { UserRole } from "@/lib/ai/engine/types"
import { logAiInteraction } from "@/lib/ai/auditLogger"
import { getWorldCupSeedStrength } from "./worldCupAiInsights"
import { WORLD_CUP_ROUND_LABELS, type WorldCupRound } from "./types"
import { getAiLanguageInstruction } from "./worldCupI18n"
import {
  hashGroundingPacket,
  getOrCreateWcExplainBracketInsight,
} from "@/lib/ai/aiInsightCache"

// ─── Grounding contract for bracket explanation ───────────────────────────────
// Bracket explanation uses only the user's own picks + the challenge name.
// liveScores: null → any invented score claim is BLOCKED.
// oddsData:   null → any odds/favorite claim is WARNED.
function buildExplainContract(opts: { poolName: string; locale?: string | null }): AIGroundingContract {
  const freshness = buildFreshnessLabel("pool_only", null)
  return {
    contractVersion: "af-contract-v1",
    sport: "world_cup",
    feature: "bracket_explanation",
    userRole: "member" as UserRole,
    plan: "pro",
    locale: opts.locale ?? null,
    sourceFreshness: freshness,
    poolContext: {
      poolId: "explain",
      poolName: opts.poolName,
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
    missingData: [
      "live match scores (live feed not loaded — do not guess any score)",
      "odds, spreads, and betting favorites (not loaded — do not mention)",
    ],
    allowedClaims: ["user's own bracket picks (teams, rounds, champion selection)"],
    forbiddenClaims: [
      "any live match score or current result",
      "team favorite status or any odds/spread",
    ],
  }
}

type WorldCupBracketExplanationResult =
  | {
      ok: true
      summary: string
      lines: string[]
      /** true if OpenAI was called successfully; false for deterministic fallback. */
      generative: boolean
    }
  | {
      ok: false
      reason: "entry_not_found" | "internal_error"
    }

type WorldCupExplainBracketInput = {
  challengeId: string
  entryId: string
  userId: string
  locale?: string | null
}

const FORBIDDEN_TERMS = [
  /\bdfs\b/gi,
  /\bbetting\b/gi,
  /\bwager(?:ing|s|ed)?\b/gi,
  /\bsportsbook\b/gi,
  /\bodds\b/gi,
]

const MAX_LINE_LENGTH = 280
const MAX_LINES = 8

function sanitizeLine(line: string): string {
  let cleaned = line
  for (const pattern of FORBIDDEN_TERMS) {
    cleaned = cleaned.replace(pattern, "prediction")
  }
  // Strip markdown table separators and code fences.
  cleaned = cleaned.replace(/\|/g, " ").replace(/^[-=]{3,}$/gm, "").replace(/^```.*$/gm, "")
  return cleaned.replace(/\s+/g, " ").trim().slice(0, MAX_LINE_LENGTH)
}

function buildDeterministicExplanation(params: {
  entryName: string
  championName: string | null
  knockoutPicksByRound: Partial<Record<WorldCupRound, Array<{ teamName: string }>>>
  totalKnockoutPicks: number
}): { summary: string; lines: string[] } {
  const { entryName, championName, knockoutPicksByRound, totalKnockoutPicks } = params

  const summary = championName
    ? `${entryName} is built around ${championName} winning the World Cup, supported by ${totalKnockoutPicks} knockout pick${totalKnockoutPicks === 1 ? "" : "s"}.`
    : `${entryName} has ${totalKnockoutPicks} knockout pick${totalKnockoutPicks === 1 ? "" : "s"} but no champion selected yet.`

  const lines: string[] = []

  lines.push(
    championName
      ? `Champion path: ${championName}. Your max possible points scale with this team's run.`
      : `Champion path: not selected. Pick a champion to unlock your final-round bonus points.`
  )

  const finalists = knockoutPicksByRound.final ?? []
  if (finalists.length > 0) {
    lines.push(`Final picks: ${finalists.map((p) => p.teamName).join(", ")}.`)
  }

  const semis = knockoutPicksByRound.semifinal ?? []
  if (semis.length > 0) {
    lines.push(`Semifinal picks: ${semis.map((p) => p.teamName).join(", ")}.`)
  }

  const quarters = knockoutPicksByRound.quarterfinal ?? []
  if (quarters.length > 0) {
    lines.push(`Quarterfinal picks: ${quarters.map((p) => p.teamName).join(", ")}.`)
  }

  lines.push(
    "Note: AI narrative is temporarily unavailable — this is a deterministic fallback. The full narrative returns when the AI service is restored."
  )

  return { summary, lines }
}

function buildSystemPrompt(locale?: string | null): string {
  const lang = getAiLanguageInstruction(locale)
  return [
    "You are Chimmy, a calm bracket strategy coach.",
    "You write short, deterministic-sounding strategy reviews about a single user's own World Cup bracket.",
    "Use second person ('your bracket', 'your champion').",
    "Never use betting, wagering, sportsbook, odds, or DFS language.",
    "Do not invent team names.",
    "Do not mention other users.",
    `Respond in ${lang}. Use natural sports-app language.`,
    "Keep country/team/player names exactly as provided.",
    "Keep AllFantasy feature names recognizable.",
    "Do not reveal private user data, invite codes, emails, or user IDs.",
  ].join(" ")
}

const USER_PROMPT_FORMAT = [
  "Write a private bracket strategy review for ONE user about THEIR OWN World Cup bracket.",
  "Produce 6 short labeled paragraphs in this order with these exact labels:",
  "  Style:",
  "  Safest picks:",
  "  Riskiest picks:",
  "  Champion path:",
  "  What could go right:",
  "  What could go wrong:",
  "Then a final line starting with 'Recommendation:' (one sentence).",
  "Constraints:",
  "- Each paragraph 1-2 sentences max.",
  "- No raw JSON, no markdown tables, no headers other than the labels above.",
  "- Use only team names from the context. Do not invent teams.",
  "",
  "Context (private to this user):",
]

export async function generateWorldCupBracketExplanation(
  input: WorldCupExplainBracketInput
): Promise<WorldCupBracketExplanationResult> {
  const { challengeId, entryId, userId } = input

  // Ownership check — same pattern as the matchup AI route. Non-owners get 404.
  let entry: any
  try {
    entry = await (prisma as any).worldCupBracketEntry.findFirst({
      where: { id: entryId, challengeId, userId },
      include: {
        picks: {
          where: {
            selectedTeamName: { not: "" },
            OR: [
              { selectedTeamId: { not: null } },
              { selectedSlotKey: { not: null } },
            ],
          },
          select: {
            id: true,
            matchId: true,
            round: true,
            selectedTeamId: true,
            selectedSlotKey: true,
            selectedTeamName: true,
          },
          orderBy: { createdAt: "asc" },
        },
        challenge: {
          select: { id: true, name: true, seasonYear: true },
        },
      },
    })
  } catch {
    return { ok: false, reason: "internal_error" }
  }

  if (!entry) {
    return { ok: false, reason: "entry_not_found" }
  }

  // Group picks by round (no PII — only round + team display name + slot key).
  const knockoutPicksByRound: Partial<
    Record<WorldCupRound, Array<{ teamName: string; teamId: string | null; slotKey: string | null }>>
  > = {}
  for (const pick of entry.picks) {
    const round = pick.round as WorldCupRound
    if (!knockoutPicksByRound[round]) knockoutPicksByRound[round] = []
    knockoutPicksByRound[round]!.push({
      teamName: pick.selectedTeamName,
      teamId: pick.selectedTeamId,
      slotKey: pick.selectedSlotKey,
    })
  }

  const finalPicks = knockoutPicksByRound.final ?? []
  const championName =
    finalPicks[0]?.teamName ?? entry.championTeamName ?? null

  const finalistStrengths = finalPicks.map((p) => ({
    name: p.teamName,
    strength: p.slotKey ? getWorldCupSeedStrength(p.slotKey) : 60,
  }))

  const contextLines = [
    `Pool: ${entry.challenge.name} (${entry.challenge.seasonYear})`,
    `Bracket: ${entry.name}`,
    `Champion: ${championName ?? "not selected"}`,
    finalistStrengths.length > 0
      ? `Finalist strength (0-100): ${finalistStrengths.map((f) => `${f.name} ${f.strength}`).join(", ")}`
      : "Finalist strength: n/a",
    `Pick counts by round: ${
      Object.entries(knockoutPicksByRound)
        .map(([r, p]) => `${r}=${p!.length}`)
        .join(", ") || "0"
    }`,
  ]

  const knockoutContext = Object.entries(knockoutPicksByRound)
    .filter(([, picks]) => (picks?.length ?? 0) > 0)
    .map(
      ([round, picks]) =>
        `${WORLD_CUP_ROUND_LABELS[round as WorldCupRound]}: ${picks!.map((p) => p.teamName).join(", ")}`
    )
    .join("\n")

  const userPrompt = [
    ...USER_PROMPT_FORMAT,
    ...contextLines,
    "",
    "Knockout picks:",
    knockoutContext || "(none)",
  ].join("\n")

  // ── AiInsightCache: check before calling the LLM ─────────────────────────
  // groundingHash covers pick state — if the user changes a pick, the hash
  // changes → cache miss → fresh narrative generated.
  const groundingHash = hashGroundingPacket({
    champion: championName ?? null,
    pickCount: entry.picks.length,
    entryName: entry.name,
    challengeName: entry.challenge.name,
    seasonYear: entry.challenge.seasonYear,
    rounds: Object.keys(knockoutPicksByRound).sort().join(","),
  })

  const cacheResult = await getOrCreateWcExplainBracketInsight(
    {
      userId,
      entryId,
      groundingHash,
      locale: input.locale,
    },
    async () => {
      const llmResult = await routeTextCall({
        messages: [
          { role: "system", content: buildSystemPrompt(input.locale) },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
        maxTokens: 600,
      })

      if (!llmResult.ok) {
        return { resultText: null }
      }

      // Validate before caching — only validated text is stored
      const contract = buildExplainContract({
        poolName: entry.challenge.name,
        locale: input.locale,
      })
      const validated = applyValidationPipeline(llmResult.text, contract)

      return {
        resultText: validated,
        tokensUsed: llmResult.tokensUsed ?? null,
        provider: llmResult.provider,
        model: llmResult.model,
      }
    }
  )

  if (!cacheResult.text) {
    // LLM was unavailable — serve deterministic fallback
    logAiInteraction({
      userId,
      sport: "world_cup",
      feature: "bracket_explanation",
      route: "/api/brackets/world-cup/[challengeId]/entries/[entryId]/explain",
      plan: "pro",
      freshnessTier: "pool_only",
      promptIntent: "bracket_explain",
      validatorResult: "unavailable",
      wasDeterministic: false,
    })
    const fallback = buildDeterministicExplanation({
      entryName: entry.name,
      championName,
      knockoutPicksByRound,
      totalKnockoutPicks: entry.picks.length,
    })
    return {
      ok: true,
      summary: sanitizeLine(fallback.summary),
      lines: fallback.lines.map(sanitizeLine).filter((l) => l.length > 0),
      generative: false,
    }
  }

  // Fire-and-forget audit log — skip token count on cache hits
  logAiInteraction({
    userId,
    sport: "world_cup",
    feature: "bracket_explanation",
    route: "/api/brackets/world-cup/[challengeId]/entries/[entryId]/explain",
    plan: "pro",
    providerSource: cacheResult.cacheHit ? "cache" : (cacheResult.provider ?? "unknown"),
    freshnessTier: "pool_only",
    promptIntent: "bracket_explain",
    validatorResult: "clean",
    modelUsed: cacheResult.cacheHit ? null : cacheResult.model,
    tokenCost: cacheResult.cacheHit ? null : cacheResult.tokensUsed,
    wasDeterministic: false,
  })

  // Parse and sanitize AI output.
  const rawLines = cacheResult.text
    .split(/\n+/)
    .map(sanitizeLine)
    .filter((l) => l.length > 0)

  const summary =
    rawLines[0] ??
    (championName
      ? `${entry.name}: anchored around ${championName} as your champion.`
      : entry.name)

  return {
    ok: true,
    summary,
    lines: rawLines.slice(0, MAX_LINES),
    // generative=false on cache hit (no LLM call) — route uses this to decide
    // whether to increment the daily cap and charge tokens
    generative: !cacheResult.cacheHit,
  }
}
