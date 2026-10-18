import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { loadJoinView } from '@/lib/tournament/divisions/lifecycle'
import { TournamentJoin } from '@/components/tournament/divisions/TournamentJoin'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Join the tournament — AllFantasy', robots: { index: false, follow: false }, referrer: 'no-referrer' as const }

/** Invite landing page for a divisions & conferences tournament. `?ref=<username>` marks a personal invite link. */
export default async function DivisionsJoinPage({ params, searchParams }: { params: Promise<{ tournamentId: string }>; searchParams: Promise<{ ref?: string | string[] }> }) {
  const { tournamentId } = await params
  const q = await searchParams
  const ref = typeof q.ref === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(q.ref) ? q.ref : null
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const callback = `/tournament-hub/${encodeURIComponent(tournamentId)}/join${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`
  if (!session?.user?.id) redirect('/api/auth/signin?callbackUrl=' + encodeURIComponent(callback))
  const view = await loadJoinView(session.user.id, tournamentId, ref)
  if (!view) notFound()
  return <TournamentJoin view={view} refName={ref} />
}
