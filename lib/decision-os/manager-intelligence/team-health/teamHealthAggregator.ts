/**
 * Decision OS Manager Intelligence Platform — Phase 2.
 *
 * Pure, deterministic Team Health aggregator. Given a manager's active roster
 * players (+ the current week), it returns the `ManagerTeamHealthV1` display
 * contract. No I/O, no Prisma, no LLM, no recommendations — every output is a
 * deterministic function of the inputs, so the same roster always yields the
 * same summary.
 *
 * All string matching (slot type, injury status) is case-insensitive and
 * convention-tolerant because the persisted values are written in mixed case by
 * different subsystems (e.g. 'BENCH' vs 'bench', 'Out' vs 'out' vs 'IR').
 */

import {
  MANAGER_TEAM_HEALTH_VERSION,
  type BenchAvailability,
  type ManagerTeamHealthV1,
  type RosterCompleteness,
  type TeamHealthAggregationInput,
  type TeamHealthRosterPlayerInput,
} from './types'

// ── slot classification ─────────────────────────────────────────────────────
// A starter's slotType is a POSITION code (QB/RB/WR/…) or the literal 'starter'
// (see lib/redraft/finalizeDraftToRedraftSeason.ts). Everything below is a
// reserve and never counts as a starter. Bench-eligible = promotable into the
// lineup this week (IR/taxi/devy are stashes and are NOT bench-eligible).
const RESERVE_SLOTS = new Set(['bench', 'bn', 'reserve', 'ir', 'taxi', 'devy', 'free_agent', 'fa', 'cut'])
const BENCH_ELIGIBLE_SLOTS = new Set(['bench', 'bn', 'reserve'])

function normalizeSlot(slotType: string | null | undefined): string {
  return String(slotType ?? '').trim().toLowerCase()
}

function isStarterSlot(slotType: string | null | undefined): boolean {
  const s = normalizeSlot(slotType)
  if (!s) return false // unslotted → treat as non-starter (conservative)
  return !RESERVE_SLOTS.has(s)
}

function isBenchEligibleSlot(slotType: string | null | undefined): boolean {
  return BENCH_ELIGIBLE_SLOTS.has(normalizeSlot(slotType))
}

// ── injury classification ───────────────────────────────────────────────────
// Convention-tolerant: matches the recurring codebase pattern /out|doubt|quest|
// ir|pup/i. Unrecognized/empty/"healthy"/"active" → healthy (never over-flag).
type InjuryBucket = 'out' | 'questionable' | 'healthy'

const OUT_PATTERN = /\b(out|ir|pup|nfi|susp|suspended|inactive|dnp)\b/
const QUESTIONABLE_PATTERN = /\b(questionable|doubtful|gtd|dtd|day.?to.?day|limited)\b/

function classifyInjury(injuryStatus: string | null | undefined): InjuryBucket {
  const s = String(injuryStatus ?? '').trim().toLowerCase()
  if (!s || s === 'healthy' || s === 'active' || s === 'probable') return 'healthy'
  if (OUT_PATTERN.test(s)) return 'out'
  if (QUESTIONABLE_PATTERN.test(s)) return 'questionable'
  return 'healthy'
}

function isOnByeThisWeek(byeWeek: number | null | undefined, currentWeek: number | null | undefined): boolean {
  return typeof byeWeek === 'number' && typeof currentWeek === 'number' && currentWeek > 0 && byeWeek === currentWeek
}

// ── bench availability + roster completeness (deterministic tiers) ───────────
function classifyBenchAvailability(healthyBenchCount: number): BenchAvailability {
  if (healthyBenchCount >= 3) return 'healthy'
  if (healthyBenchCount >= 1) return 'thin'
  return 'critical'
}

function classifyRosterCompleteness(unavailableStarterCount: number, healthyBenchCount: number): RosterCompleteness {
  // "excellent": every starter can play AND there is real depth behind them.
  if (unavailableStarterCount === 0) return healthyBenchCount >= 1 ? 'excellent' : 'good'
  // Holes exist: "good" if the bench can cover them, otherwise "needs_attention".
  return unavailableStarterCount <= healthyBenchCount ? 'good' : 'needs_attention'
}

// ── summary (observational, no advice) ──────────────────────────────────────
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
function areIs(n: number): string {
  return n === 1 ? 'is' : 'are'
}

function buildSummary(c: {
  injuredStarterCount: number
  questionableStarterCount: number
  byeWeekStarterCount: number
  benchAvailability: BenchAvailability
}): string {
  const issues: string[] = []
  if (c.injuredStarterCount > 0) {
    issues.push(`${plural(c.injuredStarterCount, 'projected starter')} ${areIs(c.injuredStarterCount)} currently unavailable`)
  }
  if (c.questionableStarterCount > 0) {
    issues.push(`${plural(c.questionableStarterCount, 'starter')} ${areIs(c.questionableStarterCount)} questionable`)
  }
  if (c.byeWeekStarterCount > 0) {
    issues.push(`${plural(c.byeWeekStarterCount, 'starter')} ${areIs(c.byeWeekStarterCount)} on a bye this week`)
  }

  const lead =
    issues.length === 0
      ? 'All projected starters are healthy and available this week.'
      : capitalize(joinWithCommasAnd(issues)) + '.'

  const benchNote =
    c.benchAvailability === 'healthy'
      ? 'Bench depth appears healthy.'
      : c.benchAvailability === 'thin'
        ? 'Bench depth looks thin.'
        : 'Bench depth is critically thin.'

  return `${lead} ${benchNote}`
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}
function joinWithCommasAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

/**
 * Aggregate a manager's roster into the display-only Team Health contract.
 *
 * Returns `null` when there are ZERO active players (nothing to summarize) so
 * consumers can render an honest empty state — distinct from a real, healthy,
 * all-zero roster (which returns a populated contract).
 */
export function aggregateManagerTeamHealth(
  input: TeamHealthAggregationInput,
  now: Date = new Date(),
): ManagerTeamHealthV1 | null {
  const active = (input.players ?? []).filter((p) => !isDropped(p))
  if (active.length === 0) return null

  const currentWeek = input.currentWeek ?? null

  let starterCount = 0
  let injuredStarterCount = 0
  let questionableStarterCount = 0
  let byeWeekStarterCount = 0
  let unavailableStarterCount = 0 // deduplicated: out OR on bye
  let healthyBenchCount = 0

  for (const p of active) {
    const injury = classifyInjury(p.injuryStatus)
    const onBye = isOnByeThisWeek(p.byeWeek, currentWeek)

    if (isStarterSlot(p.slotType)) {
      starterCount += 1
      if (injury === 'out') injuredStarterCount += 1
      else if (injury === 'questionable') questionableStarterCount += 1
      if (onBye) byeWeekStarterCount += 1
      if (injury === 'out' || onBye) unavailableStarterCount += 1
      continue
    }

    // Reserve: only true bench players (not IR/taxi/devy) count as available depth.
    if (isBenchEligibleSlot(p.slotType) && injury !== 'out' && !onBye) {
      healthyBenchCount += 1
    }
  }

  const availableStarterCount = Math.max(0, starterCount - unavailableStarterCount)
  const benchAvailability = classifyBenchAvailability(healthyBenchCount)
  const rosterCompleteness = classifyRosterCompleteness(unavailableStarterCount, healthyBenchCount)

  return {
    version: MANAGER_TEAM_HEALTH_VERSION,
    derivedAt: now.toISOString(),
    starterCount,
    availableStarterCount,
    injuredStarterCount,
    questionableStarterCount,
    byeWeekStarterCount,
    benchAvailability,
    rosterCompleteness,
    summary: buildSummary({ injuredStarterCount, questionableStarterCount, byeWeekStarterCount, benchAvailability }),
  }
}

function isDropped(p: TeamHealthRosterPlayerInput): boolean {
  return p.droppedAt !== null && p.droppedAt !== undefined
}
