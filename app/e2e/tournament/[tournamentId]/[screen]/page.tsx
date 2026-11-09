import { notFound } from 'next/navigation'
import TournamentHarnessClient from '../../TournamentHarnessClient'
import { TOURNAMENT_HARNESS_SCREENS, type TournamentHarnessScreen } from '../../screens'

/**
 * DB-free render of the player-facing tournament app (/tournament/[id]) — the REAL provider, chrome and page for
 * each screen — for visual review. The layout payload comes from app/e2e/tournament/fixtures.ts; the capture
 * script answers GET /api/tournament/standings from the same file, and every other /api/ call gets a 503.
 * Production is refused by app/e2e/layout.tsx; the check below is the redundant second guard.
 *
 *   /e2e/tournament/e2e-tournament/home
 *   /e2e/tournament/e2e-tournament/standings   ← week 6 of the Opening Round, the viewer on the bubble
 */
export default async function TournamentHarnessPage({ params }: { params: Promise<{ tournamentId: string; screen: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { screen } = await params
  if (!(TOURNAMENT_HARNESS_SCREENS as readonly string[]).includes(screen)) notFound()
  return <TournamentHarnessClient screen={screen as TournamentHarnessScreen} />
}
