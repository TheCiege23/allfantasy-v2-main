import type { UserLineupPreferenceProfileInput } from '@/lib/lineup-decision-engine/types'
import { LINEUP_PREFERENCE_DECAY_RULES, LINEUP_PREFERENCE_TIEBREAKER_RULES } from './rules'
import { AUX_LINEUP_TRAIT_IDS, LINEUP_PREFERENCE_TRAIT_IDS, type LineupPreferenceTraitId } from './trait-ids'
import type {
  LineupPreferenceEventKind,
  LineupPreferenceExample,
  TraitStoredState,
  UserLineupPreferenceProfile,
} from './types'

const MS_PER_DAY = 86_400_000
const REINFORCE_BASE = 0.085
const PENALIZE_BASE = 0.06
const LARGE_EDGE_THRESHOLD = 8
const MAX_EXAMPLES = 8

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

export function decayConfidenceForIdle(
  confidence: number,
  lastReinforcedAt: Date | null,
  referenceTime: Date,
  now: Date
): number {
  const anchor = lastReinforcedAt ?? referenceTime
  const daysIdle = Math.max(0, (now.getTime() - anchor.getTime()) / MS_PER_DAY)
  if (daysIdle <= 0) return confidence
  const factor = Math.pow(LINEUP_PREFERENCE_DECAY_RULES.DECAY_BASE_PER_DAY, daysIdle)
  return clamp01(confidence * factor)
}

function emptyTrait(traitId: string, createdAt: Date): TraitStoredState {
  return {
    traitId,
    confidence: 0,
    sampleSize: 0,
    lastReinforcedAt: null,
    examples: [],
    metadata: null,
  }
}

export function traitMapFromRows(
  rows: Array<{
    traitId: string
    confidence: number
    sampleSize: number
    lastReinforcedAt: Date | null
    examples: unknown
    metadata: unknown
    createdAt: Date
  }>
): Map<string, TraitStoredState> {
  const map = new Map<string, TraitStoredState>()
  for (const r of rows) {
    const ex = Array.isArray(r.examples) ? (r.examples as LineupPreferenceExample[]) : []
    map.set(r.traitId, {
      traitId: r.traitId,
      confidence: r.confidence,
      sampleSize: r.sampleSize,
      lastReinforcedAt: r.lastReinforcedAt,
      examples: ex,
      metadata: r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : null,
    })
  }
  return map
}

function ensureTrait(
  map: Map<string, TraitStoredState>,
  traitId: string,
  createdAt: Date
): TraitStoredState {
  let t = map.get(traitId)
  if (!t) {
    t = emptyTrait(traitId, createdAt)
    map.set(traitId, t)
  }
  return t
}

function pushExample(t: TraitStoredState, summary: string, kind?: string, at = new Date().toISOString()) {
  const next: LineupPreferenceExample[] = [{ summary, at, kind }, ...t.examples].slice(0, MAX_EXAMPLES)
  t.examples = next
}

function reinforceTrait(
  t: TraitStoredState,
  strength: number,
  summary: string,
  kind?: string,
  now = new Date()
): void {
  const s = clamp01(strength)
  const delta = REINFORCE_BASE * s * (1 - t.confidence * 0.35)
  t.confidence = clamp01(t.confidence + delta)
  t.sampleSize += 1
  t.lastReinforcedAt = now
  pushExample(t, summary, kind)
}

function penalizeTrait(t: TraitStoredState, strength: number, summary: string, kind?: string): void {
  const s = clamp01(strength)
  t.confidence = clamp01(t.confidence - PENALIZE_BASE * s)
  t.sampleSize += 1
  pushExample(t, summary, kind)
}

function edgeScale(edgeMagnitude?: number): number {
  if (edgeMagnitude == null || !Number.isFinite(edgeMagnitude)) return 1
  if (edgeMagnitude >= LARGE_EDGE_THRESHOLD) return 0.35
  if (edgeMagnitude >= LARGE_EDGE_THRESHOLD / 2) return 0.65
  return 1
}

export function applyLearningEvent(
  map: Map<string, TraitStoredState>,
  kind: LineupPreferenceEventKind,
  payload: Record<string, unknown>,
  now: Date
): void {
  const createdAt = now

  if (kind === 'ai_lineup_accepted') {
    const closeCall = Boolean(payload.closeCall)
    const edgeMagnitude = typeof payload.edgeMagnitude === 'number' ? payload.edgeMagnitude : undefined
    const reinforce = (payload.reinforceTraits as string[] | undefined) ?? []
    const scale = edgeScale(edgeMagnitude) * (closeCall ? 1 : 0.55)
    for (const id of reinforce) {
      if (!LINEUP_PREFERENCE_TRAIT_IDS.includes(id as LineupPreferenceTraitId)) continue
      const t = ensureTrait(map, id, createdAt)
      reinforceTrait(
        t,
        scale,
        `Accepted AI lineup (${closeCall ? 'close call' : 'clear edge'}).`,
        'ai_lineup_accepted'
      )
    }
    if (reinforce.length === 0 && closeCall) {
      const t = ensureTrait(map, 'prefers_consistency', createdAt)
      reinforceTrait(t, 0.5 * scale, 'Accepted AI on a close decision.', 'ai_lineup_accepted')
    }
    return
  }

  if (kind === 'ai_lineup_rejected') {
    const rejected = (payload.rejectedTraits as string[] | undefined) ?? []
    const aligned = (payload.userAlignedTraits as string[] | undefined) ?? []
    for (const id of rejected) {
      if (!LINEUP_PREFERENCE_TRAIT_IDS.includes(id as LineupPreferenceTraitId)) continue
      const t = ensureTrait(map, id, createdAt)
      penalizeTrait(t, 0.85, 'User rejected AI aligned with this trait.', 'ai_lineup_rejected')
    }
    for (const id of aligned) {
      if (!LINEUP_PREFERENCE_TRAIT_IDS.includes(id as LineupPreferenceTraitId)) continue
      const t = ensureTrait(map, id, createdAt)
      reinforceTrait(t, 0.9, 'User chose a path aligned with this trait instead of AI.', 'ai_lineup_rejected')
    }
    return
  }

  if (kind === 'bench_promoted') {
    const position = String(payload.position ?? '').toUpperCase() || 'UNK'
    const archetype = String(payload.archetype ?? 'unknown')
    const tPos = ensureTrait(map, 'position_trust', createdAt)
    const prev = (tPos.metadata ?? {}) as Record<string, unknown>
    const byPrev = (prev.byPosition as Record<string, number> | undefined) ?? {}
    const meta: Record<string, unknown> = { ...prev, byPosition: { ...byPrev } }
    const by = meta.byPosition as Record<string, number>
    by[position] = clamp01((by[position] ?? 0.5) + 0.04)
    meta.byPosition = by
    tPos.metadata = meta
    reinforceTrait(tPos, 0.7, `Promoted bench player at ${position}.`, 'bench_promoted')

    const archMap: Record<string, LineupPreferenceTraitId | undefined> = {
      veteran: 'prefers_veterans',
      rookie: 'prefers_rookies',
      star: 'prefers_star_power',
      streamer: 'prefers_matchup_chasing',
    }
    const tid = archMap[archetype]
    if (tid) {
      const t = ensureTrait(map, tid, createdAt)
      reinforceTrait(t, 0.75, `Manual promotion: ${archetype} archetype.`, 'bench_promoted')
    }
    return
  }

  if (kind === 'auto_sub_allowed') {
    const t = ensureTrait(map, 'allows_auto_sub', createdAt)
    reinforceTrait(t, 1, 'User allowed injury/inactive auto-sub.', 'auto_sub_allowed')
    const sp = ensureTrait(map, 'prefers_same_position_emergency', createdAt)
    reinforceTrait(sp, 0.6, 'Accepted automatic inactive replacement.', 'auto_sub_allowed')
    return
  }

  if (kind === 'auto_sub_denied') {
    const t = ensureTrait(map, 'allows_auto_sub', createdAt)
    penalizeTrait(t, 0.8, 'User blocked or reverted auto-sub.', 'auto_sub_denied')
    return
  }

  if (kind === 'injury_contingency_respected') {
    const t = ensureTrait(map, 'injury_contingency_trust', createdAt)
    reinforceTrait(t, 1, 'User kept injury contingency recommendation.', 'injury_contingency_respected')
    return
  }

  if (kind === 'injury_contingency_overridden') {
    const t = ensureTrait(map, 'injury_contingency_trust', createdAt)
    penalizeTrait(t, 0.85, 'User overrode injury contingency suggestion.', 'injury_contingency_overridden')
    return
  }

  if (kind === 'lineup_outcome_feedback') {
    const under = Boolean(payload.underperformed)
    const involved = (payload.traitsInvolved as string[] | undefined) ?? []
    for (const id of involved) {
      if (!LINEUP_PREFERENCE_TRAIT_IDS.includes(id as LineupPreferenceTraitId)) continue
      const t = ensureTrait(map, id, createdAt)
      if (under) {
        penalizeTrait(t, 0.55, 'Post-game outcome underperformed vs expectation.', 'lineup_outcome_feedback')
      } else {
        reinforceTrait(t, 0.45, 'Post-game outcome aligned with lean.', 'lineup_outcome_feedback')
      }
    }
  }
}

export function applyDecayToAllTraits(
  map: Map<string, TraitStoredState>,
  rowCreatedAt: Map<string, Date>,
  now: Date
): void {
  for (const [id, t] of map) {
    const ref = rowCreatedAt.get(id) ?? now
    t.confidence = decayConfidenceForIdle(t.confidence, t.lastReinforcedAt, ref, now)
  }
}

export function traitsMapToStoredArray(map: Map<string, TraitStoredState>): TraitStoredState[] {
  return Array.from(map.values()).sort((a, b) => a.traitId.localeCompare(b.traitId))
}

export function buildOptimizerProfileInput(traits: TraitStoredState[]): UserLineupPreferenceProfileInput {
  const byId = new Map(traits.map((t) => [t.traitId, t]))
  const g = (id: string) => clamp01(byId.get(id)?.confidence ?? 0)

  const positionMeta = byId.get('position_trust')?.metadata as { byPosition?: Record<string, number> } | undefined
  const positionTrust = positionMeta?.byPosition

  const confidences = LINEUP_PREFERENCE_TRAIT_IDS.map((id) => g(id)).filter((c) => c > 0.05)
  const avg =
    confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0
  const preferenceWeight = Math.min(
    LINEUP_PREFERENCE_TIEBREAKER_RULES.maxPreferenceWeight,
    0.12 + avg * 0.42
  )

  return {
    prefersConsistency: Math.max(g('prefers_safe_floor'), g('prefers_consistency')),
    prefersHighCeiling: g('prefers_high_ceiling'),
    prefersStableVeterans: g('prefers_veterans'),
    prefersRookies: g('prefers_rookies'),
    prefersStarsOverMatchups: g('prefers_star_power'),
    prefersMatchupChasing: g('prefers_matchup_chasing'),
    prefersTeamLoyalty: g('prefers_team_loyalty'),
    prefersSamePositionEmergency: g('prefers_same_position_emergency'),
    prefersAggressiveUnderdogLineups: g('prefers_high_ceiling') * 0.85,
    prefersSafeFavoriteLineups: Math.max(g('prefers_safe_floor'), g('prefers_consistency')) * 0.9,
    preferenceWeight,
    allowsAutoSub: g('allows_auto_sub'),
    injuryContingencyTrust: g('injury_contingency_trust'),
    positionTrust,
  }
}

export function computeStatsFromRecentEvents(
  events: Array<{ kind: string }>,
  autoSubWindow = 40
): UserLineupPreferenceProfile['stats'] {
  const slice = events.slice(0, autoSubWindow)
  let autoAllow = 0
  let autoDeny = 0
  let injOverride = 0
  let injRespect = 0
  for (const e of slice) {
    if (e.kind === 'auto_sub_allowed') autoAllow += 1
    if (e.kind === 'auto_sub_denied') autoDeny += 1
    if (e.kind === 'injury_contingency_overridden') injOverride += 1
    if (e.kind === 'injury_contingency_respected') injRespect += 1
  }
  const autoTotal = autoAllow + autoDeny
  const injTotal = injOverride + injRespect
  return {
    autoSubAllowRate: autoTotal > 0 ? autoAllow / autoTotal : 0.5,
    injuryContingencyOverrideRate: injTotal > 0 ? injOverride / injTotal : 0,
    eventsSampleSize: slice.length,
  }
}

export function buildPublicProfile(
  userId: string,
  traits: TraitStoredState[],
  stats: UserLineupPreferenceProfile['stats']
): UserLineupPreferenceProfile {
  const traitSummary: UserLineupPreferenceProfile['traitSummary'] = {}
  for (const t of traits) {
    traitSummary[t.traitId] = {
      confidence: t.confidence,
      sampleSize: t.sampleSize,
      lastReinforcedAt: t.lastReinforcedAt?.toISOString() ?? null,
    }
  }
  return {
    userId,
    traits,
    stats,
    optimizerProfileInput: buildOptimizerProfileInput(traits),
    traitSummary,
  }
}
