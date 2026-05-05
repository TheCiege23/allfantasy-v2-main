import { redirect, permanentRedirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function LegacyAppLeagueDraftRedirect({
  params,
}: {
  params: Promise<{ leagueId: string }>
}) {
  const { leagueId } = await params
  if (!leagueId) redirect('/dashboard')
  permanentRedirect(`/league/${leagueId}/draft`)
}
