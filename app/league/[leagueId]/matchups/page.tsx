import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import MatchupsPage from '@/components/matchups/MatchupsPage'
import AppShell from '@/app/components/AppShell'

export const dynamic = 'force-dynamic'

export default async function LeagueMatchupsPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(`/league/${leagueId}/matchups`)}`)

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { season: true },
  })
  if (!league) redirect('/core')

  return (
    <AppShell leftPanel={null} rightPanel={null}>
      <div className="min-h-screen bg-[#040915] text-white">
        <MatchupsPage leagueId={leagueId} initialSeason={league.season} initialWeek={1} />
      </div>
    </AppShell>
  )
}
