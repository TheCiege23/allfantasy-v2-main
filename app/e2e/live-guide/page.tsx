import LiveGuideHarnessClient from './LiveGuideHarnessClient'

/**
 * DB-free render of the /core/live guide (2026-11-13) inside the real AfCoreShell: the headline and
 * chips, "Matchups to watch", the plain slate heading, and the side panel (Up next, then plays capped
 * at five). Every figure is SAMPLE data. Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/live-guide             between games: one final, the next kickoff on Sunday
 *   /e2e/live-guide?mode=live   games on: starters playing now, a live game card
 *   /e2e/live-guide?league=1    inside one league (2026-11-15): the score headline, the one-line
 *                               matchup, Around the league folded, a box score folded, a pregame card
 */
export default async function LiveGuideHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  return <LiveGuideHarnessClient mode={sp.mode === 'live' ? 'live' : 'between'} league={sp.league === '1'} />
}
