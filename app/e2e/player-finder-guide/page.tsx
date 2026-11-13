import { notFound } from 'next/navigation'
import PlayerFinderGuideHarnessClient from './PlayerFinderGuideHarnessClient'

/**
 * DB-free render of the Player Finder guide (2026-11-13), on SAMPLE data, for visual review. Production
 * is refused by app/e2e/layout.tsx; this check is the redundant second guard that file describes.
 *
 *   /e2e/player-finder-guide              ← the home: headline, game day, your players
 *   /e2e/player-finder-guide?view=player  ← where an injury alert lands: the player and every league
 *   /e2e/player-finder-guide?view=team    ← a team search, "Bills"
 */
export default async function PlayerFinderGuideHarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  const view = sp.view === 'player' || sp.view === 'team' ? sp.view : 'home'
  return <PlayerFinderGuideHarnessClient view={view} />
}
