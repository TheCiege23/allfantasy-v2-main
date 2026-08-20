import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import LeagueFeed from '@/components/feed/LeagueFeed'

/**
 * 10c — the league feed. Works for AF-hosted and imported leagues alike; the event source is
 * invisible to the view (build rule 4).
 *
 * Gated with `resolveLeagueAccess`, the canonical membership predicate — not
 * `LeagueTeam.platformUserId`, the nullable lookalike that rejected 55.7% of real members when it
 * was used as a gate.
 */

export const dynamic = 'force-dynamic'

export default async function LeagueFeedPage({
  params,
}: {
  params: Promise<{ leagueId: string }>
}) {
  const { leagueId } = await params
  if (!leagueId) redirect('/dashboard')

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/league/${leagueId}/feed`)}`)
  }

  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) redirect('/dashboard')

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { name: true },
  })
  if (!league) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-[#040915] text-white">
      <LeagueFeed leagueId={leagueId} leagueName={league.name ?? 'Your league'} />
    </div>
  )
}
