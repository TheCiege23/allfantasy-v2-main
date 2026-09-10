/**
 * (B) The regular-season freeze — the number the rookie draft order is built on.
 *
 * 🛑 THE BUSINESS RULE, AND IT IS THE WHOLE REASON THIS MODULE EXISTS:
 * **PLAYOFF POINTS MUST NOT ALTER A NON-PLAYOFF TEAM'S ROOKIE DRAFT SLOT.**
 * A team that misses the playoffs has finished accumulating the number their pick depends on. If
 * the order is recomputed later from a running season total, every non-playoff team's slot moves —
 * not because they did anything, but because OTHER teams kept scoring. The freeze is what makes a
 * non-playoff team's position final the moment their season ends.
 *
 * 🛑 AND THE EXISTING "MAX PF" CODE IN THIS REPO CANNOT BE REUSED FOR IT. Audited 2026-09-10:
 *
 *   - `lib/league/maxPF.ts` declares `maxPF` and assigns it `SeasonResult.pointsFor`.
 *   - `lib/league/rookieDraftOrder.ts` sorts its `reverse_max_pf` mode on `LeagueTeam.pointsFor`,
 *     with a comment calling it "Max PF (points for, last week of regular season)".
 *
 * Both are ACTUAL POINTS SCORED, and `LeagueTeam.pointsFor` is a RUNNING TOTAL that keeps
 * accumulating through the playoffs. Pointing the EFL order at either would ship exactly the
 * playoff-inclusive number the rule forbids, and it would read as correct because the variable is
 * already called `maxPF`. That is why this module computes from per-week rows instead.
 *
 * ✅ RESOLVED 2026-09-10 — TRUE MAX PF NOW EXISTS AND IS THE CANONICAL METRIC.
 * An earlier version of this header recorded a second, separate problem: "Max PF" properly means
 * OPTIMAL-LINEUP points, and summing points ACTUALLY SCORED rewards the very tanking the EFL rule
 * exists to discourage. That is now built — `./maxPfEngine.ts` over
 * `lib/lineup-optimizer/optimalLineup.ts` — and `metric: 'optimal_lineup_max_pf'` is what EFL
 * freezes.
 *
 * ⚠ THIS MODULE STILL DOES NOT HARDCODE A METRIC, and that has not become vestigial. It sums
 * whatever per-week value it is handed and records which metric and which engine produced it, so a
 * snapshot taken under one can never be silently compared against another.
 *
 * Pure: rows in, a snapshot out. No DB, no clock, no randomness. The DB-first reader lives in
 * `./maxPfFreezeReads.ts`.
 */

/**
 * Which number was summed.
 *
 * ⚠ CARRIED ON EVERY SNAPSHOT AND COMPARED ON REFREEZE. A snapshot taken under one metric and a
 * recomputation under another are not the same measurement, and reporting them as equal would hide
 * a metric change behind a matching row count.
 */
export type MaxPfMetric =
  /**
   * Points ACTUALLY SCORED by the submitted starting lineup, summed over regular-season weeks.
   * What `WeeklyMatchup.pointsFor` holds.
   *
   * 🛑 THIS IS NOT MAX PF AND IS NAMED SO IT CANNOT BE MISTAKEN FOR IT. A manager lowers this by
   * benching a good player, which is exactly the tanking the EFL rule exists to discourage. It is
   * kept as a declarable metric only so an older snapshot can say honestly which number it holds.
   */
  | 'actual_points_for'
  /**
   * TRUE Max PF: the maximum legal points the roster could have scored with optimal lineup
   * decisions, summed over regular-season weeks. The anti-tanking metric, and the canonical one.
   *
   * Produced by `./maxPfEngine.ts` over `lib/lineup-optimizer/optimalLineup.ts`.
   */
  | 'optimal_lineup_max_pf'

/** One team's per-week value. `week` is the scoring period; `value` is the metric for that week. */
export type WeeklyTeamValue = {
  teamId: string
  week: number
  value: number
}

export type MaxPfFreezeRow = {
  teamId: string
  value: number
  /** How many weeks were actually summed. Below `expectedWeeks` means the input had holes. */
  weeksCounted: number
  source: 'weekly_rows' | 'commissioner_correction'
}

export type MaxPfFreezeSnapshot = {
  leagueId: string
  season: number
  /**
   * The last week that counts.
   *
   * 🛑 NOT HARDCODED TO NFL WEEK 14. The EFL constitution uses week 14 today, but the trigger is
   * semantic — REGULAR_SEASON_COMPLETE — and a league that plays a fifteen-week regular season, or
   * a different sport, must not inherit a number from this one. The caller supplies it.
   */
  regularSeasonFinalWeek: number
  metric: MaxPfMetric
  /**
   * Which engine produced the numbers.
   *
   * 🛑 PART OF THE FINGERPRINT AND OF THE FREEZE'S UNIQUENESS KEY. Two engines that both call their
   * output "Max PF" and quietly disagree is the failure this whole phase exists to end, so a
   * snapshot states which one it came from and a bump makes old and new distinguishable rather
   * than silently comparable.
   */
  computationVersion: string
  rows: MaxPfFreezeRow[]
  /**
   * A stable digest of (league, season, final week, metric, sorted rows).
   *
   * ⚠ THIS IS WHAT MAKES REFREEZING IDEMPOTENT. Recomputing the same inputs produces the same
   * fingerprint, so a second freeze is a no-op that can be detected without diffing thirty-two
   * rows. A DIFFERENT fingerprint against a stored snapshot means a stat correction moved a
   * regular-season score after the freeze — reported as drift, never silently applied.
   */
  fingerprint: string
}

/**
 * What Commissioner OS should say about the freeze.
 *
 * `missing`   — nothing stored, and the weekly data is too incomplete to compute one.
 * `ready`     — computable right now, but nothing has been stored. NOT the same as frozen.
 * `frozen`    — a stored snapshot exists and nobody has overridden it.
 * `corrected` — a stored snapshot exists and carries an explicit commissioner correction.
 */
export type MaxPfFreezeState = 'missing' | 'ready' | 'frozen' | 'corrected'

export type MaxPfFreezeStatus = {
  state: MaxPfFreezeState
  snapshot: MaxPfFreezeSnapshot | null
  /** Weeks 1..finalWeek that had no row for at least one team. */
  missingWeeks: number[]
  /** Teams with no rows at all. */
  teamsWithNoData: string[]
  /**
   * A stored snapshot exists AND a fresh computation disagrees with it.
   *
   * 🛑 DRIFT DOES NOT OVERWRITE. The stored value wins by definition — that is what "frozen" means
   * — so this is a report for a human, not a trigger to refreeze. Stat corrections legitimately
   * move a week-9 score in week 12; the draft order does not move with them.
   */
  driftDetected: boolean
  explanation: string
}

/** FNV-1a over a canonical string. Deterministic, dependency-free, and stable across processes. */
function digest(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Round to two decimals before summing into the fingerprint.
 *
 * ⚠ FLOATING-POINT ADDITION IS ORDER-DEPENDENT, AND THE FINGERPRINT IS AN EQUALITY TEST. Summing
 * the same weeks in a different order can differ in the last bits, which would report drift on a
 * snapshot nothing had touched. Fantasy scores are two-decimal quantities, so rounding there is
 * lossless for the domain and makes the digest a function of the values rather than of the
 * iteration order.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export type ComputeMaxPfFreezeInput = {
  leagueId: string
  season: number
  regularSeasonFinalWeek: number
  metric: MaxPfMetric
  computationVersion: string
  weeklyRows: readonly WeeklyTeamValue[]
  /** Teams expected to appear. Supplied so a team with zero rows is reported, not omitted. */
  teamIds: readonly string[]
}

export type ComputeMaxPfFreezeResult = {
  snapshot: MaxPfFreezeSnapshot
  missingWeeks: number[]
  teamsWithNoData: string[]
  /** True when every expected team has a value for every week up to the final week. */
  complete: boolean
}

/**
 * Sum the regular season, and nothing else.
 *
 * 🛑 THE `week <= regularSeasonFinalWeek` FILTER IS THE ENTIRE SAFETY MECHANISM. It is what makes
 * this immune to playoff inflation BY CONSTRUCTION rather than by remembering to snapshot at the
 * right moment: run it in week 17 and it still returns the week-14 number. That property is why
 * this reads per-week rows instead of a season total — a season total has already lost the
 * information needed to exclude the playoffs.
 */
export function computeRegularSeasonMaxPf(
  input: ComputeMaxPfFreezeInput,
): ComputeMaxPfFreezeResult {
  const finalWeek = input.regularSeasonFinalWeek
  const totals = new Map<string, { value: number; weeks: Set<number> }>()
  for (const id of input.teamIds) totals.set(id, { value: 0, weeks: new Set() })

  for (const row of input.weeklyRows) {
    if (!Number.isInteger(row.week) || row.week < 1 || row.week > finalWeek) continue
    if (!Number.isFinite(row.value)) continue
    const bucket = totals.get(row.teamId)
    /*
     * ⚠ A ROW FOR AN UNEXPECTED TEAM IS IGNORED, NOT ADDED. `teamIds` is the roster of record; a
     * stray rosterId (an orphan, a prior-season row, a provider id in the wrong space) must not
     * invent a thirty-third team in a thirty-two-team ladder.
     */
    if (!bucket) continue
    if (bucket.weeks.has(row.week)) continue
    bucket.weeks.add(row.week)
    bucket.value += row.value
  }

  const rows: MaxPfFreezeRow[] = [...totals.entries()]
    .map(([teamId, b]) => ({
      teamId,
      value: round2(b.value),
      weeksCounted: b.weeks.size,
      source: 'weekly_rows' as const,
    }))
    /* Sorted by teamId so the fingerprint is a function of content, not of Map insertion order. */
    .sort((a, b) => (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0))

  const missingWeeks: number[] = []
  for (let w = 1; w <= finalWeek; w += 1) {
    const covered = [...totals.values()].every((b) => b.weeks.has(w))
    if (!covered) missingWeeks.push(w)
  }
  const teamsWithNoData = rows.filter((r) => r.weeksCounted === 0).map((r) => r.teamId)

  const canonical = [
    input.leagueId,
    input.season,
    finalWeek,
    input.metric,
    input.computationVersion,
    ...rows.map((r) => `${r.teamId}=${r.value.toFixed(2)}`),
  ].join('|')

  return {
    snapshot: {
      leagueId: input.leagueId,
      season: input.season,
      regularSeasonFinalWeek: finalWeek,
      metric: input.metric,
      computationVersion: input.computationVersion,
      rows,
      fingerprint: digest(canonical),
    },
    missingWeeks,
    teamsWithNoData,
    complete: missingWeeks.length === 0 && teamsWithNoData.length === 0,
  }
}

/**
 * A recorded commissioner correction.
 *
 * ⚠ EXPLICIT AND AUDITED, NEVER A SILENT REFREEZE. The brief allows an override path; the cost of
 * one that is not auditable is that a draft order can change with no record of who changed it or
 * why. So a correction names the actor, the reason and the exact per-team values it replaces.
 */
export type MaxPfCorrection = {
  teamId: string
  value: number
  reason: string
  correctedByUserId: string
  correctedAt: string
}

/**
 * Apply corrections to a snapshot, producing a NEW snapshot with a new fingerprint.
 *
 * ⚠ THE INPUT SNAPSHOT IS NOT MUTATED. A correction is a new immutable record whose fingerprint
 * differs from the original, so both can be stored and the change is visible as a diff rather than
 * as an absence.
 */
export function applyMaxPfCorrections(
  snapshot: MaxPfFreezeSnapshot,
  corrections: readonly MaxPfCorrection[],
): { snapshot: MaxPfFreezeSnapshot; applied: MaxPfCorrection[]; rejected: MaxPfCorrection[] } {
  const byTeam = new Map(snapshot.rows.map((r) => [r.teamId, r]))
  const applied: MaxPfCorrection[] = []
  const rejected: MaxPfCorrection[] = []

  for (const c of corrections) {
    /*
     * A correction for a team not in the snapshot is rejected rather than added: the snapshot's
     * team set came from the roster of record, and a correction is not the place to enlarge it.
     */
    if (!byTeam.has(c.teamId) || !Number.isFinite(c.value)) {
      rejected.push(c)
      continue
    }
    byTeam.set(c.teamId, {
      teamId: c.teamId,
      value: round2(c.value),
      weeksCounted: byTeam.get(c.teamId)!.weeksCounted,
      source: 'commissioner_correction',
    })
    applied.push(c)
  }

  const rows = [...byTeam.values()].sort((a, b) =>
    a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0,
  )
  const canonical = [
    snapshot.leagueId,
    snapshot.season,
    snapshot.regularSeasonFinalWeek,
    snapshot.metric,
    snapshot.computationVersion,
    ...rows.map((r) => `${r.teamId}=${r.value.toFixed(2)}`),
  ].join('|')

  return {
    snapshot: { ...snapshot, rows, fingerprint: digest(canonical) },
    applied,
    rejected,
  }
}

/**
 * The state Commissioner OS should report.
 *
 * ⚠ `ready` AND `frozen` ARE DIFFERENT ANSWERS AND MUST NOT BE COLLAPSED. "I can compute this" and
 * "this is settled and will not move" look identical in a UI that only shows numbers, and only the
 * second one is a promise. A commissioner shown a `ready` order as though it were frozen will see
 * it change next week and lose trust in the whole ladder.
 */
export function resolveMaxPfFreezeStatus(input: {
  stored: MaxPfFreezeSnapshot | null
  storedHasCorrection?: boolean
  computed: ComputeMaxPfFreezeResult | null
}): MaxPfFreezeStatus {
  const { stored, computed } = input

  if (stored) {
    const driftDetected = computed != null && computed.snapshot.fingerprint !== stored.fingerprint
    const state: MaxPfFreezeState = input.storedHasCorrection ? 'corrected' : 'frozen'
    return {
      state,
      snapshot: stored,
      missingWeeks: computed?.missingWeeks ?? [],
      teamsWithNoData: computed?.teamsWithNoData ?? [],
      driftDetected,
      explanation: driftDetected
        ? `Frozen at the end of week ${stored.regularSeasonFinalWeek}. A regular-season score has changed since — a stat correction — but the frozen value is what the draft order uses and it has not moved.`
        : `Frozen at the end of week ${stored.regularSeasonFinalWeek}${
            state === 'corrected' ? ', with a recorded commissioner correction' : ''
          }.`,
    }
  }

  if (!computed || !computed.complete) {
    const gaps: string[] = []
    if (computed && computed.missingWeeks.length > 0) {
      gaps.push(`weeks ${computed.missingWeeks.join(', ')} are incomplete`)
    }
    if (computed && computed.teamsWithNoData.length > 0) {
      gaps.push(`${computed.teamsWithNoData.length} team(s) have no weekly scores`)
    }
    return {
      state: 'missing',
      snapshot: null,
      missingWeeks: computed?.missingWeeks ?? [],
      teamsWithNoData: computed?.teamsWithNoData ?? [],
      driftDetected: false,
      explanation: gaps.length
        ? `Cannot freeze yet: ${gaps.join('; ')}.`
        : 'Cannot freeze yet: no weekly scores on file.',
    }
  }

  return {
    state: 'ready',
    snapshot: computed.snapshot,
    missingWeeks: [],
    teamsWithNoData: [],
    driftDetected: false,
    explanation: `Computable now from weeks 1-${computed.snapshot.regularSeasonFinalWeek}, but NOT yet frozen. This order can still move.`,
  }
}
