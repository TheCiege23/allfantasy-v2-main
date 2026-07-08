/**
 * Decision OS Manager Intelligence Platform — Phase 4.
 *
 * Pure, deterministic Transaction Readiness aggregator. Given a manager's active
 * roster players (+ current week + resolved roster-size config), it returns the
 * `ManagerTransactionReadinessV1` display contract. No I/O, no Prisma, no LLM, no
 * recommendations — the same roster always yields the same readiness picture.
 *
 * It REUSES the read-only Team Health aggregator for injured/questionable/bye
 * STARTER counts (no duplication of the injury vocabulary, Team Health contract
 * untouched) and classifies RESERVE slots (bench / IR / taxi) locally.
 *
 * All thresholds are documented constants and covered by tests.
 */

import { aggregateManagerTeamHealth } from '@/lib/decision-os/manager-intelligence/team-health/teamHealthAggregator'
import {
  MANAGER_TRANSACTION_READINESS_VERSION,
  type BenchFlexibility,
  type ManagerTransactionReadinessV1,
  type PressureLevel,
  type TransactionReadinessAggregationInput,
  type TransactionReadinessRosterPlayerInput,
} from './types'

// ── slot classification (case-insensitive; mirrors persisted RedraftRosterPlayer
// slot vocabulary — starters are position codes, everything below is a reserve).
const BENCH_SLOTS = new Set(['bench', 'bn', 'reserve'])
const IR_SLOTS = new Set(['ir'])
const TAXI_SLOTS = new Set(['taxi', 'devy'])
const NON_STARTER_SLOTS = new Set([...BENCH_SLOTS, ...IR_SLOTS, ...TAXI_SLOTS, 'free_agent', 'fa', 'cut'])

// ── thresholds (documented + tested) ─────────────────────────────────────────
const INJURY_HIGH = 3 // injured+questionable starters >= 3 → high
const INJURY_MODERATE = 1 // >= 1 → moderate
const BYE_HIGH = 3
const BYE_MODERATE = 1
const BENCH_FLEXIBLE_MIN = 6 // bench >= 6 (with low IR) → flexible
const BENCH_LIMITED_MIN = 3 // bench >= 3 → limited
const IR_LOW_MAX = 1 // "injuredReserveCount is low" means <= 1

function normalizeSlot(slotType: string | null | undefined): string {
  return String(slotType ?? '').trim().toLowerCase()
}
function isStarterSlot(slotType: string | null | undefined): boolean {
  const s = normalizeSlot(slotType)
  if (!s) return false
  return !NON_STARTER_SLOTS.has(s)
}
function isDropped(p: TransactionReadinessRosterPlayerInput): boolean {
  return p.droppedAt !== null && p.droppedAt !== undefined
}

function classifyInjuryPressure(injuredPlusQuestionable: number): PressureLevel {
  if (injuredPlusQuestionable >= INJURY_HIGH) return 'high'
  if (injuredPlusQuestionable >= INJURY_MODERATE) return 'moderate'
  return 'low'
}
function classifyByePressure(byeStarters: number): PressureLevel {
  if (byeStarters >= BYE_HIGH) return 'high'
  if (byeStarters >= BYE_MODERATE) return 'moderate'
  return 'low'
}
function classifyBenchFlexibility(benchCount: number, injuredReserveCount: number): BenchFlexibility {
  if (benchCount >= BENCH_FLEXIBLE_MIN && injuredReserveCount <= IR_LOW_MAX) return 'flexible'
  if (benchCount >= BENCH_LIMITED_MIN) return 'limited'
  return 'tight'
}
function classifyRosterPressure(injury: PressureLevel, bye: PressureLevel, flex: BenchFlexibility): PressureLevel {
  // high: a high injury/bye signal with no bench room to absorb it.
  if ((injury === 'high' || bye === 'high') && flex === 'tight') return 'high'
  // moderate: any real pressure signal present (elevated injury/bye, or a tight bench).
  if (injury === 'moderate' || injury === 'high' || bye === 'moderate' || bye === 'high' || flex === 'tight') return 'moderate'
  return 'low'
}

// ── summary + caveats (observational, no advice) ─────────────────────────────
function pressureWord(p: PressureLevel): string {
  return p === 'high' ? 'high' : p === 'moderate' ? 'moderate' : 'low'
}
function flexibilitySentence(flex: BenchFlexibility): string {
  if (flex === 'flexible') return 'Bench flexibility looks healthy.'
  if (flex === 'limited') return 'Bench flexibility appears limited.'
  return 'Bench flexibility is tight.'
}

/**
 * Aggregate a manager's roster into the display-only Transaction Readiness
 * contract. Returns `null` for zero active players (nothing to describe) so
 * consumers can render an honest empty state.
 */
export function aggregateTransactionReadiness(
  input: TransactionReadinessAggregationInput,
  now: Date = new Date(),
): ManagerTransactionReadinessV1 | null {
  const active = (input.players ?? []).filter((p) => !isDropped(p))
  if (active.length === 0) return null

  // Starter injury/bye signals via the reused (read-only) Team Health aggregator.
  // active.length > 0 → health is non-null here.
  const health = aggregateManagerTeamHealth({ players: active, currentWeek: input.currentWeek })
  const injuredStarters = health?.injuredStarterCount ?? 0
  const questionableStarters = health?.questionableStarterCount ?? 0
  const byeStarters = health?.byeWeekStarterCount ?? 0

  // Reserve-slot classification (local).
  let starterCount = 0
  let benchCount = 0
  let injuredReserveCount = 0
  let taxiCount = 0
  for (const p of active) {
    const s = normalizeSlot(p.slotType)
    if (isStarterSlot(p.slotType)) starterCount += 1
    else if (BENCH_SLOTS.has(s)) benchCount += 1
    else if (IR_SLOTS.has(s)) injuredReserveCount += 1
    else if (TAXI_SLOTS.has(s)) taxiCount += 1
  }
  const reserveCount = active.length - starterCount

  const injuryPressure = classifyInjuryPressure(injuredStarters + questionableStarters)
  const byePressure = classifyByePressure(byeStarters)
  const benchFlexibility = classifyBenchFlexibility(benchCount, injuredReserveCount)
  const rosterPressure = classifyRosterPressure(injuryPressure, byePressure, benchFlexibility)

  const rosterOpenings = input.rosterConfig ? Math.max(0, input.rosterConfig.maxRosterSize - active.length) : 0

  const caveats: string[] = []
  if (!input.rosterConfig) {
    caveats.push("Roster slot limits aren't available, so open slots can't be counted.")
  } else if (input.rosterConfig.source === 'defaults') {
    caveats.push('Open-slot counts use the format default roster size (no league-configured limit found).')
  }

  const summary = `Your roster has ${pressureWord(rosterPressure)} transaction pressure this week. ${flexibilitySentence(benchFlexibility)}`

  return {
    version: MANAGER_TRANSACTION_READINESS_VERSION,
    derivedAt: now.toISOString(),
    rosterPressure,
    benchFlexibility,
    injuryPressure,
    byePressure,
    rosterOpenings,
    reserveCount,
    injuredReserveCount,
    benchCount,
    summary,
    caveats,
  }
}
