import type { PeriodScoreRow, TiebreakStep } from './types'

export type DraftSlotByRoster = Map<string, number>

/** Select the lowest N scores; apply tiebreakers only at an elimination boundary. */
export function resolveTiebreak(args: {
  candidates: PeriodScoreRow[]
  tiebreakerOrder: TiebreakStep[]
  teamsPerChop: number
  weekOrPeriod: number
  draftSlotByRoster: DraftSlotByRoster
  commissionerChoppedRosterIds?: string[]
  /**
   * Fixes the `random` step and the last-resort order (see `seededOrder`). Pass the league and season
   * (`leagueId:season`); the chop engine and the chop preview pass the same one so they agree.
   */
  tiebreakSeed?: string
  /**
   * A caller's own source for the `random` step, in [0, 1) — tests and the season simulator. Omitted →
   * the seeded order above, which is what every real chop and preview uses.
   */
  random?: () => number
}): { choppedRosterIds: string[]; stepUsed: TiebreakStep | null; reason: string } {
  const { candidates, tiebreakerOrder, weekOrPeriod, draftSlotByRoster } = args
  const seed = args.tiebreakSeed ?? ''
  const count = Math.max(0, Math.min(Math.floor(args.teamsPerChop), candidates.length))
  if (!count) return { choppedRosterIds: [], stepUsed: null, reason: 'no candidates' }
  const overrides = [...new Set(args.commissionerChoppedRosterIds ?? [])]
    .filter((id) => candidates.some((row) => row.rosterId === id))
  if (overrides.length >= count) {
    return { choppedRosterIds: overrides.slice(0, count), stepUsed: 'commissioner', reason: 'commissioner override' }
  }

  let stepUsed: TiebreakStep | null = null
  function takeGroups(rows: PeriodScoreRow[], remaining: number, key: (row: PeriodScoreRow) => number, nextStep: number): PeriodScoreRow[] {
    const ordered = [...rows].sort((a, b) => key(a) - key(b))
    const selected: PeriodScoreRow[] = []
    for (const group of groupByKey(ordered, key)) {
      const needed = remaining - selected.length
      if (needed <= 0) break
      selected.push(...(group.length <= needed ? group : breakTie(group, needed, nextStep)))
    }
    return selected
  }
  function breakTie(rows: PeriodScoreRow[], needed: number, index: number): PeriodScoreRow[] {
    if (needed <= 0) return []
    if (rows.length <= needed) return rows
    const step = tiebreakerOrder[index]
    // Every configured step is spent: a seeded order, never whatever order the database returned.
    if (!step) return seededOrder(rows, seed, weekOrPeriod).slice(0, needed)
    if (step === 'commissioner') {
      const chosen = rows.filter((row) => overrides.includes(row.rosterId))
      if (!chosen.length) return breakTie(rows, needed, index + 1)
      stepUsed = step
      return [...chosen.slice(0, needed), ...breakTie(rows.filter((row) => !overrides.includes(row.rosterId)), Math.max(0, needed - chosen.length), index + 1)]
    }
    if (step === 'random') {
      stepUsed = step
      return args.random ? shuffleAndTake(rows, needed, args.random) : seededOrder(rows, seed, weekOrPeriod).slice(0, needed)
    }
    if (step === 'draft_slot' && weekOrPeriod > 1) return breakTie(rows, needed, index + 1)
    const key = (row: PeriodScoreRow) => {
      if (step === 'bench_points') return row.benchPoints ?? 0
      if (step === 'season_points') return row.seasonPointsCumul
      if (step === 'previous_period') return row.previousPeriodPoints ?? 0
      return -(draftSlotByRoster.get(row.rosterId) ?? 9999)
    }
    stepUsed = step
    return takeGroups(rows, needed, key, index + 1)
  }
  const selected = takeGroups(candidates, count, (row) => row.periodPoints, 0)
  return { choppedRosterIds: selected.map((row) => row.rosterId), stepUsed, reason: stepUsed ? `tiebreak: ${stepUsed}` : 'lowest period score' }
}

function groupByKey<T>(sorted: T[], key: (row: T) => number): T[][] {
  const groups: T[][] = []
  for (const row of sorted) {
    const last = groups[groups.length - 1]
    if (last && key(last[0]!) === key(row)) last.push(row)
    else groups.push([row])
  }
  return groups
}

/**
 * 🛑 THE `random` STEP USED Math.random, SO THE SAME TIE COULD CHOP A DIFFERENT TEAM ON A RETRY.
 * The chop engine re-runs a week it crashed in (`resumeAuditedRosterRelease`, the started-check), the
 * chop preview runs the same rule ahead of time, and a disputed chop has to be explainable afterwards.
 * Each tied team is ordered by a hash of the seed, the period and its roster id: arbitrary, and the same
 * answer every time it is asked. The last-resort fallback (every step spent) used input order, which is
 * database order; it takes the same seeded order.
 */
export function seededOrder<T extends { rosterId: string }>(rows: readonly T[], seed: string, weekOrPeriod: number): T[] {
  const key = (row: T) => fnv1a(`${seed}:${weekOrPeriod}:${row.rosterId}`)
  return [...rows].sort((a, b) => key(a) - key(b) || (a.rosterId < b.rosterId ? -1 : a.rosterId > b.rosterId ? 1 : 0))
}

/** 32-bit FNV-1a. Pure JS, so this module stays importable anywhere; ordering needs no cryptography. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/** A caller-supplied draw (`random`), applied to a canonical order so input order never matters. */
function shuffleAndTake(rows: PeriodScoreRow[], count: number, random: () => number): PeriodScoreRow[] {
  // Start from a canonical order, so the result depends only on the draw, never on input order.
  const result = [...rows].sort((a, b) => (a.rosterId < b.rosterId ? -1 : a.rosterId > b.rosterId ? 1 : 0))
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result.slice(0, count)
}
