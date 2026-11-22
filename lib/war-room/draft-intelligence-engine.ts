import { runLiveDraftBrainDeterministic, type LiveDraftBrainInput, type LiveDraftBrainPoolPlayer } from '@/lib/live-draft-brain'
import type { LiveDraftBrainEnvelope } from '@/lib/live-draft-brain/schemas'
import { resolveBrainMode } from './strategy-mode-map'

export type ContingencyPlan = {
  id: string
  trigger: string
  thenPick: string
  position: string
  rationale: string
}

export type StackOpportunity = {
  playerName: string
  position: string
  team: string | null
  stacksWith: string
  reason: string
}

export type RosterBuildAnalysis = {
  positionCounts: Record<string, number>
  rosterSlots: string[]
  gapNotes: string[]
  buildSummary: string
}

export type WarRoomIntelligenceResult = {
  version: 'war_room_intel_v1'
  strategyMode: { requested: string | null; resolved: string; brainMode: string }
  confidencePct: number
  pickNow: LiveDraftBrainEnvelope['pickRecommendation']
  bestValue: LiveDraftBrainEnvelope['pickRecommendation']
  bestFit: LiveDraftBrainEnvelope['pickRecommendation']
  bestUpside: LiveDraftBrainEnvelope['pickRecommendation']
  bestSafePick: LiveDraftBrainEnvelope['pickRecommendation']
  waitCandidates: Array<{
    playerName: string
    position: string
    waitOrTakeNow: string
    note: string
  }>
  takeVsWait: {
    primary: LiveDraftBrainEnvelope['pickRecommendation']['waitOrTakeNow']
    headline: string
    bullets: string[]
  }
  scarcityAlerts: string[]
  stackOpportunities: StackOpportunity[]
  contingencyPlans: ContingencyPlan[]
  rosterBuild: RosterBuildAnalysis
  tierBoard: LiveDraftBrainEnvelope['boardTierSummary']
  envelope: LiveDraftBrainEnvelope
}

function scoreToConfidencePct(pickScore: number): number {
  const scaled = 50 + Math.min(45, Math.max(-45, pickScore / 3))
  return Math.round(Math.min(99, Math.max(48, scaled)))
}

function countPositions(roster: LiveDraftBrainInput['myTeam']['teamRoster']): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of roster) {
    const pos = String(row.position || 'UNK').toUpperCase()
    counts[pos] = (counts[pos] ?? 0) + 1
  }
  return counts
}

function buildGapNotes(
  counts: Record<string, number>,
  slots: string[],
  sport: string
): { gapNotes: string[]; buildSummary: string } {
  const slotCounts = slots.reduce<Record<string, number>>((acc, s) => {
    const p = s.toUpperCase()
    acc[p] = (acc[p] ?? 0) + 1
    return acc
  }, {})
  const notes: string[] = []
  for (const pos of Object.keys(slotCounts)) {
    if (['BN', 'BENCH', 'FLEX', 'F', 'UTIL', 'G', 'SG', 'SF', 'PF', 'C'].includes(pos)) continue
    const need = slotCounts[pos] ?? 0
    const have = counts[pos] ?? 0
    if (need > 0 && have < need) {
      notes.push(`${pos}: need ~${need}, have ${have} on roster snapshot.`)
    }
  }
  if (notes.length === 0) {
    notes.push('Roster snapshot looks balanced vs starter slots — lean value or upside.')
  }
  return {
    gapNotes: notes,
    buildSummary: `${sport} build check — ${notes[0] ?? 'balanced'}`,
  }
}

function findStackOpportunities(
  available: LiveDraftBrainPoolPlayer[],
  roster: LiveDraftBrainInput['myTeam']['teamRoster'],
  limit: number
): StackOpportunity[] {
  const teams = new Set(
    roster.map((r) => (r.team ? String(r.team).toUpperCase() : null)).filter(Boolean) as string[]
  )
  const out: StackOpportunity[] = []
  for (const p of available) {
    if (!p.team || out.length >= limit) continue
    const t = String(p.team).toUpperCase()
    if (teams.has(t)) {
      const stackWith = roster.find((r) => r.team && String(r.team).toUpperCase() === t)?.playerName ?? 'your player'
      out.push({
        playerName: p.name,
        position: p.position,
        team: p.team ?? null,
        stacksWith: stackWith,
        reason: `Same team (${t}) — stack correlation for boom weeks; watch bye overlap.`,
      })
    }
  }
  return out
}

function buildContingencyPlans(
  envelope: LiveDraftBrainEnvelope,
  available: LiveDraftBrainPoolPlayer[],
  maxPlans: number
): ContingencyPlan[] {
  const top = envelope.pickRecommendationsTop3
  const primary = top[0]
  const plans: ContingencyPlan[] = []
  if (top[1]) {
    plans.push({
      id: 'c1',
      trigger: `If ${primary.playerName} is taken before your pick`,
      thenPick: top[1].playerName,
      position: top[1].position,
      rationale: top[1].reasoning[0] ?? 'Next best graded option in current mode.',
    })
  }
  if (top[2]) {
    plans.push({
      id: 'c2',
      trigger: `If ${primary.position} run starts (2+ ${primary.position}s in a row)`,
      thenPick: top[2].playerName,
      position: top[2].position,
      rationale: 'Pivot off positional run — preserve value or fill next hole.',
    })
  }
  const rest = available
    .filter((p) => p.name !== primary.playerName)
    .slice(0, 6)
  let i = plans.length
  for (const p of rest) {
    if (plans.length >= maxPlans) break
    if (plans.some((x) => x.thenPick === p.name)) continue
    i += 1
    plans.push({
      id: `c${i}`,
      trigger: `If board value falls at ${p.position}`,
      thenPick: p.name,
      position: p.position,
      rationale: 'Best available from pool when primary targets are gone.',
    })
  }
  return plans.slice(0, maxPlans)
}

/**
 * Deterministic-first War Room intelligence — wraps Live Draft Brain + scarcity / stacks / contingencies.
 * Multi-model narrative (OpenAI / DeepSeek / Grok) should wrap this object, not replace scores.
 */
export function runWarRoomDraftIntelligence(
  rawInput: LiveDraftBrainInput,
  options?: { strategyMode?: string | null }
): WarRoomIntelligenceResult {
  const strategyRequested = options?.strategyMode?.trim() ?? null
  const brainMode = resolveBrainMode(strategyRequested ?? undefined)
  const input: LiveDraftBrainInput = {
    ...rawInput,
    mode: brainMode,
  }

  const envelope = runLiveDraftBrainDeterministic(input)
  const primary = envelope.pickRecommendation
  const top3 = envelope.pickRecommendationsTop3
  const confidencePct = scoreToConfidencePct(primary.pickScore)

  const bestValue = top3[0] ?? primary
  const bestFit = top3.find((p) => p.recommendationType === 'needs') ?? top3[1] ?? bestValue
  const bestUpside = top3.find((p) => p.recommendationType === 'upside') ?? top3[2] ?? top3[1] ?? bestValue
  const bestSafePick = top3.find((p) => p.recommendationType === 'safe') ?? top3[2] ?? top3[1] ?? bestValue

  const waitCandidates = top3
    .filter((p) => p.waitOrTakeNow === 'safe_to_wait')
    .map((p) => ({
      playerName: p.playerName,
      position: p.position,
      waitOrTakeNow: p.waitOrTakeNow,
      note: 'Model suggests you may see them later — still monitor runs.',
    }))

  const takeHeadline =
    primary.waitOrTakeNow === 'take_now'
      ? 'Take now — tier cliff or scarcity risk.'
      : primary.waitOrTakeNow === 'unlikely_to_return'
        ? 'Unlikely to return — strong reach risk if you pass.'
        : 'Safe to wait — but monitor positional runs.'

  const scarcityAlerts = [...envelope.positionalRunSignals, ...envelope.tierCliffWarnings].slice(0, 12)

  const rosterCounts = countPositions(rawInput.myTeam.teamRoster)
  const { gapNotes, buildSummary } = buildGapNotes(rosterCounts, rawInput.myTeam.rosterSlots, String(input.context.sport))

  const stacks = findStackOpportunities(rawInput.available.slice(0, 40), rawInput.myTeam.teamRoster, 6)

  const contingencyPlans = buildContingencyPlans(envelope, rawInput.available, 6)

  return {
    version: 'war_room_intel_v1',
    strategyMode: {
      requested: strategyRequested,
      resolved: strategyRequested ?? brainMode,
      brainMode,
    },
    confidencePct,
    pickNow: primary,
    bestValue,
    bestFit,
    bestUpside,
    bestSafePick,
    waitCandidates,
    takeVsWait: {
      primary: primary.waitOrTakeNow,
      headline: takeHeadline,
      bullets: primary.reasoning.slice(0, 4),
    },
    scarcityAlerts,
    stackOpportunities: stacks,
    contingencyPlans,
    rosterBuild: {
      positionCounts: rosterCounts,
      rosterSlots: rawInput.myTeam.rosterSlots,
      gapNotes,
      buildSummary,
    },
    tierBoard: envelope.boardTierSummary,
    envelope,
  }
}
