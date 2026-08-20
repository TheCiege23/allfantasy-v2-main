/**
 * AI Draft Assistant ("War Room") — structured prompts + provider calls with deterministic fallback.
 * Does not mutate draft state; safe for /api/ai/draft/* routes.
 */

import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { deepseekChat } from '@/lib/deepseek-client'
import { computeDraftRecommendation, type RecommendationResult } from '@/lib/draft-helper/RecommendationEngine'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { DraftAdvisorContext } from '@/lib/sports-os/DraftAdvisorContextService'

export type WarRoomPlayer = {
  name: string
  position: string
  team: string | null
  adp?: number | null
}

export type DraftWarRoomInput = {
  leagueSettings?: Record<string, unknown>
  currentPick?: { overall: number; round: number; slot: number; rosterId?: string | null }
  draftType: string
  scoringSettings?: Record<string, unknown>
  userRoster: Array<{ position: string; team?: string | null; byeWeek?: number | null }>
  availablePlayers: WarRoomPlayer[]
  recentPicks: Array<{ playerName: string; position: string; team?: string | null; pickLabel?: string }>
  nextTeams?: string[]
  round: number
  pickInRound?: number
  totalTeams: number
  sport: string
  isDynasty?: boolean
  isSuperflex?: boolean
  rosterSlots?: string[]
  /** Starter-eligible positions for this league — same basis as draft pool (optional when no league template). */
  draftEligiblePositions?: ReadonlySet<string>
  aiAdpByKey?: Record<string, number>
  mode?: 'needs' | 'bpa'
  /**
   * Pre-assembled grounded draft context from DraftAdvisorContextService.
   * When present, enriches the LLM prompt with injury flags, bye weeks,
   * positional scarcity ratings, and roster needs derived from DB data.
   * Optional — the route assembles this when the service is available.
   */
  groundedContext?: DraftAdvisorContext
}

export type DraftWarRoomOutput = {
  bestPick: WarRoomPlayer
  confidence: number
  reasoning: string[]
  strategyTip: string
  risk: 'low' | 'medium' | 'high'
  riskNote: string
  alternatives: WarRoomPlayer[]
  teamNeedSummary: string
  /** True when LLM unavailable or parse failed — UI may show softer copy */
  fallback: boolean
  provider?: 'openai' | 'deepseek' | 'deterministic'
  /**
   * Slice 16 — PER-FIELD provenance. The object-level `provider` could not
   * express that `bestPick`/`confidence`/`risk` are engine output while the
   * narrative fields may be model output. Decision fields are always
   * 'deterministic'; only prose is ever 'ai'.
   */
  fieldSources?: Record<string, 'deterministic' | 'deterministic_ranked' | 'ai'>
}

export type DraftCompareInput = {
  sport: string
  playerA: WarRoomPlayer
  playerB: WarRoomPlayer
  scoringHint?: string
  rosterContext?: string
}

export type DraftCompareOutput = {
  winner: 'A' | 'B'
  confidence: number
  breakdown: {
    projection: string
    matchup: string
    usage: string
    risk: string
  }
  advice: string
  fallback: boolean
}

const SYSTEM_WAR_ROOM = `You are a fantasy draft expert. Output ONLY valid JSON (no markdown).
Rules:
- Be decisive. Forbidden words: "it depends", "maybe", "could go either way", "uncertain".
- Player names in "alternativeNames" MUST be copied exactly from AVAILABLE_PLAYERS list.
- "risk" is one of: low | medium | high
- "reasoning" must be exactly 4 short bullet strings (positional need, ADP value, upside/floor, roster fit).`

function findPlayer(pool: WarRoomPlayer[], name: string): WarRoomPlayer | null {
  const n = name.trim().toLowerCase()
  return pool.find((p) => p.name.trim().toLowerCase() === n) ?? null
}

function mapDeterministicToWarRoom(
  det: RecommendationResult,
  available: WarRoomPlayer[],
): DraftWarRoomOutput | null {
  const top = det.recommendation
  if (!top) return null
  const best = findPlayer(available, top.player.name) ?? {
    name: top.player.name,
    position: top.player.position,
    team: top.player.team ?? null,
    adp: top.player.adp ?? null,
  }
  const alts = det.alternatives
    .slice(0, 3)
    .map((a) => findPlayer(available, a.player.name))
    .filter((x): x is WarRoomPlayer => Boolean(x))

  const reasoning: string[] = [
    det.explanation ? det.explanation.slice(0, 160) : `Fill roster need at ${top.player.position}.`,
    top.adpEdge >= 0 ? `ADP value: roughly ${top.adpEdge.toFixed(1)} vs expectation.` : `Solid ADP alignment for this slot.`,
    `Need score ${top.needScore.toFixed(0)} — balances floor and role.`,
    det.reachWarning || det.valueWarning
      ? [det.reachWarning, det.valueWarning].filter(Boolean).join(' ')
      : `Fits current build${det.byeNote ? `; ${det.byeNote}` : ''}.`,
  ].slice(0, 4)

  const risk: 'low' | 'medium' | 'high' =
    det.uncertainty?.toLowerCase().includes('high') || det.caveats?.length
      ? 'medium'
      : top.confidence >= 72
        ? 'low'
        : 'medium'

  return {
    bestPick: best,
    confidence: top.confidence,
    reasoning,
    strategyTip: det.scarcityInsight || det.formatInsight || 'Stay balanced with starters before depth.',
    risk,
    riskNote: det.uncertainty || det.caveats?.[0] || 'Risk tied to injury news and role changes — monitor camp.',
    alternatives: alts,
    teamNeedSummary: det.stackInsight || det.correlationInsight || 'Roster needs drive this pick.',
    fallback: true,
    provider: 'deterministic',
  }
}

function buildUserPayload(input: DraftWarRoomInput, pool: WarRoomPlayer[]): string {
  const ctx = input.groundedContext

  // Build enriched player rows, incorporating grounded injury + bye week data when available.
  // Index grounded candidates by normalized name for O(1) lookup.
  const groundedByName = new Map<string, { injuryRisk: string; byeWeek: number | null }>()
  if (ctx) {
    for (const c of ctx.enrichedCandidates) {
      groundedByName.set(c.playerName.trim().toLowerCase(), {
        injuryRisk: c.snapshot.injuryRisk,
        byeWeek: c.byeWeek,
      })
    }
  }

  const avail = pool.slice(0, 80).map((p) => {
    const key = p.name.trim().toLowerCase()
    const grounded = groundedByName.get(key)
    const baseRow = `${p.name}|${p.position}|${p.team ?? ''}|${p.adp ?? ''}`
    if (!grounded) return baseRow
    const parts: string[] = [baseRow]
    if (grounded.injuryRisk === 'high' || grounded.injuryRisk === 'medium') {
      parts.push(`injury:${grounded.injuryRisk}`)
    }
    if (grounded.byeWeek != null) parts.push(`bye:${grounded.byeWeek}`)
    return parts.join('|')
  }).join('\n')

  const recent = input.recentPicks
    .slice(-12)
    .map((p) => `${p.pickLabel ?? ''} ${p.playerName} ${p.position}`)
    .join('; ')
  const roster = input.userRoster.map((r) => r.position).join(',')

  const sections: string[] = [
    `SPORT: ${input.sport}`,
    `DRAFT_TYPE: ${input.draftType}`,
    `ROUND: ${input.round} PICK_IN_ROUND: ${input.pickInRound ?? 1} TOTAL_TEAMS: ${input.totalTeams}`,
    `USER_ROSTER_POSITIONS: ${roster}`,
    `RECENT_PICKS: ${recent || 'none'}`,
    `NEXT_TEAMS: ${(input.nextTeams ?? []).join(', ') || 'n/a'}`,
  ]

  // Grounded context sections — only appended when DB data was available.
  if (ctx) {
    // Positional scarcity: positions with high/medium scarcity get explicit flags.
    const scarcityLines = Object.entries(ctx.positionalScarcity)
      .filter(([, s]) => s.scarcityRating !== 'low')
      .map(([pos, s]) => `${pos}:${s.scarcityRating}(${s.totalAvailable} left)`)
    if (scarcityLines.length > 0) {
      sections.push(`POSITIONAL_SCARCITY: ${scarcityLines.join(', ')}`)
    }

    // Roster needs: what positions are still required.
    if (ctx.rosterNeeds.length > 0) {
      sections.push(`ROSTER_NEEDS: ${ctx.rosterNeeds.join(', ')}`)
    }

    // Bye week conflicts on the current roster.
    if (ctx.byeWeekConflicts.length > 0) {
      sections.push(`BYE_CONFLICTS_ON_ROSTER: ${ctx.byeWeekConflicts.join(', ')} — avoid stacking more from same bye week`)
    }

    // Grounding confidence — let the LLM know data quality.
    if (ctx.confidence < 0.4 && ctx.missingData.length > 0) {
      sections.push(`DATA_NOTE: grounded context confidence=${ctx.confidence.toFixed(2)} — lean on ADP/positional heuristics`)
    }
  }

  sections.push(`AVAILABLE_PLAYERS (name|pos|team|adp[|injury:level][|bye:week]):\n${avail}`)
  sections.push(`Return JSON:
{
  "reasoning": [string, string, string, string],
  "strategyTip": string,
  "risk": "low"|"medium"|"high",
  "riskNote": string,
  "alternativeNames": [string, string]
}`)

  return sections.join('\n')
}

async function callLlmWarRoom(userBlock: string): Promise<{ raw: Record<string, unknown>; provider: 'openai' | 'deepseek' } | null> {
  const oa = await openaiChatJson({
    messages: [
      { role: 'system', content: SYSTEM_WAR_ROOM },
      { role: 'user', content: userBlock },
    ],
    temperature: 0.25,
    maxTokens: 900,
    skipCache: true,
  })
  if (oa.ok) {
    const parsed = parseJsonContentFromChatCompletion(oa.json)
    if (parsed && typeof parsed === 'object') {
      return { raw: parsed as Record<string, unknown>, provider: 'openai' }
    }
  }
  const ds = await deepseekChat({
    systemPrompt: SYSTEM_WAR_ROOM,
    prompt: userBlock,
    temperature: 0.2,
    maxTokens: 900,
  })
  if (!ds.content || ds.error) return null
  try {
    const raw = JSON.parse(ds.content.replace(/```json\n?|\n?```/g, '').trim()) as Record<string, unknown>
    return { raw, provider: 'deepseek' }
  } catch {
    return null
  }
}

/**
 * Full War Room: deterministic engine first, then optional LLM overlay for narrative fields.
 */
export async function runDraftWarRoomRecommendation(input: DraftWarRoomInput): Promise<DraftWarRoomOutput> {
  const sport = normalizeToSupportedSport(input.sport)
  const available = input.availablePlayers.slice(0, 200).map((p) => ({
    name: String(p.name ?? '').trim(),
    position: String(p.position ?? '').trim(),
    team: p.team ?? null,
    adp: p.adp ?? null,
  }))

  if (available.length === 0) {
    return {
      bestPick: { name: '—', position: '—', team: null },
      confidence: 0,
      reasoning: ['No players available in pool.'],
      strategyTip: 'Refresh the player pool or widen filters.',
      risk: 'high',
      riskNote: 'Empty board',
      alternatives: [],
      teamNeedSummary: '—',
      fallback: true,
      provider: 'deterministic',
    }
  }

  const det = computeDraftRecommendation({
    available,
    teamRoster: input.userRoster,
    rosterSlots: input.rosterSlots ?? [],
    round: Math.max(1, input.round),
    pick: Math.max(1, input.pickInRound ?? 1),
    totalTeams: Math.max(2, input.totalTeams),
    sport,
    isDynasty: Boolean(input.isDynasty),
    isSF: Boolean(input.isSuperflex),
    mode: input.mode === 'bpa' ? 'bpa' : 'needs',
    aiAdpByKey: input.aiAdpByKey,
    draftEligiblePositions: input.draftEligiblePositions,
  })

  const base = mapDeterministicToWarRoom(det, available)
  if (!base) {
    return {
      bestPick: available[0],
      confidence: 55,
      reasoning: ['Top available by board order.', 'Check positional needs.', 'Compare ADP.', 'Monitor injury news.'],
      strategyTip: 'Draft the best available player that fills a starting need.',
      risk: 'medium',
      riskNote: 'Limited deterministic data.',
      alternatives: available.slice(1, 4),
      teamNeedSummary: '—',
      fallback: true,
      provider: 'deterministic',
    }
  }

  const llm = await callLlmWarRoom(buildUserPayload(input, available))
  if (!llm) {
    return { ...base, fallback: true }
  }

  const r = llm.raw
  const reasoning = Array.isArray(r.reasoning)
    ? (r.reasoning as unknown[]).map((x) => String(x).slice(0, 220)).filter(Boolean).slice(0, 4)
    : base.reasoning
  while (reasoning.length < 4) {
    reasoning.push(base.reasoning[reasoning.length] ?? '')
  }

  const strategyTip = typeof r.strategyTip === 'string' ? r.strategyTip.slice(0, 280) : base.strategyTip

  // HONESTY PASS (Slice 16): the model used to OVERWRITE the deterministic
  // `risk` label and replace `alternatives` with players of its own choosing —
  // while the result was still stamped with a single object-level `provider`,
  // so nothing downstream could tell that `bestPick`/`confidence` were engine
  // output but `risk`/`alternatives` were model output. A board badge reading
  // "risky" could contradict the engine's own confidence.
  //
  // Now, matching the pattern TradeAnalyzerAIService already established
  // ("do not override the fairness score"):
  //   • `risk` stays DETERMINISTIC. It is derived from the engine's own
  //     uncertainty/caveats/confidence and the model cannot move it.
  //   • `riskNote` may be model prose — it explains, it doesn't decide.
  //   • `alternatives` may be REORDERED by the model but must be a SUBSET of
  //     the engine's ranked alternates. The model cannot introduce a player
  //     the engine never surfaced.
  const risk = base.risk
  const riskNote = typeof r.riskNote === 'string' ? r.riskNote.slice(0, 280) : base.riskNote

  const deterministicAlternates = new Map(base.alternatives.map((p) => [p.name, p]))
  const altNames = Array.isArray(r.alternativeNames) ? r.alternativeNames : []
  const alternatives: WarRoomPlayer[] = []
  for (const nm of altNames) {
    const candidate = deterministicAlternates.get(String(nm))
    if (candidate && candidate.name !== base.bestPick.name && !alternatives.includes(candidate)) {
      alternatives.push(candidate)
    }
    if (alternatives.length >= 3) break
  }
  // Anything the engine ranked that the model omitted still belongs on the
  // board — the model may reprioritize, not silently drop.
  for (const candidate of base.alternatives) {
    if (alternatives.length >= 3) break
    if (!alternatives.includes(candidate) && candidate.name !== base.bestPick.name) {
      alternatives.push(candidate)
    }
  }

  return {
    ...base,
    reasoning: reasoning.slice(0, 4),
    strategyTip,
    risk,
    riskNote,
    alternatives,
    fallback: false,
    provider: llm.provider,
    // Per-FIELD provenance, so a consumer never mistakes model prose for
    // engine output (the object-level `provider` alone could not express this).
    fieldSources: {
      bestPick: 'deterministic',
      confidence: 'deterministic',
      risk: 'deterministic',
      alternatives: 'deterministic_ranked',
      reasoning: Array.isArray(r.reasoning) ? 'ai' : 'deterministic',
      strategyTip: typeof r.strategyTip === 'string' ? 'ai' : 'deterministic',
      riskNote: typeof r.riskNote === 'string' ? 'ai' : 'deterministic',
    },
  }
}

const SYSTEM_COMPARE = `You are a multi-sport fantasy draft analyst. Output ONLY valid JSON.
Pick winner A or B for the stated sport and format. No hedging. Forbidden: "it depends", "maybe", "uncertain".`

export async function runDraftPlayerCompare(input: DraftCompareInput): Promise<DraftCompareOutput> {
  const block = [
    `SPORT: ${input.sport}`,
    `PLAYER_A: ${input.playerA.name} ${input.playerA.position} ${input.playerA.team ?? ''} ADP ${input.playerA.adp ?? 'n/a'}`,
    `PLAYER_B: ${input.playerB.name} ${input.playerB.position} ${input.playerB.team ?? ''} ADP ${input.playerB.adp ?? 'n/a'}`,
    input.scoringHint ? `SCORING: ${input.scoringHint}` : '',
    input.rosterContext ? `ROSTER: ${input.rosterContext}` : '',
    `JSON:
{"winner":"A"|"B","confidence":0-100,"breakdown":{"projection":"","matchup":"","usage":"","risk":""},"advice":""}`,
  ]
    .filter(Boolean)
    .join('\n')

  const oa = await openaiChatJson({
    messages: [
      { role: 'system', content: SYSTEM_COMPARE },
      { role: 'user', content: block },
    ],
    temperature: 0.2,
    maxTokens: 700,
    skipCache: true,
  })
  let parsed: Record<string, unknown> | null = null
  if (oa.ok) {
    parsed = parseJsonContentFromChatCompletion(oa.json) as Record<string, unknown> | null
  }
  if (!parsed) {
    const ds = await deepseekChat({ systemPrompt: SYSTEM_COMPARE, prompt: block, temperature: 0.2, maxTokens: 700 })
    if (ds.content) {
      try {
        parsed = JSON.parse(ds.content.replace(/```json\n?|\n?```/g, '').trim()) as Record<string, unknown>
      } catch {
        parsed = null
      }
    }
  }

  const adpA = input.playerA.adp ?? 999
  const adpB = input.playerB.adp ?? 999
  if (!parsed) {
    const aWins = adpA <= adpB
    return {
      winner: aWins ? 'A' : 'B',
      confidence: 58,
      breakdown: {
        projection: 'ADP-based tiebreak (AI unavailable).',
        matchup: 'Compare schedules post-draft.',
        usage: 'Verify camp depth charts.',
        risk: 'Injury and role volatility apply to both.',
      },
      advice: aWins
        ? `Lean ${input.playerA.name} on ADP value in this format.`
        : `Lean ${input.playerB.name} on ADP value in this format.`,
      fallback: true,
    }
  }

  const winner = parsed.winner === 'B' ? 'B' : 'A'
  const conf = Math.min(100, Math.max(40, Number(parsed.confidence) || 70))
  const br = parsed.breakdown && typeof parsed.breakdown === 'object' ? (parsed.breakdown as Record<string, unknown>) : {}
  return {
    winner,
    confidence: conf,
    breakdown: {
      projection: String(br.projection ?? 'Projection lean to the winner for this format.'),
      matchup: String(br.matchup ?? 'Schedule strength is comparable until season approaches.'),
      usage: String(br.usage ?? 'Role and volume favor the pick with clearer path.'),
      risk: String(br.risk ?? 'Both carry typical injury and role risk.'),
    },
    advice: String(parsed.advice ?? `Draft ${winner === 'A' ? input.playerA.name : input.playerB.name} for this build.`),
    fallback: false,
  }
}
