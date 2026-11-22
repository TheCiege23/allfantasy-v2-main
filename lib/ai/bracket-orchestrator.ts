import { deepseekQuantAnalysis } from "@/lib/deepseek-client"
import {
  openaiChatJson,
  parseJsonContentFromChatCompletion,
} from "@/lib/openai-client"
import { grokEnrich } from "@/lib/ai-external/grok"

type BracketMatchupContext = {
  tournamentId: string
  nodeId: string
  teamA: string
  teamB: string
  seedA: number | null
  seedB: number | null
  round: number
  region: string | null
  winProbA: number
  winProbB: number
  poolPickPctA?: number | null
  poolPickPctB?: number | null
  sleeperLabel?: "high_upset" | "moderate_upset" | "slight_edge" | "none" | null
  generatedAtIso?: string
}

type BracketAiStructuredOutput = {
  analysis: string
  keyFactors: string[]
  suggestedLean: string
  confidenceLabel: "low" | "medium" | "high"
  confidenceScore: number
  upsetWatch: string
  dataNotes: string
  freshnessLabel?: "fresh" | "stale" | "unknown"
  providers: {
    openai: "ok" | "error" | "skipped"
    deepseek: "ok" | "error" | "skipped"
    grok: "ok" | "error" | "skipped"
  }
}

async function runDeepseekLayer(
  ctx: BracketMatchupContext
): Promise<{ json: Record<string, any> | null; status: "ok" | "error" | "skipped" }> {
  if (!process.env.DEEPSEEK_API_KEY) {
    return { json: null, status: "skipped" }
  }

  const prompt = `
You are a quantitative assistant helping with NCAA tournament bracket analysis.

Return ONLY JSON with these optional keys:
- "lean": "teamA" | "teamB" | "balanced"
- "confidencePct": number (0-100)
- "upsetRisk": "low" | "medium" | "high"
- "factors": string[] (short bullet phrases)
- "freshnessLabel": "fresh" | "stale" | "unknown"

Matchup:
- tournamentId: ${ctx.tournamentId}
- nodeId: ${ctx.nodeId}
- round: ${ctx.round}
- region: ${ctx.region || "Unknown"}
- teamA: ${ctx.teamA} (seed ${ctx.seedA ?? "?"})
- teamB: ${ctx.teamB} (seed ${ctx.seedB ?? "?"})
- winProbA_estimate: ${Math.round(ctx.winProbA * 100)}%
- winProbB_estimate: ${Math.round(ctx.winProbB * 100)}%
- poolPickPctA: ${ctx.poolPickPctA ?? "unknown"}
- poolPickPctB: ${ctx.poolPickPctB ?? "unknown"}
- sleeperLabel: ${ctx.sleeperLabel ?? "none"}

Rules:
- Use the provided inputs only.
- Do not assume you know injuries or news.
- If signals are weak or close, use "balanced" lean and "low" confidence.
- "upsetRisk" should increase when the underdog has non-trivial signals.
`.trim()

  try {
    const res = await deepseekQuantAnalysis(prompt)
    if (res.error || !res.json) {
      return { json: null, status: "error" }
    }
    return { json: res.json, status: "ok" }
  } catch {
    return { json: null, status: "error" }
  }
}

async function runGrokLayer(
  ctx: BracketMatchupContext
): Promise<{ narrative: string[] | null; status: "ok" | "error" | "skipped" }> {
  // Grok is optional and only used if configured
  const cfgMissing = !process.env.GROK_BASE_URL || !(process.env.GROK_API_KEY || process.env.XAI_API_KEY)
  if (cfgMissing) {
    return { narrative: null, status: "skipped" }
  }

  try {
    const res = await grokEnrich({
      kind: "bracket_matchup",
      context: {
        tournamentId: ctx.tournamentId,
        nodeId: ctx.nodeId,
        round: ctx.round,
        region: ctx.region,
      },
      payload: {
        teamA: { name: ctx.teamA, seed: ctx.seedA },
        teamB: { name: ctx.teamB, seed: ctx.seedB },
        winProb: { teamA: ctx.winProbA, teamB: ctx.winProbB },
        poolPicks: {
          teamA: ctx.poolPickPctA,
          teamB: ctx.poolPickPctB,
        },
        sleeperLabel: ctx.sleeperLabel ?? "none",
      },
    } as any)

    if (!res.ok) {
      return { narrative: null, status: "error" }
    }

    const narrative = Array.isArray(res.narrative) ? res.narrative : null
    return { narrative, status: "ok" }
  } catch {
    return { narrative: null, status: "error" }
  }
}

export async function runBracketAiOrchestration(
  ctx: BracketMatchupContext
): Promise<BracketAiStructuredOutput | null> {
  // Run DeepSeek + Grok in parallel; both optional
  const [dsRes, grokRes] = await Promise.allSettled([
    runDeepseekLayer(ctx),
    runGrokLayer(ctx),
  ])

  const deepseek =
    dsRes.status === "fulfilled" ? dsRes.value : { json: null, status: "error" as const }
  const grok =
    grokRes.status === "fulfilled" ? grokRes.value : { narrative: null, status: "error" as const }

  // Build a compact JSON bundle for OpenAI
  const orchestrationPayload = {
    matchup: ctx,
    deepseek: {
      status: deepseek.status,
      output: deepseek.json ?? null,
    },
    grok: {
      status: grok.status,
      narrative: grok.narrative ?? null,
    },
  }

  // If OpenAI is not configured, we simply return null and let callers fall back.
  try {
    const oaRes = await openaiChatJson({
      messages: [
        {
          role: "system",
          content: [
            "You are a bracket analysis assistant.",
            "You help users think through NCAA tournament matchups using structured signals.",
            "You DO NOT promise wins, guarantees, or locks.",
            "You DO NOT claim to know injuries, betting lines, or news beyond what is provided.",
            "",
            "You must output ONLY a single JSON object with these keys:",
            '- "analysis": string',
            '- "keyFactors": string[]',
            '- "suggestedLean": string',
            '- "confidenceLabel": "low" | "medium" | "high"',
            '- "confidenceScore": number',
            '- "upsetWatch": string',
            '- "dataNotes": string',
            '- "freshnessLabel": "fresh" | "stale" | "unknown"',
            "",
            "Explain reasoning in plain language. Emphasize that outcomes are uncertain.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(orchestrationPayload, null, 2),
        },
      ],
      temperature: 0.4,
      maxTokens: 900,
    })

    if (!oaRes.ok) {
      return null
    }

    const parsed = parseJsonContentFromChatCompletion(oaRes.json)
    if (!parsed || typeof parsed !== "object") {
      return null
    }

    const out = parsed as any

    // Minimal validation/coercion so callers have a stable shape.
    const keyFactors: string[] = Array.isArray(out.keyFactors)
      ? out.keyFactors.filter((x: any) => typeof x === "string")
      : []

    const confidenceLabel: "low" | "medium" | "high" =
      out.confidenceLabel === "high" || out.confidenceLabel === "medium"
        ? out.confidenceLabel
        : "low"

    const confidenceScore =
      typeof out.confidenceScore === "number" && Number.isFinite(out.confidenceScore)
        ? Math.max(0, Math.min(100, Math.round(out.confidenceScore)))
        : 55

    const freshnessLabel: "fresh" | "stale" | "unknown" =
      out.freshnessLabel === "fresh" || out.freshnessLabel === "stale"
        ? out.freshnessLabel
        : "unknown"

    const result: BracketAiStructuredOutput = {
      analysis: typeof out.analysis === "string" ? out.analysis : "",
      keyFactors,
      suggestedLean:
        typeof out.suggestedLean === "string"
          ? out.suggestedLean
          : "This matchup appears close based on the current inputs.",
      confidenceLabel,
      confidenceScore,
      upsetWatch:
        typeof out.upsetWatch === "string"
          ? out.upsetWatch
          : "No strong upset signal from the current inputs.",
      dataNotes:
        typeof out.dataNotes === "string"
          ? out.dataNotes
          : "Analysis is based on available bracket signals and pool pick distribution. It is not a guarantee of any outcome.",
      freshnessLabel,
      providers: {
        openai: "ok",
        deepseek: deepseek.status,
        grok: grok.status,
      },
    }

    return result
  } catch {
    // If OpenAI is unavailable or misconfigured, orchestration is skipped.
    return null
  }
}

