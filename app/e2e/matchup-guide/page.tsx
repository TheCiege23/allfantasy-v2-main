import MatchupGuideHarnessClient from './MatchupGuideHarnessClient'

/**
 * DB-free render of a league's Matchup page with the 2026-11-13 guide. Every figure is SAMPLE data.
 * Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/matchup-guide                  live, behind so far
 *   /e2e/matchup-guide?state=upcoming   before kickoff
 *   /e2e/matchup-guide?state=final      a finished week
 */
export default async function MatchupGuideHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const state = sp.state === 'upcoming' ? 'upcoming' : sp.state === 'final' ? 'final' : 'live'
  return <MatchupGuideHarnessClient state={state} />
}
