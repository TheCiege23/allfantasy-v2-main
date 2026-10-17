import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { loadSeasonEntry } from '@/lib/tournament/seasonRegistration'
import { SeasonTournamentEntry } from '@/components/tournament/SeasonTournamentEntry'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tournament entry — AllFantasy', robots: { index: false, follow: false }, referrer: 'no-referrer' as const }
export default async function TournamentEntryPage({ params, searchParams }: { params: Promise<{ tournamentId: string }>; searchParams: Promise<{ invite?: string | string[] }> }) {
  const { tournamentId } = await params
  const query = await searchParams
  const token = typeof query.invite === 'string' && /^[a-f0-9]{64}$/.test(query.invite) ? query.invite : undefined
  const callback = '/tournament-entry/' + encodeURIComponent(tournamentId) + (token ? '?invite=' + token : '')
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  if (!session?.user?.id) redirect('/api/auth/signin?callbackUrl=' + encodeURIComponent(callback))
  const entry = await loadSeasonEntry(session.user.id, tournamentId, token)
  if (!entry) notFound()
  return <SeasonTournamentEntry entry={entry} token={token} />
}
