/**
 * DeterministicToAIContextBridge — turns deterministic engine outputs into AI context.
 * Rule: deterministic results go first; AI must not override hard rules or invent data.
 */

export type DeterministicSource =
  | "trade_engine"      // fairness, acceptance, lineup delta, VORP
  | "rankings_engine"   // ordering, tiers, PPG
  | "waiver_engine"     // priority scores, availability
  | "simulation"        // probabilities, outcomes
  | "legacy_score"      // legacy points, evidence
  | "reputation"        // trust scores, evidence
  | "psychological"    // profile dimensions
  | "graph"            // rivalry scores, centrality
  | "draft_board"      // ADP, tiers, value

/**
 * Build a short, factual summary string from deterministic payload for inclusion in AI prompts.
 * No interpretation — just "what the numbers say."
 */
export function deterministicPayloadToContextSummary(
  payload: Record<string, unknown> | null,
  source: DeterministicSource
): string {
  if (!payload || typeof payload !== "object") return ""

  const lines: string[] = []
  lines.push(`[Deterministic source: ${source}]`)

  switch (source) {
    case "trade_engine": {
      const fairness = payload.fairnessScore ?? payload.totalScore
      const accept = payload.acceptProbability
      const lineup = payload.lineupDelta
      if (fairness != null) lines.push(`Fairness/Total score: ${fairness}`)
      if (accept != null) lines.push(`Accept probability: ${accept}`)
      if (lineup != null) lines.push(`Lineup delta: ${JSON.stringify(lineup)}`)
      if (payload.vorpDelta != null) lines.push(`VORP delta: ${JSON.stringify(payload.vorpDelta)}`)
      break
    }
    case "rankings_engine":
      if (payload.ordering != null) lines.push(`Ordering: ${Array.isArray(payload.ordering) ? payload.ordering.length + " items" : "present"}`)
      if (payload.tiers != null) lines.push(`Tiers: ${JSON.stringify(payload.tiers)}`)
      break
    case "waiver_engine":
      if (payload.priorityScore != null) lines.push(`Priority score: ${payload.priorityScore}`)
      if (payload.rank != null) lines.push(`Rank: ${payload.rank}`)
      break
    case "simulation":
      if (payload.winProbability != null) lines.push(`Win probability: ${payload.winProbability}`)
      if (payload.outcomes != null) lines.push(`Outcomes: ${Array.isArray(payload.outcomes) ? payload.outcomes.length + " scenarios" : "present"}`)
      break
    case "legacy_score":
    case "reputation":
      if (payload.score != null) lines.push(`Score: ${payload.score}`)
      if (payload.evidenceCount != null) lines.push(`Evidence count: ${payload.evidenceCount}`)
      break
    case "psychological":
      if (payload.dimensions != null) lines.push(`Dimensions: ${JSON.stringify(payload.dimensions)}`)
      break
    case "graph":
      if (payload.intensityScore != null) lines.push(`Intensity: ${payload.intensityScore}`)
      if (payload.compositeScore != null) lines.push(`Composite: ${payload.compositeScore}`)
      break
    case "draft_board":
      if (payload.adp != null) lines.push(`ADP: ${payload.adp}`)
      if (payload.tier != null) lines.push(`Tier: ${payload.tier}`)
      break
    default:
      lines.push(JSON.stringify(payload).slice(0, 500))
  }

  return lines.join("\n")
}

