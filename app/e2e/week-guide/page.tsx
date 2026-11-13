import WeekGuideHarnessClient from './WeekGuideHarnessClient'

/**
 * DB-free render of the /core/week guide (2026-11-13) inside the real AfCoreShell: the headline, close
 * games, survival leagues, kickoffs, the embedded scoreboard and the tools disclosure. Every figure is
 * SAMPLE data. Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/week-guide             a manager with close games and survival leagues
 *   /e2e/week-guide?quiet=1     nothing close, no survival leagues, no kickoffs
 */
export default async function WeekGuideHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  return <WeekGuideHarnessClient quiet={sp.quiet === '1'} />
}
