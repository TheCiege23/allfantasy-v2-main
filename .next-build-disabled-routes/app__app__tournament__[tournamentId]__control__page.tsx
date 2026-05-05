import { permanentRedirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function LegacyAppTournamentControlRedirect({
  params,
}: {
  params: Promise<{ tournamentId: string }>
}) {
  const { tournamentId } = await params
  permanentRedirect(`/tournament/${tournamentId}/control`)
}
