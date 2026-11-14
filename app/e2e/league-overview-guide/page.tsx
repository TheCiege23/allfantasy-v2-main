import { notFound } from 'next/navigation'
import LeagueOverviewGuideHarnessClient from './LeagueOverviewGuideHarnessClient'

/**
 * DB-free render of the league Overview guide (2026-11-13) — the REAL LeagueHome inside the REAL
 * AfCoreShell, on the redraft-core home fixture (SAMPLE data). Production is refused here and by
 * app/e2e/layout.tsx.
 *
 *   /e2e/league-overview-guide                 ← a head-to-head league
 *   /e2e/league-overview-guide?format=guillotine ← an elimination league, read from the rail's standing
 */
export default async function LeagueOverviewGuideHarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  return <LeagueOverviewGuideHarnessClient format={sp.format === 'guillotine' ? 'guillotine' : 'h2h'} />
}
