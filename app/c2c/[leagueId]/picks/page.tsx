import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { C2CPageFrame } from '@/app/c2c/components/C2CPageFrame'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { C2CPicksClient } from './C2CPicksClient'

export const dynamic = 'force-dynamic'

export default async function C2CPicksPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/c2c/${leagueId}/picks`)}`)
  }

  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    include: { rosters: true },
  })
  const rosterId = season?.rosters?.find((r) => r.ownerId === userId)?.id ?? null

  return (
    <C2CPageFrame leagueId={leagueId} title="C2C picks">
      <C2CPicksClient leagueId={leagueId} rosterId={rosterId} />
    </C2CPageFrame>
  )
}
