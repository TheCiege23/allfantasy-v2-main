import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessLeague } from '@/lib/draft/access'
import { getDraftIdFromSettings } from '@/app/league/[leagueId]/components/league-settings-modal-utils'

export const dynamic = 'force-dynamic'

export default async function LeagueDraftResolverPage({
  params,
}: {
  params: Promise<{ leagueId: string }>
}) {
  const { leagueId } = await params
  if (!leagueId) redirect('/dashboard')

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/league/${leagueId}/draft`)}`)
  }

  const ok = await canAccessLeague(leagueId, userId)
  if (!ok) redirect('/dashboard')

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { id: true, sport: true, leagueSize: true, settings: true },
  })
  if (!league) redirect('/dashboard')

  const sleeperDraftId = getDraftIdFromSettings(league.settings)

  const ds = await prisma.draftSession.upsert({
    where: { leagueId },
    create: {
      leagueId,
      sportType: String(league.sport),
      teamCount: league.leagueSize ?? 12,
      rounds: 15,
      sleeperDraftId: sleeperDraftId ?? undefined,
      sessionKind: 'live',
    },
    update: {
      sportType: String(league.sport),
      teamCount: league.leagueSize ?? 12,
      ...(sleeperDraftId ? { sleeperDraftId } : {}),
    },
  })

  redirect(`/drafts/${ds.id}`)
}
