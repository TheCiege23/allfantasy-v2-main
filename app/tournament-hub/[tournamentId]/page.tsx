import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { getTournamentStandingsBoard } from '@/lib/tournament/standingsBoard'
import { TournamentStandingsBoard } from './TournamentStandingsBoard'

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

  const board = await getTournamentStandingsBoard(tournamentId, userId)
  if (!board) notFound()

  return <TournamentStandingsBoard board={board} />
}
