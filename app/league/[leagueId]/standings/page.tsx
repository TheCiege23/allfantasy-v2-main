import { Suspense } from 'react'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import StandingsPage from '@/components/standings/StandingsPage'
import AppShell from '@/app/components/AppShell'

export const dynamic = 'force-dynamic'

function parseSeasonQuery(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1990 || n > 2100) return fallback
  return n
}

export default async function LeagueStandingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { leagueId } = await params
  const sp = await searchParams
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(`/league/${leagueId}/standings`)}`)

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { season: true },
  })
  if (!league) redirect('/core')

  const fallbackSeason = league.season ?? new Date().getFullYear()
  const seasonParam = typeof sp.season === 'string' ? sp.season : Array.isArray(sp.season) ? sp.season[0] : undefined
  const initialSeason = parseSeasonQuery(seasonParam, fallbackSeason)

  return (
    <AppShell leftPanel={null} rightPanel={null}>
      <div className="min-h-screen bg-[#040915] text-white">
        <Suspense
          fallback={
            <div className="flex justify-center py-16 text-sm text-white/50">Loading standings…</div>
          }
        >
          <StandingsPage leagueId={leagueId} initialSeason={initialSeason} />
        </Suspense>
      </div>
    </AppShell>
  )
}
