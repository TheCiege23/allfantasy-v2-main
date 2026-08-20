import type { ChimmyAlertCandidate, ChimmyAlertContext } from './types'

function minutesUntil(targetIso: string | null | undefined, now: Date): number | null {
  if (!targetIso) return null
  const target = new Date(targetIso)
  if (Number.isNaN(target.getTime())) return null
  return Math.round((target.getTime() - now.getTime()) / 60000)
}

/**
 * Designations severe enough that a manager needs to act before lock. `Questionable` is
 * deliberately excluded from the urgent tier: it fires constantly, and an alert that cries
 * wolf every Sunday trains people to ignore the one that matters.
 */
const URGENT_DESIGNATIONS = new Set(['out', 'doubtful', 'ir', 'suspension', 'suspended'])

function isUrgentDesignation(designation: string): boolean {
  return URGENT_DESIGNATIONS.has(String(designation ?? '').trim().toLowerCase())
}

/**
 * The Sunday-panic detector: a rostered STARTER carries an urgent injury designation and
 * lock is approaching.
 *
 * This is the alert the whole delivery effort exists for. It fires only on starters —
 * an injured bench player is information, not an emergency — and only on designations that
 * actually threaten availability.
 *
 * Urgency scales with time to lock rather than being constant, because the same fact is a
 * different problem at 45 minutes than at two days.
 */
export function detectInjuredStarterAlerts(context: ChimmyAlertContext): ChimmyAlertCandidate[] {
  const out: ChimmyAlertCandidate[] = []
  const now = context.now ?? new Date()
  const signals = context.signalBundle ?? {}
  const injured = signals.injuredStarters ?? []
  if (injured.length === 0) return out

  for (const player of injured) {
    if (!isUrgentDesignation(player.designation)) continue

    // The player's OWN kickoff is his lock. A league-wide time would be wrong for most of a
    // roster — a Thursday-night starter locks Thursday, a 4:25pm starter locks Sunday
    // afternoon. Fall back to a league-level lock only when the schedule has no game for him.
    const mins = minutesUntil(player.lockAt ?? signals.lineupLockAt, now)

    // Past lock there is nothing the manager can do, so saying it would be noise.
    if (mins != null && mins < 0) continue

    const urgencySignal = mins == null ? 70 : mins <= 60 ? 99 : mins <= 180 ? 88 : mins <= 720 ? 74 : 60

    const where = player.platform
      ? `Set your lineup in ${player.platform}.`
      : 'Update your lineup.'
    const swap = player.replacement
      ? player.replacement.projectedPoints != null
        ? ` ${player.replacement.playerName} is your best bench option (${player.replacement.projectedPoints.toFixed(1)} projected).`
        : ` ${player.replacement.playerName} is available on your bench.`
      : ''
    // Staleness is stated, never silently dropped — an old designation may no longer hold.
    const caveat = player.stale ? ' This designation has not updated recently — check before acting.' : ''

    out.push({
      class: 'lineup',
      type: 'injured_starter_before_lock',
      title: `${player.playerName} is ${player.designation} and still starting`,
      message:
        (mins != null
          ? `${player.playerName}${player.position ? ` (${player.position})` : ''} is listed ${player.designation} with ${mins} minutes to lock in ${player.leagueName ?? 'your league'}.`
          : `${player.playerName}${player.position ? ` (${player.position})` : ''} is listed ${player.designation} and is in your starting lineup in ${player.leagueName ?? 'your league'}.`) +
        swap +
        ` ${where}` +
        caveat,
      confidenceScore: player.stale ? 70 : 94,
      urgencySignal,
      urgencyDeadlineAt: player.lockAt ?? signals.lineupLockAt ?? null,
      roleScope: 'member',
      // Short cooldown near lock: this is the one alert worth repeating.
      repeatCooldownMinutes: mins != null && mins <= 90 ? 20 : 120,
      leagueId: player.leagueId,
      metadata: {
        minutesToLock: mins,
        designation: player.designation,
        detail: player.detail ?? null,
        platform: player.platform ?? null,
        replacement: player.replacement ?? null,
        stale: Boolean(player.stale),
      },
    })
  }

  return out
}

export function detectLineupAlerts(context: ChimmyAlertContext): ChimmyAlertCandidate[] {
  const out: ChimmyAlertCandidate[] = []
  const now = context.now ?? new Date()
  const signals = context.signalBundle ?? {}
  const mins = minutesUntil(signals.lineupLockAt, now)

  if (signals.lineupIncomplete) {
    const severitySignal = mins != null && mins <= 30 ? 95 : mins != null && mins <= 120 ? 80 : 62
    out.push({
      class: 'lineup',
      type: 'lineup_incomplete',
      title: 'Lineup is not set',
      message: mins != null && mins >= 0
        ? `Your lineup still has open/unsafe slots and lock is in ${mins} minutes.`
        : 'Your lineup still has open/unsafe slots.',
      confidenceScore: 92,
      urgencySignal: severitySignal,
      urgencyDeadlineAt: signals.lineupLockAt ?? null,
      roleScope: 'member',
      repeatCooldownMinutes: 20,
      metadata: { minutesToLock: mins },
    })
  }

  if (signals.highConfidenceStartSitSwing) {
    out.push({
      class: 'lineup',
      type: 'start_sit_high_confidence_swing',
      title: 'High-confidence lineup swing available',
      message: 'A start/sit pivot can materially improve your projected outcome.',
      confidenceScore: 85,
      urgencySignal: mins != null && mins <= 120 ? 78 : 58,
      urgencyDeadlineAt: signals.lineupLockAt ?? null,
      roleScope: 'member',
      repeatCooldownMinutes: 45,
    })
  }

  return out
}

export function detectWaiverAlerts(context: ChimmyAlertContext): ChimmyAlertCandidate[] {
  const out: ChimmyAlertCandidate[] = []
  const add = context.signalBundle?.highConfidenceWaiverAdd

  if (add) {
    out.push({
      class: 'waiver',
      type: 'priority_add_available',
      title: 'Priority waiver add available',
      message: `${add.playerName} is available with ${Math.round(add.confidence)}% confidence.` +
        (typeof add.faabPct === 'number' ? ` Suggested FAAB: ${add.faabPct}%.` : ''),
      confidenceScore: Math.min(99, Math.max(50, add.confidence)),
      urgencySignal: add.confidence >= 88 ? 86 : 72,
      roleScope: 'member',
      repeatCooldownMinutes: 60,
      metadata: { playerName: add.playerName, faabPct: add.faabPct ?? null },
    })
  }

  return out
}

export function detectTradeAlerts(context: ChimmyAlertContext): ChimmyAlertCandidate[] {
  const out: ChimmyAlertCandidate[] = []
  const pending = context.signalBundle?.tradeOfferPendingCount ?? 0
  if (pending > 0) {
    out.push({
      class: 'trade',
      type: 'new_trade_offer',
      title: 'Trade offer needs attention',
      message: pending === 1 ? 'You have 1 pending trade offer.' : `You have ${pending} pending trade offers.`,
      confidenceScore: 99,
      urgencySignal: pending > 2 ? 82 : 70,
      roleScope: 'member',
      repeatCooldownMinutes: 60,
      metadata: { pendingTradeOffers: pending },
    })
  }

  if (context.signalBundle?.tradeFairnessWarning) {
    out.push({
      class: 'trade',
      type: 'trade_fairness_warning',
      title: 'Trade fairness warning',
      message: 'A pending trade shows a meaningful fairness imbalance.',
      confidenceScore: 81,
      urgencySignal: 76,
      roleScope: 'member',
      repeatCooldownMinutes: 120,
    })
  }

  return out
}

export function detectDraftAlerts(context: ChimmyAlertContext): ChimmyAlertCandidate[] {
  const out: ChimmyAlertCandidate[] = []
  const signals = context.signalBundle

  if (signals?.draftStartingSoon) {
    out.push({
      class: 'draft',
      type: 'draft_starting_soon',
      title: 'Draft starts soon',
      message: 'Your league draft is starting soon. Review queue and strategy now.',
      confidenceScore: 95,
      urgencySignal: 74,
      roleScope: 'member',
      repeatCooldownMinutes: 90,
    })
  }

  if (signals?.onTheClock) {
    out.push({
      class: 'draft',
      type: 'on_the_clock',
      title: 'You are on the clock',
      message: 'Time-sensitive pick decision required now.',
      confidenceScore: 100,
      urgencySignal: 100,
      dismissible: false,
      snoozable: false,
      roleScope: 'member',
      repeatCooldownMinutes: 5,
    })
  }

  if (signals?.queueEmpty) {
    out.push({
      class: 'draft',
      type: 'queue_empty',
      title: 'Draft queue is empty',
      message: 'Add queue candidates to avoid timeout auto-picks.',
      confidenceScore: 98,
      urgencySignal: signals.onTheClock ? 92 : 66,
      roleScope: 'member',
      repeatCooldownMinutes: 30,
    })
  }

  return out
}

export function detectMatchupAlerts(context: ChimmyAlertContext): ChimmyAlertCandidate[] {
  const out: ChimmyAlertCandidate[] = []
  const shift = Math.abs(context.signalBundle?.winProbabilityShiftPct ?? 0)
  if (shift >= 8) {
    out.push({
      class: 'matchup',
      type: 'win_probability_shift',
      title: 'Matchup probability materially shifted',
      message: `Win probability moved by ${shift.toFixed(1)}%. Re-evaluate lineup pivots.`,
      confidenceScore: 84,
      urgencySignal: shift >= 15 ? 82 : 65,
      roleScope: 'member',
      repeatCooldownMinutes: 45,
      metadata: { winProbabilityShiftPct: shift },
    })
  }

  const weatherCount = context.signalBundle?.weatherRiskPlayerCount ?? 0
  if (weatherCount > 0) {
    out.push({
      class: 'matchup',
      type: 'weather_risk_now_relevant',
      title: 'Weather risk now relevant',
      message: `${weatherCount} starter${weatherCount > 1 ? 's are' : ' is'} impacted by weather-related volatility.`,
      confidenceScore: 77,
      urgencySignal: 72,
      roleScope: 'member',
      repeatCooldownMinutes: 60,
    })
  }

  return out
}

export function detectTeamRosterAlerts(context: ChimmyAlertContext): ChimmyAlertCandidate[] {
  const out: ChimmyAlertCandidate[] = []

  const irEligible = context.signalBundle?.irEligibleCount ?? 0
  if (irEligible > 0) {
    out.push({
      class: 'team_roster',
      type: 'ir_il_eligible_detected',
      title: 'IR/IL eligible player detected',
      message: `${irEligible} roster spot opportunity detected via IR/IL eligibility.`,
      confidenceScore: 90,
      urgencySignal: 68,
      roleScope: 'member',
      repeatCooldownMinutes: 180,
    })
  }

  const benchRedundancy = context.signalBundle?.benchRedundancyCount ?? 0
  if (benchRedundancy >= 2) {
    out.push({
      class: 'team_roster',
      type: 'bench_redundancy_warning',
      title: 'Bench redundancy issue',
      message: 'Multiple bench slots are concentrated in low-upside duplicate profiles.',
      confidenceScore: 74,
      urgencySignal: 52,
      roleScope: 'member',
      repeatCooldownMinutes: 360,
    })
  }

  return out
}

export function detectCommissionerAlerts(context: ChimmyAlertContext): ChimmyAlertCandidate[] {
  if (context.role !== 'commissioner' && context.role !== 'admin') return []

  const out: ChimmyAlertCandidate[] = []
  const inactiveTeams = context.signalBundle?.inactiveTeamCount ?? 0
  if (inactiveTeams > 0) {
    out.push({
      class: 'commissioner',
      type: 'inactive_team_pattern',
      title: 'Inactive team pattern detected',
      message: `${inactiveTeams} team${inactiveTeams > 1 ? 's show' : ' shows'} lineup inactivity risk.`,
      confidenceScore: 88,
      urgencySignal: inactiveTeams > 2 ? 84 : 68,
      roleScope: 'commissioner',
      repeatCooldownMinutes: 180,
    })
  }

  if (context.signalBundle?.suspiciousTradeSignal) {
    out.push({
      class: 'commissioner',
      type: 'suspicious_trade_signal',
      title: 'Suspicious trade signal',
      message: 'Trade activity requires commissioner review for fairness/integrity.',
      confidenceScore: 82,
      urgencySignal: 86,
      roleScope: 'commissioner',
      repeatCooldownMinutes: 120,
    })
  }

  return out
}

export function detectStoryEngagementAlerts(context: ChimmyAlertContext): ChimmyAlertCandidate[] {
  if (!context.signalBundle?.engagementStoryReady) return []

  return [
    {
      class: 'story_engagement',
      type: 'weekly_recap_ready',
      title: 'Weekly recap ready',
      message: 'A high-engagement league recap story is ready to review and post.',
      confidenceScore: 70,
      urgencySignal: 40,
      roleScope: context.role === 'member' ? 'member' : 'commissioner',
      repeatCooldownMinutes: 720,
    },
  ]
}

export function detectSpecialtyLeagueAlerts(context: ChimmyAlertContext): ChimmyAlertCandidate[] {
  const transition = context.signalBundle?.specialtyPhaseTransition
  if (!transition) return []

  return [
    {
      class: 'specialty',
      type: 'specialty_phase_transition',
      title: `${transition.mode} phase transition approaching`,
      message: `${transition.mode} is entering ${transition.phase}. Confirm rules/workflows before lock.`,
      confidenceScore: 90,
      urgencySignal: 78,
      urgencyDeadlineAt: transition.startsAt ?? null,
      roleScope: context.role === 'member' ? 'member' : 'commissioner',
      repeatCooldownMinutes: 240,
      metadata: { mode: transition.mode, phase: transition.phase },
    },
  ]
}

export function detectAdminIntegrityAlerts(context: ChimmyAlertContext): ChimmyAlertCandidate[] {
  if (context.role !== 'admin') return []

  if (!context.signalBundle?.suspiciousTradeSignal) return []

  return [
    {
      class: 'admin_integrity',
      type: 'integrity_cluster_warning',
      title: 'Integrity risk signal detected',
      message: 'A league integrity anomaly cluster requires admin review.',
      confidenceScore: 75,
      urgencySignal: 88,
      roleScope: 'admin',
      repeatCooldownMinutes: 180,
    },
  ]
}

export function detectAlertCandidates(context: ChimmyAlertContext): ChimmyAlertCandidate[] {
  return [
    // Injured-starter first: it is the highest-urgency class this engine produces, and
    // ordering makes the intent legible even though scoring, not order, decides ranking.
    ...detectInjuredStarterAlerts(context),
    ...detectLineupAlerts(context),
    ...detectWaiverAlerts(context),
    ...detectTradeAlerts(context),
    ...detectDraftAlerts(context),
    ...detectMatchupAlerts(context),
    ...detectTeamRosterAlerts(context),
    ...detectCommissionerAlerts(context),
    ...detectStoryEngagementAlerts(context),
    ...detectSpecialtyLeagueAlerts(context),
    ...detectAdminIntegrityAlerts(context),
  ]
}
