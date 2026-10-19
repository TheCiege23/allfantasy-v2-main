import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { loadSeasonBlueprint } from '@/lib/tournament/seasonBlueprintStore'
import { SeasonTournamentPlanner } from '@/components/tournament/SeasonTournamentPlanner'
import { getTournamentStandingsBoard } from '@/lib/tournament/standingsBoard'
import { TournamentStandingsBoard } from './TournamentStandingsBoard'
import { loadDivisionsHub } from '@/lib/tournament/divisions/divisionsStore'
import { DivisionsHub } from '@/components/tournament/divisions/DivisionsHub'

/**
 * The multi-league commissioner hub, for a `TournamentShell`.
 *
 * 🛑 A NEW ROUTE RATHER THAN A SCREEN UNDER `/tournament/[id]`, AND NOT BY
 * PREFERENCE. That tree's layout calls `loadTournamentLayoutPayload`, which
 * resolves a `LegacyTournament` and `notFound()`s on anything else — so a
 * `TournamentShell` id renders a 404 there no matter what the page does. The two
 * tournament generations are separate all the way up to the layout.
 *
 * ⚠ THE BOARD IS OWNER-GATED IN ITS LOADER, and returns null for both "no such
 * tournament" and "not yours" — a distinct 403 would confirm a tournament exists
 * to someone who cannot see it. This page renders that as `notFound()` for the
 * same reason.
 */
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Tournament hub — AllFantasy',
  robots: { index: false, follow: false },
}

export default async function TournamentHubPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>
}) {
  const { tournamentId } = await params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/tournament-hub/${tournamentId}`)}`)
  }

  // Divisions & conferences tournaments have their own screens (record standings,
  // wildcard pool, regional brackets). Null for any other format, or no access.
  const divisions = await loadDivisionsHub(tournamentId, userId)
  if (divisions) return <DivisionsHub view={divisions} canManage={divisions.canManage} leagueLinks={divisions.leagueLinks} />

  const blueprint = await loadSeasonBlueprint(tournamentId, userId)
  if (blueprint) return <SeasonTournamentPlanner key={blueprint.tournamentId + blueprint.revision} saved={blueprint} />

  const board = await getTournamentStandingsBoard(tournamentId, userId)
  if (!board) notFound()

  return <TournamentStandingsBoard board={board} />
}
