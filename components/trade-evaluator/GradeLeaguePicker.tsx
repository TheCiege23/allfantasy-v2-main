"use client"

/**
 * Which league the trade analyzer grades in (2026-09-27).
 *
 * 🛑 THE ANALYZER COULD ONLY GRADE WHEN OPENED WITH `?leagueId=`. The one grade is taken on a
 * league's own values and rules (`evaluateTrade`, `NO_LEAGUE_REASON`), and the page had no way to
 * choose a league — so from /core's "Trade analyzer" tool, which links a bare `/trade-evaluator`,
 * every trade came back "Not graded: no league is selected". This is that choice.
 *
 * Only a league with a unified `League` row is offered: that id is the one the route's membership
 * check and the grader both accept, and a Sleeper-space id would 403 the whole evaluation. NFL
 * only, because the analyzer prices nothing else (the page's sport select says the same).
 */

export type GradeLeagueListRow = {
  id: string
  name?: string | null
  sport?: string | null
  season?: number | string | null
  unifiedLeagueId?: string | null
  hasUnifiedRecord?: boolean
}

export type GradeLeagueOption = { id: string; label: string }

/** One option per unified NFL league, newest season kept, sorted by name. Pure, for the test. */
export function gradeLeagueOptions(rows: ReadonlyArray<GradeLeagueListRow>): GradeLeagueOption[] {
  const best = new Map<string, { name: string; season: number | null }>()
  for (const row of rows) {
    if (!row.hasUnifiedRecord) continue
    const id = String(row.unifiedLeagueId ?? row.id ?? "").trim()
    if (!id) continue
    const sport = String(row.sport ?? "NFL").trim().toUpperCase()
    if (sport !== "NFL") continue
    const season = Number(row.season)
    const seasonNum = Number.isFinite(season) && season > 0 ? season : null
    const prev = best.get(id)
    if (prev && (prev.season ?? 0) >= (seasonNum ?? 0)) continue
    best.set(id, { name: String(row.name ?? "").trim() || "Unnamed league", season: seasonNum })
  }
  return [...best.entries()]
    .map(([id, v]) => ({ id, label: v.season ? `${v.name} · ${v.season}` : v.name }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** What the grade card adds under a no-league withheld grade: how to get one. */
export function noLeagueGradeHint(optionCount: number): string {
  return optionCount > 0
    ? "Choose one of your leagues under League Settings and evaluate again — the grade is taken on that league's own values."
    : "Import or join a league to get a grade — it is taken on a league's own values."
}

export function GradeLeaguePicker({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<GradeLeagueOption>
  value: string
  onChange: (leagueId: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">
        League (for the grade)
      </span>
      <select
        data-testid="trade-league-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#101224] px-3 py-3 text-base text-white focus:border-cyan-500/40 focus:outline-none sm:min-h-0 sm:text-sm"
      >
        <option value="">No league — the trade is not graded</option>
        {/* A linked league the list does not carry (another season's id) still shows as chosen. */}
        {value && !options.some((o) => o.id === value) ? <option value={value}>Linked league</option> : null}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="mt-1.5 block text-[11px] text-white/40">
        The grade uses this league&apos;s own values, scoring and roster rules.
      </span>
    </label>
  )
}
