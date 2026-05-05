import { redirect } from 'next/navigation'

/** Deep link target: advancement celebration lives on the home screen overlay. */
export default async function TournamentAdvancedPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>
}) {
  const { tournamentId } = await params
  redirect(`/tournament/${tournamentId}#advanced`)
}
