import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { DraftResultsClient } from '@/components/app/draft-results/DraftResultsClient'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ leagueId: string }>,
}): Promise<Metadata> {
  const { leagueId } = await params
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { name: true },
  })
  const title = league?.name ? `Draft Results – ${league.name} | AllFantasy` : 'Draft Results | AllFantasy'
  return { title }
}

export default async function DraftResultsPage({
  params,
}: {
  params: Promise<{ leagueId: string }>,
}) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/league/${leagueId}/draft-results`)}`)
  }
  if (!leagueId) redirect('/core')

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, sport: true, leagueVariant: true, settings: true },
  })
  if (!league) redirect('/core')

  const settings = (league.settings ?? {}) as Record<string, unknown>
  const isGuillotine =
    String(league.leagueVariant ?? '').toLowerCase() === 'guillotine' ||
    String(settings.league_type ?? '').toLowerCase() === 'guillotine'

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <DraftResultsClient
        leagueId={leagueId}
        leagueName={league.name ?? 'League'}
        sport={normalizeToSupportedSport(league.sport)}
        isGuillotine={isGuillotine}
      />
    </div>
  )
}
