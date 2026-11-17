import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import MockDraftSimulatorWrapper from '@/components/mock-draft/MockDraftSimulatorWrapper'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Mock Draft Simulator – AllFantasy',
  description: 'AI-powered mock draft simulator that learns real draft tendencies from your league.',
}

export default async function MockDraftSimulatorPage() {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) redirect('/login?callbackUrl=/mock-draft-simulator')

  const leagues = await prisma.league.findMany({
    where: { userId: session.user.id },
    select: { id: true, name: true, platformLeagueId: true, platform: true, leagueSize: true, isDynasty: true, scoring: true, sport: true },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  })

  return (
    <div className="min-h-screen bg-[#0a0a0f] py-12 pb-24">
      <div className="container mx-auto px-4 max-w-7xl">
        <h1 className="text-4xl sm:text-5xl font-bold text-center bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500 bg-clip-text text-transparent mb-3">
          Mock Draft Simulator
        </h1>
        <p className="text-center text-gray-400 text-base sm:text-xl mb-10">
          Powered by Sleeper data + Chimmy that learns real draft tendencies
        </p>

        <MockDraftSimulatorWrapper
          leagues={leagues.map((l) => ({
            id: l.id,
            name: l.name || 'Unnamed League',
            platform: l.platform,
            leagueSize: l.leagueSize ?? 12,
            isDynasty: l.isDynasty,
            scoring: l.scoring,
            sport: l.sport ?? undefined,
          }))}
        />
      </div>
    </div>
  )
}
