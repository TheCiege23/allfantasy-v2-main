/**
 * Decision OS — Phase 6.1 Behavioral Patterns detector.
 *
 * Deterministic sequence detection on Phase 5.1 BehavioralEvent[].
 * Pure: no DB, no IO, no AI, no side effects.
 * Does NOT mutate input. Does NOT duplicate Phase 6.3 signal aggregation
 * or Phase 6.5 platform benchmarking.
 */

import type { BehavioralEvent, BehavioralEventOf } from '../../behavioral/events/types'
import type {
  BehavioralPatternInput,
  BehavioralPatternResult,
  BehavioralPatternLabel,
  DetectedPattern,
  EvidenceWindow,
  ManagerPatternGroup,
  PatternConfidence,
} from './types'

// ── Versioning ────────────────────────────────────────────────────────────────

export const PATTERN_VERSION = '6.1.0'

// ── Thresholds ────────────────────────────────────────────────────────────────

const MIN_EVENTS = 3

// Lineup indecision
const INDECISION_MIN_SAVES = 3

// Waiver aggression
const WAIVER_WINDOW_DAYS = 21
const WAIVER_MIN_CLAIMS = 5

// Trade spike
const TRADE_WINDOW_DAYS = 14
const TRADE_MIN_COUNT = 4

// Inactivity
const INACTIVITY_LOW_DAYS = 30
const INACTIVITY_MED_DAYS = 45
const INACTIVITY_HIGH_DAYS = 60

// Bench regret
const BENCH_REGRET_MIN_FLIPS = 3

// Injury delay
const INJURY_DELAY_DAYS = 7
const INJURY_DELAY_MIN_OCC = 2

// Overreaction
const OVERREACTION_MIN_SLOT_CHANGES = 4
const OVERREACTION_MIN_WEEKS = 3

// Conservative
const CONSERVATIVE_MIN_WEEKS = 4

// Trade rejection
const REJECTION_WINDOW_DAYS = 30
const REJECTION_MIN = 3

// Surge / dropoff
const SURGE_WINDOW_DAYS = 7
const SURGE_BASELINE_DAYS = 28
const SURGE_MIN_MULTIPLIER = 2.0
const DROPOFF_WINDOW_DAYS = 14
const DROPOFF_BASELINE_DAYS = 28
const DROPOFF_MAX_RATIO = 0.4

// Rules churn
const RULES_CHURN_WINDOW_DAYS = 21
const RULES_CHURN_MIN = 3

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysDiff(earlier: string, later: string): number {
  return (new Date(later).getTime() - new Date(earlier).getTime()) / 86400000
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 86400000
}

function toConfidence(value: number, low: number, med: number, high: number): PatternConfidence {
  if (value >= high) return 'high'
  if (value >= med) return 'medium'
  return 'low'
}

function evidenceFromEvents(events: BehavioralEvent[], summary: string): EvidenceWindow {
  const sorted = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  const start = sorted[0].occurredAt
  const end = sorted[sorted.length - 1].occurredAt
  return {
    startedAt: start,
    endedAt: end,
    durationDays: Math.round(daysBetween(start, end)),
    eventIds: sorted.map((e) => e.eventId),
    summary,
  }
}

function evidenceFromRange(startedAt: string, endedAt: string, summary: string): EvidenceWindow {
  return {
    startedAt,
    endedAt,
    durationDays: Math.round(daysBetween(startedAt, endedAt)),
    eventIds: [],
    summary,
  }
}

/**
 * Detect rolling windows where the count of matching events meets `minCount`.
 * Uses a greedy non-overlapping approach: once a qualifying window is found,
 * skip past it before looking for the next.
 */
function detectRollingWindows(
  events: BehavioralEvent[],
  windowDays: number,
  minCount: number,
  buildSummary: (count: number) => string,
): EvidenceWindow[] {
  const sorted = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  const windows: EvidenceWindow[] = []
  let skipUntilIdx = 0

  for (let i = skipUntilIdx; i <= sorted.length - minCount; i++) {
    if (i < skipUntilIdx) continue
    const anchor = sorted[i]
    const window: BehavioralEvent[] = [anchor]
    for (let j = i + 1; j < sorted.length; j++) {
      if (daysDiff(anchor.occurredAt, sorted[j].occurredAt) <= windowDays) {
        window.push(sorted[j])
      }
    }
    if (window.length >= minCount) {
      windows.push(evidenceFromEvents(window, buildSummary(window.length)))
      skipUntilIdx = i + window.length
    }
  }

  return windows
}

// ── Manager pattern detectors ─────────────────────────────────────────────────

function detectRepeatedLineupIndecision(events: BehavioralEvent[]): DetectedPattern | null {
  const saves = events.filter(
    (e): e is BehavioralEventOf<'lineup_saved'> => e.eventType === 'lineup_saved',
  )

  const byWeek = new Map<number, BehavioralEventOf<'lineup_saved'>[]>()
  for (const s of saves) {
    const w = s.metadata.week
    if (w === null) continue
    const arr = byWeek.get(w) ?? []
    arr.push(s)
    byWeek.set(w, arr)
  }

  const windows: EvidenceWindow[] = []
  for (const [week, weekSaves] of byWeek.entries()) {
    if (weekSaves.length >= INDECISION_MIN_SAVES) {
      windows.push(evidenceFromEvents(
        weekSaves,
        `${weekSaves.length} lineup saves in week ${week}`,
      ))
    }
  }
  if (windows.length === 0) return null

  windows.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  return {
    patternType: 'repeated_lineup_indecision',
    confidence: toConfidence(windows.length, 1, 2, 3),
    occurrenceCount: windows.length,
    firstDetectedAt: windows[0].startedAt,
    lastDetectedAt: windows[windows.length - 1].endedAt,
    evidenceWindows: windows,
    derivation: [
      `Found ${windows.length} week(s) with ${INDECISION_MIN_SAVES}+ lineup saves`,
      `Threshold: ${INDECISION_MIN_SAVES} saves per week = pattern`,
      `Confidence: low=1, medium=2, high=3 qualifying weeks`,
    ],
    warnings: [],
  }
}

function detectWaiverAggressionStreak(events: BehavioralEvent[]): DetectedPattern | null {
  const claims = events.filter((e) => e.eventType === 'waiver_claim_created')
  if (claims.length < WAIVER_MIN_CLAIMS) return null

  const windows = detectRollingWindows(
    claims,
    WAIVER_WINDOW_DAYS,
    WAIVER_MIN_CLAIMS,
    (n) => `${n} waiver claims in ${WAIVER_WINDOW_DAYS} days`,
  )
  if (windows.length === 0) return null

  const max = Math.max(...windows.map((w) => w.eventIds.length))
  return {
    patternType: 'waiver_aggression_streak',
    confidence: toConfidence(windows.length, 1, 2, 3),
    occurrenceCount: windows.length,
    firstDetectedAt: windows[0].startedAt,
    lastDetectedAt: windows[windows.length - 1].endedAt,
    evidenceWindows: windows,
    derivation: [
      `Found ${windows.length} window(s) with ${WAIVER_MIN_CLAIMS}+ waiver claims in ${WAIVER_WINDOW_DAYS} days`,
      `Peak: ${max} claims in a single window`,
      `Confidence: low=1, medium=2, high=3 qualifying windows`,
    ],
    warnings: [],
  }
}

function detectTradeProposalSpike(events: BehavioralEvent[]): DetectedPattern | null {
  const trades = events.filter((e) => e.eventType === 'trade_created')
  if (trades.length < TRADE_MIN_COUNT) return null

  const windows = detectRollingWindows(
    trades,
    TRADE_WINDOW_DAYS,
    TRADE_MIN_COUNT,
    (n) => `${n} trade proposals in ${TRADE_WINDOW_DAYS} days`,
  )
  if (windows.length === 0) return null

  const max = Math.max(...windows.map((w) => w.eventIds.length))
  return {
    patternType: 'trade_proposal_spike',
    confidence: toConfidence(windows.length, 1, 2, 3),
    occurrenceCount: windows.length,
    firstDetectedAt: windows[0].startedAt,
    lastDetectedAt: windows[windows.length - 1].endedAt,
    evidenceWindows: windows,
    derivation: [
      `Found ${windows.length} window(s) with ${TRADE_MIN_COUNT}+ trade proposals in ${TRADE_WINDOW_DAYS} days`,
      `Peak: ${max} proposals in a single window`,
      `Confidence: low=1, medium=2, high=3 qualifying windows`,
    ],
    warnings: [],
  }
}

function detectManagerInactivity(
  managerEvents: BehavioralEvent[],
  allEvents: BehavioralEvent[],
): DetectedPattern | null {
  if (managerEvents.length === 0) return null
  const managerId = managerEvents[0].managerId

  const managerSorted = [...managerEvents].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  const allSorted = [...allEvents].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  if (allSorted.length === 0) return null

  const leagueStart = allSorted[0].occurredAt
  const leagueEnd = allSorted[allSorted.length - 1].occurredAt

  // Build gap checkpoints: [leagueStart, ...managerEventTimes, leagueEnd]
  const checkpoints = [
    leagueStart,
    ...managerSorted.map((e) => e.occurredAt),
    leagueEnd,
  ]

  let longestGapDays = 0
  let gapStart = leagueStart
  let gapEnd = leagueEnd

  for (let i = 0; i < checkpoints.length - 1; i++) {
    const gap = daysDiff(checkpoints[i], checkpoints[i + 1])
    if (gap > longestGapDays) {
      longestGapDays = gap
      gapStart = checkpoints[i]
      gapEnd = checkpoints[i + 1]
    }
  }

  if (longestGapDays < INACTIVITY_LOW_DAYS) return null

  // Confirm league was active during this gap
  const leagueActiveInGap = allSorted.some(
    (e) => e.managerId !== managerId && e.occurredAt > gapStart && e.occurredAt < gapEnd,
  )
  if (!leagueActiveInGap) return null

  return {
    patternType: 'manager_inactivity_window',
    confidence:
      longestGapDays >= INACTIVITY_HIGH_DAYS
        ? 'high'
        : longestGapDays >= INACTIVITY_MED_DAYS
        ? 'medium'
        : 'low',
    occurrenceCount: 1,
    firstDetectedAt: gapStart,
    lastDetectedAt: gapEnd,
    evidenceWindows: [
      evidenceFromRange(
        gapStart,
        gapEnd,
        `${Math.round(longestGapDays)} days with no manager activity while league was active`,
      ),
    ],
    derivation: [
      `Longest inactivity gap: ${Math.round(longestGapDays)} days`,
      `League was active during this period (other events confirmed in gap)`,
      `Confidence: low=${INACTIVITY_LOW_DAYS}d, medium=${INACTIVITY_MED_DAYS}d, high=${INACTIVITY_HIGH_DAYS}d`,
    ],
    warnings: [],
  }
}

function detectBenchRegretRepetition(events: BehavioralEvent[]): DetectedPattern | null {
  const saves = events
    .filter((e): e is BehavioralEventOf<'lineup_saved'> => e.eventType === 'lineup_saved')
    .sort((a, b) => {
      const wDiff = (a.metadata.week ?? 0) - (b.metadata.week ?? 0)
      return wDiff !== 0 ? wDiff : a.occurredAt.localeCompare(b.occurredAt)
    })

  if (saves.length < 2) return null

  // Per-player: track assignment (starter/bench) per week, last save per week wins
  const playerAssignments = new Map<string, Map<number, { benched: boolean; eventId: string }>>()
  for (const s of saves) {
    const week = s.metadata.week
    if (week === null) continue
    const assign = (playerId: string, benched: boolean) => {
      if (!playerAssignments.has(playerId)) playerAssignments.set(playerId, new Map())
      playerAssignments.get(playerId)!.set(week, { benched, eventId: s.eventId })
    }
    for (const pid of s.metadata.startedPlayerIds) assign(pid, false)
    for (const pid of s.metadata.benchedPlayerIds) assign(pid, true)
  }

  let maxFlips = 0
  const windows: EvidenceWindow[] = []

  for (const [playerId, weekMap] of playerAssignments.entries()) {
    const sortedWeeks = [...weekMap.keys()].sort((a, b) => a - b)
    let flips = 0
    const flipEventIds: string[] = []

    for (let i = 1; i < sortedWeeks.length; i++) {
      const prev = weekMap.get(sortedWeeks[i - 1])!
      const curr = weekMap.get(sortedWeeks[i])!
      if (prev.benched !== curr.benched) {
        flips++
        flipEventIds.push(prev.eventId, curr.eventId)
      }
    }

    if (flips >= BENCH_REGRET_MIN_FLIPS) {
      maxFlips = Math.max(maxFlips, flips)
      const uniqueIds = [...new Set(flipEventIds)]
      const involvedSaves = uniqueIds
        .map((id) => saves.find((s) => s.eventId === id))
        .filter(Boolean) as BehavioralEventOf<'lineup_saved'>[]
      if (involvedSaves.length > 0) {
        windows.push(evidenceFromEvents(
          involvedSaves,
          `Player ${playerId.slice(0, 8)}… flipped bench/starter ${flips} times`,
        ))
      }
    }
  }

  if (windows.length === 0) return null

  windows.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  return {
    patternType: 'bench_regret_repetition',
    confidence: toConfidence(maxFlips, BENCH_REGRET_MIN_FLIPS, 5, 7),
    occurrenceCount: windows.length,
    firstDetectedAt: windows[0].startedAt,
    lastDetectedAt: windows[windows.length - 1].endedAt,
    evidenceWindows: windows,
    derivation: [
      `Found ${windows.length} player(s) with ${BENCH_REGRET_MIN_FLIPS}+ bench/starter flip-flops`,
      `Max flips for any player: ${maxFlips}`,
      `Confidence: low=${BENCH_REGRET_MIN_FLIPS}, medium=5, high=7 flips`,
    ],
    warnings: [],
  }
}

function detectInjuryResponseDelay(events: BehavioralEvent[]): DetectedPattern | null {
  const saves = events
    .filter((e): e is BehavioralEventOf<'lineup_saved'> =>
      e.eventType === 'lineup_saved' && e.metadata.benchedPlayerIds.length > 0,
    )
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))

  const waiverClaims = events
    .filter((e) => e.eventType === 'waiver_claim_created')
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))

  if (saves.length < 2) return null

  const occurrences: EvidenceWindow[] = []

  for (let i = 0; i < saves.length - 1; i++) {
    const thisSave = saves[i]
    const nextSave = saves.find(
      (s) =>
        s.occurredAt > thisSave.occurredAt &&
        (s.metadata.week ?? 0) > (thisSave.metadata.week ?? 0),
    )
    if (!nextSave) continue

    // Check: no waiver claim in the 7 days following this save
    const hasQuickWaiver = waiverClaims.some(
      (c) =>
        c.occurredAt > thisSave.occurredAt &&
        daysDiff(thisSave.occurredAt, c.occurredAt) <= INJURY_DELAY_DAYS,
    )
    if (hasQuickWaiver) continue

    // Check: same benched player persists in the next save
    const persistsBenched = thisSave.metadata.benchedPlayerIds.some((pid) =>
      nextSave.metadata.benchedPlayerIds.includes(pid),
    )
    if (!persistsBenched) continue

    occurrences.push(evidenceFromEvents(
      [thisSave, nextSave],
      `Player benched in week ${thisSave.metadata.week ?? '?'}, no waiver response, stays benched in week ${nextSave.metadata.week ?? '?'}`,
    ))
  }

  if (occurrences.length < INJURY_DELAY_MIN_OCC) return null

  return {
    patternType: 'injury_response_delay',
    confidence: toConfidence(occurrences.length, INJURY_DELAY_MIN_OCC, 3, 4),
    occurrenceCount: occurrences.length,
    firstDetectedAt: occurrences[0].startedAt,
    lastDetectedAt: occurrences[occurrences.length - 1].endedAt,
    evidenceWindows: occurrences,
    derivation: [
      `Found ${occurrences.length} instance(s) where player stayed benched for ${INJURY_DELAY_DAYS}+ days without waiver response`,
      `Confidence: low=${INJURY_DELAY_MIN_OCC}, medium=3, high=4 occurrences`,
    ],
    warnings: ['proxy_detection: injury data not available from event stream alone'],
  }
}

function detectConsecutiveWeekPattern(
  events: BehavioralEvent[],
  patternType: BehavioralPatternLabel,
  predicate: (slotChanges: number) => boolean,
  minWeeks: number,
  buildSummary: (len: number) => string,
  derivation: (maxLen: number) => string[],
  confidenceThresholds: [number, number, number],
): DetectedPattern | null {
  const saves = events
    .filter((e): e is BehavioralEventOf<'lineup_saved'> => e.eventType === 'lineup_saved')
    .sort((a, b) => (a.metadata.week ?? 0) - (b.metadata.week ?? 0))

  // Last save per week (final decision)
  const lastByWeek = new Map<number, BehavioralEventOf<'lineup_saved'>>()
  for (const s of saves) {
    if (s.metadata.week === null) continue
    lastByWeek.set(s.metadata.week, s)
  }

  const weekSaves = [...lastByWeek.entries()]
    .sort(([a], [b]) => a - b)
    .map(([week, save]) => ({ week, save }))

  if (weekSaves.length < minWeeks) return null

  const streaks: EvidenceWindow[] = []
  let streakStart = -1

  for (let i = 0; i <= weekSaves.length; i++) {
    const item = weekSaves[i]
    const meetsPredicate = item !== undefined && predicate(item.save.metadata.slotChanges)
    const isConsecutive =
      streakStart < 0 ||
      (item !== undefined && item.week === weekSaves[i - 1].week + 1)

    const continuesStreak = meetsPredicate && isConsecutive

    if (continuesStreak) {
      if (streakStart < 0) streakStart = i
    } else {
      if (streakStart >= 0) {
        const len = i - streakStart
        if (len >= minWeeks) {
          const streakEvents = weekSaves.slice(streakStart, i).map((w) => w.save)
          streaks.push(evidenceFromEvents(streakEvents, buildSummary(len)))
        }
        streakStart = -1
      }
    }
  }

  if (streaks.length === 0) return null

  const maxLen = Math.max(...streaks.map((w) => w.eventIds.length))
  return {
    patternType,
    confidence: toConfidence(maxLen, ...confidenceThresholds),
    occurrenceCount: streaks.length,
    firstDetectedAt: streaks[0].startedAt,
    lastDetectedAt: streaks[streaks.length - 1].endedAt,
    evidenceWindows: streaks,
    derivation: derivation(maxLen),
    warnings: [],
  }
}

function detectMatchupOverreaction(events: BehavioralEvent[]): DetectedPattern | null {
  return detectConsecutiveWeekPattern(
    events,
    'matchup_overreaction',
    (slotChanges) => slotChanges >= OVERREACTION_MIN_SLOT_CHANGES,
    OVERREACTION_MIN_WEEKS,
    (len) => `${len} consecutive weeks with ${OVERREACTION_MIN_SLOT_CHANGES}+ lineup slot changes`,
    (maxLen) => [
      `Found streak(s) of consecutive weeks with ${OVERREACTION_MIN_SLOT_CHANGES}+ slot changes`,
      `Max streak: ${maxLen} weeks`,
      `Confidence: low=${OVERREACTION_MIN_WEEKS}, medium=${OVERREACTION_MIN_WEEKS + 2}, high=${OVERREACTION_MIN_WEEKS + 4} weeks`,
    ],
    [OVERREACTION_MIN_WEEKS, OVERREACTION_MIN_WEEKS + 2, OVERREACTION_MIN_WEEKS + 4],
  )
}

function detectConservativeRosterPattern(events: BehavioralEvent[]): DetectedPattern | null {
  return detectConsecutiveWeekPattern(
    events,
    'conservative_roster_pattern',
    (slotChanges) => slotChanges === 0,
    CONSERVATIVE_MIN_WEEKS,
    (len) => `${len} consecutive weeks with no lineup slot changes`,
    (maxLen) => [
      `Found streak(s) of consecutive weeks with zero lineup slot changes`,
      `Max streak: ${maxLen} weeks`,
      `Confidence: low=${CONSERVATIVE_MIN_WEEKS}, medium=6, high=8 weeks`,
    ],
    [CONSERVATIVE_MIN_WEEKS, 6, 8],
  )
}

function detectTradeRejectionPattern(
  managerEvents: BehavioralEvent[],
  allEvents: BehavioralEvent[],
): DetectedPattern | null {
  const myTrades = managerEvents.filter(
    (e): e is BehavioralEventOf<'trade_created'> => e.eventType === 'trade_created',
  )
  if (myTrades.length < REJECTION_MIN) return null

  const myProposalIds = new Set(myTrades.map((t) => t.metadata.proposalId))

  const myRejections = allEvents.filter(
    (e): e is BehavioralEventOf<'trade_rejected'> =>
      e.eventType === 'trade_rejected' && myProposalIds.has(e.metadata.proposalId),
  )
  if (myRejections.length < REJECTION_MIN) return null

  const windows = detectRollingWindows(
    myRejections,
    REJECTION_WINDOW_DAYS,
    REJECTION_MIN,
    (n) => `${n} trade rejections in ${REJECTION_WINDOW_DAYS} days`,
  )
  if (windows.length === 0) return null

  return {
    patternType: 'trade_rejection_pattern',
    confidence: toConfidence(windows.length, 1, 2, 3),
    occurrenceCount: windows.length,
    firstDetectedAt: windows[0].startedAt,
    lastDetectedAt: windows[windows.length - 1].endedAt,
    evidenceWindows: windows,
    derivation: [
      `${myRejections.length} of this manager's trade proposals were rejected`,
      `Found ${windows.length} window(s) with ${REJECTION_MIN}+ rejections in ${REJECTION_WINDOW_DAYS} days`,
      `Confidence: low=1, medium=2, high=3 qualifying windows`,
    ],
    warnings: [],
  }
}

// ── League pattern detectors ───────────────────────────────────────────────────

function detectLeagueActivitySurge(events: BehavioralEvent[]): DetectedPattern | null {
  if (events.length < MIN_EVENTS) return null
  const sorted = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))

  const epochMs = new Date(sorted[0].occurredAt).getTime()
  const endMs = new Date(sorted[sorted.length - 1].occurredAt).getTime()
  const totalDays = (endMs - epochMs) / 86400000
  if (totalDays < SURGE_BASELINE_DAYS) return null

  const windows: EvidenceWindow[] = []
  let stepMs = epochMs + SURGE_BASELINE_DAYS * 86400000

  while (stepMs <= endMs) {
    const windowStartISO = new Date(stepMs).toISOString()
    const windowEndISO = new Date(stepMs + SURGE_WINDOW_DAYS * 86400000).toISOString()
    const baselineStartISO = new Date(stepMs - SURGE_BASELINE_DAYS * 86400000).toISOString()

    const windowEvents = sorted.filter(
      (e) => e.occurredAt >= windowStartISO && e.occurredAt < windowEndISO,
    )
    const baselineEvents = sorted.filter(
      (e) => e.occurredAt >= baselineStartISO && e.occurredAt < windowStartISO,
    )

    if (baselineEvents.length > 0) {
      const baselinePer7 = (baselineEvents.length / SURGE_BASELINE_DAYS) * SURGE_WINDOW_DAYS
      const ratio = windowEvents.length / baselinePer7
      if (ratio >= SURGE_MIN_MULTIPLIER && windowEvents.length > 0) {
        windows.push(evidenceFromEvents(
          windowEvents,
          `${windowEvents.length} events in ${SURGE_WINDOW_DAYS} days (${ratio.toFixed(1)}× baseline of ${baselinePer7.toFixed(1)})`,
        ))
      }
    }

    stepMs += SURGE_WINDOW_DAYS * 86400000
  }

  if (windows.length === 0) return null

  return {
    patternType: 'league_activity_surge',
    confidence: toConfidence(windows.length, 1, 2, 3),
    occurrenceCount: windows.length,
    firstDetectedAt: windows[0].startedAt,
    lastDetectedAt: windows[windows.length - 1].endedAt,
    evidenceWindows: windows,
    derivation: [
      `Found ${windows.length} window(s) where event count exceeded ${SURGE_MIN_MULTIPLIER}× the prior ${SURGE_BASELINE_DAYS}-day baseline`,
      `Window size: ${SURGE_WINDOW_DAYS} days, step: ${SURGE_WINDOW_DAYS} days (non-overlapping)`,
      `Confidence: low=1, medium=2, high=3 surge windows`,
    ],
    warnings: [],
  }
}

function detectLeagueActivityDropoff(events: BehavioralEvent[]): DetectedPattern | null {
  if (events.length < MIN_EVENTS) return null
  const sorted = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))

  const epochMs = new Date(sorted[0].occurredAt).getTime()
  const endMs = new Date(sorted[sorted.length - 1].occurredAt).getTime()
  const totalDays = (endMs - epochMs) / 86400000
  if (totalDays < DROPOFF_BASELINE_DAYS) return null

  const windows: EvidenceWindow[] = []
  let stepMs = epochMs + DROPOFF_BASELINE_DAYS * 86400000

  while (stepMs <= endMs) {
    const windowStartISO = new Date(stepMs).toISOString()
    const windowEndISO = new Date(stepMs + DROPOFF_WINDOW_DAYS * 86400000).toISOString()
    const baselineStartISO = new Date(stepMs - DROPOFF_BASELINE_DAYS * 86400000).toISOString()

    const windowEvents = sorted.filter(
      (e) => e.occurredAt >= windowStartISO && e.occurredAt < windowEndISO,
    )
    const baselineEvents = sorted.filter(
      (e) => e.occurredAt >= baselineStartISO && e.occurredAt < windowStartISO,
    )

    if (baselineEvents.length > 0) {
      const baselinePer14 = (baselineEvents.length / DROPOFF_BASELINE_DAYS) * DROPOFF_WINDOW_DAYS
      if (baselinePer14 > 0) {
        const ratio = windowEvents.length / baselinePer14
        if (ratio < DROPOFF_MAX_RATIO) {
          windows.push(
            windowEvents.length > 0
              ? evidenceFromEvents(
                  windowEvents,
                  `${windowEvents.length} events in ${DROPOFF_WINDOW_DAYS} days (${(ratio * 100).toFixed(0)}% of baseline ${baselinePer14.toFixed(1)})`,
                )
              : evidenceFromRange(
                  windowStartISO,
                  windowEndISO,
                  `0 events in ${DROPOFF_WINDOW_DAYS} days (0% of baseline ${baselinePer14.toFixed(1)})`,
                ),
          )
        }
      }
    }

    stepMs += DROPOFF_WINDOW_DAYS * 86400000
  }

  if (windows.length === 0) return null

  return {
    patternType: 'league_activity_dropoff',
    confidence: toConfidence(windows.length, 1, 2, 3),
    occurrenceCount: windows.length,
    firstDetectedAt: windows[0].startedAt,
    lastDetectedAt: windows[windows.length - 1].endedAt,
    evidenceWindows: windows,
    derivation: [
      `Found ${windows.length} window(s) where event count fell below ${DROPOFF_MAX_RATIO * 100}% of prior ${DROPOFF_BASELINE_DAYS}-day baseline`,
      `Window size: ${DROPOFF_WINDOW_DAYS} days, step: ${DROPOFF_WINDOW_DAYS} days (non-overlapping)`,
      `Confidence: low=1, medium=2, high=3 dropoff windows`,
    ],
    warnings: [],
  }
}

function detectCommissionerRulesChurn(events: BehavioralEvent[]): DetectedPattern | null {
  const rulesChanges = events.filter((e) => e.eventType === 'rules_changed')
  if (rulesChanges.length < RULES_CHURN_MIN) return null

  const windows = detectRollingWindows(
    rulesChanges,
    RULES_CHURN_WINDOW_DAYS,
    RULES_CHURN_MIN,
    (n) => `${n} rule changes in ${RULES_CHURN_WINDOW_DAYS} days`,
  )
  if (windows.length === 0) return null

  const max = Math.max(...windows.map((w) => w.eventIds.length))
  return {
    patternType: 'commissioner_rules_churn',
    confidence: toConfidence(max, RULES_CHURN_MIN, 5, 7),
    occurrenceCount: windows.length,
    firstDetectedAt: windows[0].startedAt,
    lastDetectedAt: windows[windows.length - 1].endedAt,
    evidenceWindows: windows,
    derivation: [
      `Found ${windows.length} window(s) with ${RULES_CHURN_MIN}+ rule changes in ${RULES_CHURN_WINDOW_DAYS} days`,
      `Peak: ${max} changes in a single window`,
      `Confidence: low=${RULES_CHURN_MIN}, medium=5, high=7 changes per window`,
    ],
    warnings: [],
  }
}

// ── Main assembler ────────────────────────────────────────────────────────────

/**
 * Detect behavioral patterns in a league's event stream.
 *
 * Pure: no IO, no DB, no AI calls.
 * Deterministic: same inputs → same output.
 * Does NOT mutate the input `events` array.
 */
export function detectBehavioralPatterns(
  input: BehavioralPatternInput,
): BehavioralPatternResult {
  const { leagueId } = input
  const analysisWindowDays = input.analysisWindowDays ?? 90
  const warnings: string[] = []

  // Defensive copy — never mutate input
  const sorted = [...input.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))

  if (sorted.length < MIN_EVENTS) {
    warnings.push(
      `insufficient_events: ${sorted.length} provided, ${MIN_EVENTS} required for analysis`,
    )
  }

  const unknownTimestamps = sorted.filter(
    (e) => e.uncertainty.timestampConfidence === 'unknown',
  ).length
  if (unknownTimestamps > 0) {
    warnings.push(
      `${unknownTimestamps} event(s) have unknown timestamp confidence — temporal patterns may be unreliable`,
    )
  }

  const earliestEventAt = sorted.length > 0 ? sorted[0].occurredAt : null
  const latestEventAt = sorted.length > 0 ? sorted[sorted.length - 1].occurredAt : null

  // Group by managerId (null = system events, excluded from manager analysis)
  const byManager = new Map<string, BehavioralEvent[]>()
  for (const e of sorted) {
    if (e.managerId === null) continue
    const arr = byManager.get(e.managerId) ?? []
    arr.push(e)
    byManager.set(e.managerId, arr)
  }

  // Detect manager-level patterns
  const managerPatterns: ManagerPatternGroup[] = []
  for (const [managerId, managerEvents] of byManager.entries()) {
    const patterns: DetectedPattern[] = []

    const p = detectRepeatedLineupIndecision(managerEvents)
    if (p) patterns.push(p)

    const p2 = detectWaiverAggressionStreak(managerEvents)
    if (p2) patterns.push(p2)

    const p3 = detectTradeProposalSpike(managerEvents)
    if (p3) patterns.push(p3)

    const p4 = detectManagerInactivity(managerEvents, sorted)
    if (p4) patterns.push(p4)

    const p5 = detectBenchRegretRepetition(managerEvents)
    if (p5) patterns.push(p5)

    const p6 = detectInjuryResponseDelay(managerEvents)
    if (p6) patterns.push(p6)

    const p7 = detectMatchupOverreaction(managerEvents)
    if (p7) patterns.push(p7)

    const p8 = detectConservativeRosterPattern(managerEvents)
    if (p8) patterns.push(p8)

    const p9 = detectTradeRejectionPattern(managerEvents, sorted)
    if (p9) patterns.push(p9)

    if (patterns.length > 0) {
      managerPatterns.push({ managerId, patterns })
    }
  }

  // Detect league-level patterns
  const leaguePatterns: DetectedPattern[] = []

  const lp1 = detectLeagueActivitySurge(sorted)
  if (lp1) leaguePatterns.push(lp1)

  const lp2 = detectLeagueActivityDropoff(sorted)
  if (lp2) leaguePatterns.push(lp2)

  const lp3 = detectCommissionerRulesChurn(sorted)
  if (lp3) leaguePatterns.push(lp3)

  return {
    leagueId,
    managerPatterns,
    leaguePatterns,
    totalEventsAnalyzed: sorted.length,
    analysisWindowDays,
    earliestEventAt,
    latestEventAt,
    warnings,
    version: PATTERN_VERSION,
  }
}
