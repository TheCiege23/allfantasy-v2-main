/**
 * Scenario explainer (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 8) — the two odds the app did not
 * have: the #1 pick over the rest of the season, and surviving the guillotine. Pure, seeded.
 *
 * The playoff half is NOT here: Season Outlook already answers "what do I need to make the playoffs"
 * (milestones, cut line, rooting guide), and two playoff models would eventually disagree.
 *
 * ⚠ THE #1 PICK RIDES THE SAME SIMULATION AS SEASON OUTLOOK. `simulateSeason` already plays every
 * remaining game; each run's final table is read through `onRun`, so the pick odds and the playoff
 * odds come from one set of seasons and cannot contradict each other ("62% to miss the playoffs" next
 * to a pick distribution that assumes something else).
 */

import { createRng, gaussian, simulateSeason, type SimInput } from '@/lib/core-app/outlookSim'

export type PickRuleKind = 'lottery' | 'reverse_standings' | 'lowest_points'

/** One team's final line in one simulated season, best first (rank 1 = best). */
export type RunRow = { rosterId: string; rank: number; wins: number; losses: number; ties: number; pointsFor: number }

export type FirstPickOdds = {
  /** Chance at the #1 pick, 0–100. For a lottery, averaged over the lottery's own odds in each run. */
  firstPickPct: number
  /** Chance of finishing with the worst line outside the playoffs (the lottery's top seed, if any). */
  worstPct: number
  /** Chance the season ends outside the playoff field at all. */
  missPlayoffsPct: number
}

export function firstPickOdds(
  input: SimInput,
  rule: PickRuleKind,
  opts: {
    iterations: number
    seed: number
    /** Lottery only: each eligible team's chance at #1 (0–1) for one run's table. */
    lottery?: (rows: RunRow[], playoffTeams: number) => ReadonlyMap<string, number>
  },
): Map<string, FirstPickOdds> {
  const ids = input.teams.map((t) => t.rosterId)
  const ties = new Map(input.teams.map((t) => [t.rosterId, t.ties ?? 0]))
  const games = new Map(input.teams.map((t) => [t.rosterId, t.wins + t.losses + (t.ties ?? 0)]))
  const remainingGames = new Map<string, number>()
  for (const g of input.remaining) for (const id of [g.a, g.b]) remainingGames.set(id, (remainingGames.get(id) ?? 0) + 1)
  const first = new Map(ids.map((id) => [id, 0]))
  const worst = new Map(ids.map((id) => [id, 0]))
  const missed = new Map(ids.map((id) => [id, 0]))
  let runs = 0

  simulateSeason(input, {
    iterations: opts.iterations,
    seed: opts.seed,
    onRun: (run) => {
      runs++
      const line = (id: string) => run.finalWins(id) + (ties.get(id) ?? 0) / 2
      const outside = ids.filter((id) => !run.field.has(id))
      for (const id of outside) missed.set(id, (missed.get(id) ?? 0) + 1)
      if (outside.length === 0) return
      const byRule = [...outside].sort((a, b) =>
        rule === 'lowest_points' ? run.finalPoints(a) - run.finalPoints(b) : line(a) - line(b) || run.finalPoints(a) - run.finalPoints(b),
      )
      worst.set(byRule[0], (worst.get(byRule[0]) ?? 0) + 1)
      if (rule !== 'lottery') {
        first.set(byRule[0], (first.get(byRule[0]) ?? 0) + 1)
        return
      }
      if (!opts.lottery) return
      const table = [...ids].sort((a, b) => line(b) - line(a) || run.finalPoints(b) - run.finalPoints(a))
      const rows: RunRow[] = table.map((id, i) => {
        const w = run.finalWins(id)
        const t = ties.get(id) ?? 0
        const played = (games.get(id) ?? 0) + (remainingGames.get(id) ?? 0)
        return { rosterId: id, rank: i + 1, wins: w, ties: t, losses: Math.max(0, played - w - t), pointsFor: run.finalPoints(id) }
      })
      for (const [id, share] of opts.lottery(rows, input.playoffTeams)) first.set(id, (first.get(id) ?? 0) + share)
    },
  })

  const pct = (n: number) => (runs > 0 ? Math.round((n / runs) * 1000) / 10 : 0)
  return new Map(ids.map((id) => [id, { firstPickPct: pct(first.get(id) ?? 0), worstPct: pct(worst.get(id) ?? 0), missPlayoffsPct: pct(missed.get(id) ?? 0) }]))
}

// ── Guillotine ──────────────────────────────────────────────────────────────

export type ChopTeam = { rosterId: string; mu: number; sigma: number }

export type ChopOdds = {
  /** Chance of NOT being chopped this week. */
  surviveWeekPct: number
  /** Chance of surviving every remaining chop. */
  surviveAllPct: number
  /** Average chops survived, of `chopWeeks`. */
  expectedChopsSurvived: number
}

export type ChopSimResult = {
  chopWeeks: number
  odds: Map<string, ChopOdds>
  /**
   * For each team: the score that keeps you safe this week in 50% / 80% / 95% of simulated weeks —
   * the line the lowest-scoring teams other than you set. Null when nobody else is left.
   */
  safeScore: Map<string, { p50: number; p80: number; p95: number } | null>
}

const quantile = (sorted: number[], q: number) =>
  sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]

/**
 * Play the remaining chops `iterations` times: each week every team still alive scores a draw from
 * its own weekly mean and spread, and the lowest `teamsPerChop` are cut. Ties go to the lower draw
 * index — a tiebreak this simulation cannot model, and an event of probability ~0 with real scores.
 */
export function simulateChop(
  teams: readonly ChopTeam[],
  opts: { chopWeeks: number; teamsPerChop: number; iterations: number; seed: number },
): ChopSimResult {
  const per = Math.max(1, Math.floor(opts.teamsPerChop))
  const chopWeeks = Math.max(0, Math.min(Math.floor(opts.chopWeeks), Math.floor((teams.length - 1) / per)))
  const surviveWeek = new Map(teams.map((t) => [t.rosterId, 0]))
  const surviveAll = new Map(teams.map((t) => [t.rosterId, 0]))
  const chopsSurvived = new Map(teams.map((t) => [t.rosterId, 0]))
  const lines = new Map<string, number[]>(teams.map((t) => [t.rosterId, []]))
  const iterations = Math.max(1, Math.floor(opts.iterations))

  for (let it = 0; it < iterations; it++) {
    const rng = createRng(opts.seed + it * 7919)
    let alive = [...teams]
    for (let week = 0; week < chopWeeks && alive.length > per; week++) {
      const scored = alive.map((t) => ({ t, s: gaussian(rng, t.mu, t.sigma) })).sort((a, b) => a.s - b.s)
      if (week === 0) {
        // The safe line for each team this week: the per-th lowest score among the OTHER teams.
        for (const { t } of scored) {
          const others = scored.filter((x) => x.t.rosterId !== t.rosterId)
          if (others.length >= per) lines.get(t.rosterId)!.push(others[per - 1].s)
        }
      }
      const cut = new Set(scored.slice(0, per).map((x) => x.t.rosterId))
      for (const t of alive) if (!cut.has(t.rosterId)) {
        chopsSurvived.set(t.rosterId, (chopsSurvived.get(t.rosterId) ?? 0) + 1)
        if (week === 0) surviveWeek.set(t.rosterId, (surviveWeek.get(t.rosterId) ?? 0) + 1)
      }
      alive = alive.filter((t) => !cut.has(t.rosterId))
    }
    for (const t of alive) surviveAll.set(t.rosterId, (surviveAll.get(t.rosterId) ?? 0) + 1)
  }

  const pct = (n: number) => Math.round((n / iterations) * 1000) / 10
  const odds = new Map<string, ChopOdds>()
  const safeScore = new Map<string, { p50: number; p80: number; p95: number } | null>()
  for (const t of teams) {
    odds.set(t.rosterId, {
      surviveWeekPct: chopWeeks === 0 ? 100 : pct(surviveWeek.get(t.rosterId) ?? 0),
      surviveAllPct: pct(surviveAll.get(t.rosterId) ?? 0),
      expectedChopsSurvived: Math.round(((chopsSurvived.get(t.rosterId) ?? 0) / iterations) * 10) / 10,
    })
    const l = (lines.get(t.rosterId) ?? []).sort((a, b) => a - b)
    safeScore.set(t.rosterId, l.length === 0 ? null : { p50: Math.round(quantile(l, 0.5) * 10) / 10, p80: Math.round(quantile(l, 0.8) * 10) / 10, p95: Math.round(quantile(l, 0.95) * 10) / 10 })
  }
  return { chopWeeks, odds, safeScore }
}

/** Mean and spread of a team's weekly scores, with a floor so two quiet weeks are not read as certainty. */
export function chopProfile(scores: readonly number[], league: { mu: number; sigma: number }): { mu: number; sigma: number } {
  if (scores.length < 2) return league
  const mu = scores.reduce((a, b) => a + b, 0) / scores.length
  const variance = scores.reduce((a, b) => a + (b - mu) ** 2, 0) / (scores.length - 1)
  // Shrink toward the league with few weeks; never trust a spread tighter than half the league's.
  const w = Math.min(1, scores.length / 6)
  return { mu: w * mu + (1 - w) * league.mu, sigma: Math.max(Math.sqrt(variance), league.sigma * 0.5) }
}
