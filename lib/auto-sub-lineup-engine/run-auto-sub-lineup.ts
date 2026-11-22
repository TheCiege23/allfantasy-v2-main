import { enrichPremiumPlayer } from '@/lib/lineup-decision-engine/enrich-player'
import { normalizePreferenceProfile } from '@/lib/lineup-decision-engine/preference-learning'
import type {
  LeagueContextInput,
  LineupDecisionMode,
  PremiumPlayerInput,
  TeamContextInput,
  UserLineupPreferenceProfileInput,
} from '@/lib/lineup-decision-engine/types'
import {
  computePreferenceTieBreaker,
  computeReplacementScore,
  isCloseCall,
} from './replacement-score'
import { normalizePositionToken } from './normalize-position'
import { allowedPositionsForSlotCode, playerEligibleForSlot, slotFitScore } from './slot-legality'
import { isAutoSubEligibleTrigger } from './triggers'

const DEFAULT_MODE: LineupDecisionMode = 'Best Lineup'
type EnrichedPlayer = ReturnType<typeof enrichPremiumPlayer>

export interface AutoSubLineupEngineInput {
  sport?: string
  lineupMode?: LineupDecisionMode
  teamContext?: TeamContextInput
  leagueContext?: LeagueContextInput
  preferenceProfile?: UserLineupPreferenceProfileInput
  /** Global lock — no automatic swaps */
  lineupLocked?: boolean
  /** Per-slot lock (slotId → locked) */
  slotLocks?: Record<string, boolean>
  starters: Array<{
    slotId: string
    slotCode: string
    player: PremiumPlayerInput
  }>
  bench: PremiumPlayerInput[]
}

interface AutoSubLineupEngineResult {
  autoSubsExecuted: Array<{
    starterName: string
    starterStatus: string
    replacementName: string
    replacementPosition: string
    slot: string
    whyTriggered: string
    whyChosen: string[]
    usedPreferenceTieBreaker: boolean
    confidence: number
  }>
  blockedAutoSubs: Array<{
    starterName: string
    reason: string
  }>
  notifications: string[]
  /** Structured audit lines for persistence / analytics */
  auditLog: Array<Record<string, unknown>>
}

function bestPositionForSlot(
  candidate: { positions: string[] },
  slotAllowed: Set<string>
): string {
  for (const p of candidate.positions) {
    const u = normalizePositionToken(p)
    if (u && slotAllowed.has(u)) return u
  }
  return candidate.positions[0] ?? '—'
}

export function runAutoSubLineupEngine(input: AutoSubLineupEngineInput): AutoSubLineupEngineResult {
  const mode = input.lineupMode ?? DEFAULT_MODE
  const preference = normalizePreferenceProfile(input.preferenceProfile)
  const ctx = {
    lineupMode: mode,
    team: input.teamContext,
    league: input.leagueContext,
    preference,
  }

  const enrichedStarters = input.starters.map((row) => ({
    slotId: row.slotId,
    slotCode: row.slotCode,
    player: enrichPremiumPlayer(row.player, mode, ctx),
  }))

  const benchPool = input.bench.map((p) => enrichPremiumPlayer(p, mode, ctx))

  const autoSubsExecuted: AutoSubLineupEngineResult['autoSubsExecuted'] = []
  const blockedAutoSubs: AutoSubLineupEngineResult['blockedAutoSubs'] = []
  const notifications: string[] = []
  const auditLog: AutoSubLineupEngineResult['auditLog'] = []

  const usedBenchIds = new Set<string>()

  for (const row of enrichedStarters) {
    const starter = row.player
    const statusLabel = starter.signals.injuryStatus?.trim() || 'Unknown'

    if (!isAutoSubEligibleTrigger(starter.signals.injuryStatus, starter.signals)) {
      continue
    }

    if (input.lineupLocked) {
      blockedAutoSubs.push({
        starterName: starter.name,
        reason: 'lock rules prevented swap',
      })
      notifications.push(`Auto-sub skipped (lineup locked): ${starter.name} at ${row.slotCode}.`)
      auditLog.push({
        event: 'blocked',
        starterId: starter.id,
        reason: 'global_lock',
        slotId: row.slotId,
      })
      continue
    }

    if (input.slotLocks?.[row.slotId]) {
      blockedAutoSubs.push({
        starterName: starter.name,
        reason: 'lock rules prevented swap',
      })
      notifications.push(`Auto-sub skipped (slot locked): ${starter.name} (${row.slotCode}).`)
      auditLog.push({ event: 'blocked', starterId: starter.id, reason: 'slot_lock', slotId: row.slotId })
      continue
    }

    const slotAllowed = allowedPositionsForSlotCode(row.slotCode)
    const vacated = starter.positions.map((p) => p.trim().toUpperCase())

    const availableBench = benchPool.filter(
      (b) =>
        !usedBenchIds.has(b.id) &&
        !isAutoSubEligibleTrigger(b.signals.injuryStatus, b.signals) &&
        playerEligibleForSlot(b.positions, slotAllowed)
    )

    if (availableBench.length === 0) {
      blockedAutoSubs.push({
        starterName: starter.name,
        reason: 'No legal replacement',
      })
      notifications.push(
        `Auto-sub blocked: no active bench player eligible for ${row.slotCode} while ${starter.name} is ${statusLabel}.`
      )
      auditLog.push({
        event: 'blocked',
        starterId: starter.id,
        reason: 'no_legal_replacement',
        slotId: row.slotId,
        slotCode: row.slotCode,
      })
      continue
    }

    const scoreRow = (c: EnrichedPlayer, applyPref: boolean) => {
      const ws = c.breakdown.weeklyStartScore
      const rs = c.breakdown.roleSecurityScore
      const ha = c.breakdown.healthAvailabilityScore
      const sf = slotFitScore({
        slotAllowed,
        vacatedStarterPositions: vacated,
        candidatePositions: c.positions,
      })
      const pt = computePreferenceTieBreaker({
        candidate: c,
        preference,
        lineupMode: mode,
        vacatedPositions: vacated,
        applyPreference: applyPref,
      })
      const replacementScore = computeReplacementScore({
        weeklyStartScore: ws,
        roleSecurity: rs,
        healthAvailability: ha,
        slotFit: sf,
        preferenceTieBreaker: pt,
      })
      return { c, replacementScore, ws, rs, ha, sf, pt }
    }

    let ranked = availableBench.map((c) => scoreRow(c, false))
    ranked.sort((a, b) => b.replacementScore - a.replacementScore)

    const close =
      ranked.length >= 2 && isCloseCall(ranked[0].replacementScore, ranked[1].replacementScore)
    const usedPreferenceTieBreaker = Boolean(close)

    if (close) {
      ranked = ranked
        .slice(0, Math.min(3, ranked.length))
        .map((row) => scoreRow(row.c, true))
      ranked.sort((a, b) => b.replacementScore - a.replacementScore)
    }

    const top = ranked[0]
    if (!top) continue

    const winner = top.c
    const replacementPosition = bestPositionForSlot(winner, slotAllowed)
    const confidence = Math.min(99, Math.round(52 + top.replacementScore * 0.35))

    const exec = {
      starterName: starter.name,
      starterStatus: statusLabel,
      replacementName: winner.name,
      replacementPosition,
      slot: row.slotCode,
      whyTriggered: `Official status indicates no scoring opportunity (${statusLabel}); injury/inactive-only auto-sub rules apply.`,
      whyChosen: [
        `ReplacementScore=${top.replacementScore.toFixed(2)} using WeeklyStart×0.55 + RoleSecurity×0.15 + Health×0.15 + SlotFit×0.10 + Preference×0.05.`,
        `Best legal fit for ${row.slotCode}: ${replacementPosition}; same-position priority before flex depth (slot fit ${top.sf.toFixed(0)}).`,
        usedPreferenceTieBreaker
          ? 'User preference profile applied on a close call between top candidates.'
          : 'Clear objective edge; preference tie-breaker not needed.',
      ],
      usedPreferenceTieBreaker,
      confidence,
    }

    autoSubsExecuted.push(exec)
    usedBenchIds.add(winner.id)

    const notif = `Auto-sub: ${starter.name} (${statusLabel}) → ${winner.name} (${replacementPosition}) in ${row.slotCode}.`
    notifications.push(notif)

    const auditEntry = {
      event: 'auto_sub_executed' as const,
      timestamp: new Date().toISOString(),
      slotId: row.slotId,
      slotCode: row.slotCode,
      starterId: starter.id,
      starterStatus: statusLabel,
      replacementId: winner.id,
      replacementScore: top.replacementScore,
      usedPreferenceTieBreaker,
      confidence,
    }
    auditLog.push(auditEntry)
    console.info('[auto-sub-lineup-engine]', JSON.stringify(auditEntry))
  }

  return { autoSubsExecuted, blockedAutoSubs, notifications, auditLog }
}

