import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { loadReveal } from '@/lib/tournament/divisions/lifecycle'
import { TournamentReveal } from '@/components/tournament/divisions/TournamentReveal'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your league — AllFantasy', robots: { index: false, follow: false } }

/** League reveal after registration closes. Plays once (revealSeenAt); Replay is always there. */
export default async function DivisionsRevealPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) redirect('/api/auth/signin?callbackUrl=' + encodeURIComponent(`/tournament-hub/${tournamentId}/reveal`))
  const view = await loadReveal(session.user.id, tournamentId)
  if (!view) notFound()
  return <TournamentReveal view={view} />
}
