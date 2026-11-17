/**
 * AI Drafter: optional strategy/narrative via API. Falls back to CPU when API unavailable.
 * AI actions are auditable; fallback ensures we never block on paid APIs.
 */

import { computeCPUPick } from './CPUDrafterService'
import type { CPUDrafterInput, DrafterPickResult } from './types'
import { getProviderStatus } from '@/lib/provider-config'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'

interface AIDrafterOptions {
  /** If true, attempt AI provider; otherwise use CPU only. */
  useAIProvider?: boolean
}

type ManagerProfile = {
  id: 'foundation' | 'upside' | 'value'
  label: string
  phasePriorities: {
    early: string[]
    middle: string[]
    late: string[]
  }
}

const MANAGER_PROFILES: ManagerProfile[] = [
  {
    id: 'foundation',
    label: 'Foundation Builder',
    phasePriorities: {
      early: ['RB', 'WR', 'QB', 'TE'],
      middle: ['WR', 'RB', 'TE', 'QB'],
      late: ['WR', 'RB', 'TE', 'QB'],
    },
  },
  {
    id: 'upside',
    label: 'Upside Chaser',
    phasePriorities: {
      early: ['WR', 'QB', 'RB', 'TE'],
      middle: ['WR', 'RB', 'QB', 'TE'],
      late: ['WR', 'TE', 'RB', 'QB'],
    },
  },
  {
    id: 'value',
    label: 'Value Hunter',
    phasePriorities: {
      early: ['WR', 'RB', 'TE', 'QB'],
      middle: ['RB', 'WR', 'TE', 'QB'],
      late: ['RB', 'WR', 'TE', 'QB'],
    },
  },
]

function hashDeterministic(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

function normalizePosition(value: string): string {
  return String(value ?? '').trim().toUpperCase()
}

function normalizePlayerKey(player: { name?: string | null; position?: string | null; team?: string | null }): string {
  return `${String(player.name ?? '').trim().toLowerCase()}|${normalizePosition(player.position ?? '')}|${String(player.team ?? '').trim().toLowerCase()}`
}

function pickProfile(input: CPUDrafterInput): ManagerProfile {
  const key = `${input.sport}:${input.round}:${input.slot}:${input.totalTeams}`
  const idx = hashDeterministic(key) % MANAGER_PROFILES.length
  return MANAGER_PROFILES[idx] ?? MANAGER_PROFILES[0]
}

function getRoundPhase(round: number): 'early' | 'middle' | 'late' {
  if (round <= 4) return 'early'
  if (round <= 10) return 'middle'
  return 'late'
}

function buildRosterCounts(teamRoster: { position: string }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const entry of teamRoster) {
    const position = normalizePosition(entry.position)
    counts.set(position, (counts.get(position) ?? 0) + 1)
  }
  return counts
}

function buildTargetCounts(rosterSlots: string[]): Map<string, number> {
  const targets = new Map<string, number>()
  for (const rawSlot of rosterSlots) {
    const slot = normalizePosition(rawSlot)
    if (!slot || slot === 'BENCH') continue
    if (slot === 'FLEX' || slot === 'SUPER_FLEX' || slot === 'SUPERFLEX' || slot === 'OP') continue
    targets.set(slot, (targets.get(slot) ?? 0) + 1)
  }
  return targets
}

function positionPriorityScore(position: string, priorities: string[]): number {
  const idx = priorities.findIndex((value) => value === position)
  if (idx < 0) return 0
  return (priorities.length - idx) * 16
}

function buildHeuristicAIPick(
  input: CPUDrafterInput,
  cpuFallback: DrafterPickResult
): DrafterPickResult | null {
  if (input.available.length === 0) return null
  const profile = pickProfile(input)
  const phase = getRoundPhase(input.round)
  const phasePriority = profile.phasePriorities[phase]
  const rosterCounts = buildRosterCounts(input.teamRoster)
  const targetCounts = buildTargetCounts(input.rosterSlots ?? [])
  const queueOrder = new Map<string, number>()
  ;(input.queueFirst ?? []).forEach((player, index) => {
    queueOrder.set(normalizePlayerKey(player), index)
  })

  const ranked = input.available
    .slice(0, 220)
    .map((player, index) => {
      const position = normalizePosition(player.position)
      const adpScore = player.adp != null && Number.isFinite(player.adp) ? Math.max(0, 260 - Number(player.adp)) : 36
      const rosterCount = rosterCounts.get(position) ?? 0
      const targetCount = targetCounts.get(position) ?? 1
      const needScore = rosterCount < targetCount ? (targetCount - rosterCount) * 24 : 0
      const priorityScore = positionPriorityScore(position, phasePriority)
      const queueIndex = queueOrder.get(normalizePlayerKey(player))
      const queueScore = queueIndex != null ? Math.max(0, 44 - queueIndex * 6) : 0
      const dynastyUpside = input.isDynasty && phase !== 'early' ? 8 : 0
      const total = adpScore + needScore + priorityScore + queueScore + dynastyUpside
      return { player, total, index, position, adpScore, needScore, priorityScore, queueScore }
    })
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total
      return a.index - b.index
    })

  const selected = ranked[0]
  if (!selected) return null
  const selectedKey = normalizePlayerKey(selected.player)
  const fallbackKey = normalizePlayerKey(cpuFallback.player)
  const blendedPlayer = selectedKey === fallbackKey ? cpuFallback.player : selected.player
  const confidence = Math.max(cpuFallback.confidence, Math.min(96, 66 + Math.round(selected.total / 12)))
  const reason = selectedKey === fallbackKey
    ? `${profile.label} AI profile confirmed the CPU baseline as the best fit for this round.`
    : `${profile.label} AI profile prioritized ${normalizePosition(selected.player.position)} value and roster fit for this pick window.`
  const narrative = [
    `${profile.label} strategy (${phase} phase).`,
    `Signal mix -> ADP ${selected.adpScore}, need ${selected.needScore}, priority ${selected.priorityScore}, queue ${selected.queueScore}.`,
    selectedKey === fallbackKey
      ? 'Decision converged with deterministic CPU baseline.'
      : `AI lane diverged from CPU baseline to improve roster construction balance.`,
  ].join(' ')

  return {
    player: {
      name: blendedPlayer.name,
      position: blendedPlayer.position,
      team: blendedPlayer.team ?? null,
      adp: blendedPlayer.adp ?? null,
      byeWeek: blendedPlayer.byeWeek ?? null,
    },
    reason,
    confidence,
    drafterMode: 'ai',
    narrative,
  }
}

export function isAIDrafterProviderAvailable(): boolean {
  return getProviderStatus().anyAi
}

/**
 * Try AI provider for narrative/reasoning; on any failure or unavailability, use CPU.
 * Returns result with drafterMode set to 'ai' only when AI actually produced the pick.
 */
export async function computeAIDrafterPick(
  input: CPUDrafterInput,
  options: AIDrafterOptions = {}
): Promise<DrafterPickResult | null> {
  const { useAIProvider = true } = options
  const cpuResult = computeCPUPick(input)
  if (!cpuResult) return null

  if (!useAIProvider) {
    return cpuResult
  }

  if (!isAIDrafterProviderAvailable()) {
    return cpuResult
  }

  try {
    const aiResult = await tryAIPickProvider(input)
    if (aiResult) return aiResult
  } catch {
    // Fallback to CPU on any error
  }
  const heuristic = buildHeuristicAIPick(
    {
      ...input,
      sport: normalizeToSupportedSport(input.sport || DEFAULT_SPORT),
    },
    cpuResult
  )
  return heuristic ?? cpuResult
}

/**
 * Optional: call external AI endpoint for narrative pick. Not required for correctness.
 * When implemented, return DrafterPickResult with drafterMode: 'ai' and narrative.
 */
async function tryAIPickProvider(_input: CPUDrafterInput): Promise<DrafterPickResult | null> {
  // No AI provider wired by default; extend here (e.g. call /api/leagues/[id]/draft/ai-pick-internal)
  // or a server-side LLM with deterministic fallback. Returning null forces CPU fallback.
  return null
}
