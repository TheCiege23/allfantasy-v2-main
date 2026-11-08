import { createRng, seedFromString } from '@/lib/core-app/outlookSim'
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
   * Source for the `random` step, in [0, 1). Omitted → a draw seeded by the week and the tied teams
   * (see `drawFor`). Tests and the season simulator pass their own seeded source.
   */
  random?: () => number
}): { choppedRosterIds: string[]; stepUsed: TiebreakStep | null; reason: string } {
  const { candidates, tiebreakerOrder, weekOrPeriod, draftSlotByRoster } = args
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
    if (!step) return rows.slice(0, needed)
    if (step === 'commissioner') {
      const chosen = rows.filter((row) => overrides.includes(row.rosterId))
      if (!chosen.length) return breakTie(rows, needed, index + 1)
      stepUsed = step
      return [...chosen.slice(0, needed), ...breakTie(rows.filter((row) => !overrides.includes(row.rosterId)), Math.max(0, needed - chosen.length), index + 1)]
    }
    if (step === 'random') {
      stepUsed = step
      return shuffleAndTake(rows, needed, args.random ?? drawFor(weekOrPeriod, rows))
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
 * The default draw for the `random` step: seeded by the week and the SORTED ids of the teams tied on
 * the line, so the same tie always draws the same team.
 *
 * ⚠ IT WAS `Math.random()`, AND THAT MADE THE PREVIEW AND THE CHOP DISAGREE. The commissioner's chop
 * preview (./chopPreview.ts) and the real chop (./GuillotineEliminationEngine.ts) both call this
 * resolver, each drew its own coin, and the preview had to warn that "the real chop may pick the other
 * team". A rerun of the same week could also chop a different team. Seeding by the tie itself keeps
 * it a fair draw — nobody chooses the seed — while making it the same draw everywhere it is computed.
 * Sorting the ids makes it independent of the order each caller lists the candidates in.
 */
function drawFor(weekOrPeriod: number, tied: PeriodScoreRow[]): () => number {
  const ids = tied.map((row) => row.rosterId).sort()
  return createRng(seedFromString(`guillotine-tiebreak|${weekOrPeriod}|${ids.join(',')}`))
}

function shuffleAndTake(rows: PeriodScoreRow[], count: number, random: () => number): PeriodScoreRow[] {
  // Start from a canonical order, so the result depends only on the draw, never on input order.
  const result = [...rows].sort((a, b) => (a.rosterId < b.rosterId ? -1 : a.rosterId > b.rosterId ? 1 : 0))
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result.slice(0, count)
}
