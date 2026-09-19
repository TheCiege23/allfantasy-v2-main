export type IncrementalSeasonPlan = {
  yearsToDiscover: number[]
  reusedYears: number[]
}

/**
 * Past completed/empty years are immutable enough to reuse. We still refresh the
 * current year and the most recent known year so an offseason sync can pick up a
 * late championship result without rescanning every season in the account.
 */
export function buildIncrementalSeasonPlan(input: {
  launchYear: number
  currentYear: number
  terminalYears: Iterable<number>
}): IncrementalSeasonPlan {
  const allYears = Array.from(
    { length: Math.max(0, input.currentYear - input.launchYear + 1) },
    (_, index) => input.launchYear + index,
  )
  const terminal = new Set(
    Array.from(input.terminalYears).filter(
      (year) => Number.isInteger(year) && year >= input.launchYear && year <= input.currentYear,
    ),
  )
  const latestTerminal = terminal.size > 0 ? Math.max(...terminal) : null
  const refreshYears = new Set<number>([input.currentYear])
  if (latestTerminal != null) refreshYears.add(latestTerminal)

  const yearsToDiscover = allYears.filter((year) => !terminal.has(year) || refreshYears.has(year))
  const discoverSet = new Set(yearsToDiscover)
  const reusedYears = allYears.filter((year) => terminal.has(year) && !discoverSet.has(year))

  return { yearsToDiscover, reusedYears }
}
