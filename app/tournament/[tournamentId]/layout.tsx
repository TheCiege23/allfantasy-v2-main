import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { loadTournamentLayoutPayload } from '@/lib/tournament/tournamentPageData'
import { TournamentUiProvider } from '@/app/tournament/[tournamentId]/TournamentUiContext'
import { TournamentChrome } from '@/app/tournament/[tournamentId]/TournamentChrome'

export default async function TournamentLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ tournamentId: string }>
}) {
  const { tournamentId } = await params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const data = await loadTournamentLayoutPayload(tournamentId, session?.user?.id ?? null)
  if (!data) {
    const leagueOnly = await prisma.league
      .findFirst({
        where: { id: tournamentId },
        select: { id: true },
      })
      .catch(() => null)
    if (leagueOnly) {
      redirect(`/league/${leagueOnly.id}`)
    }
    notFound()
  }

  return (
    <TournamentUiProvider value={{ ...data, viewerUserId: session?.user?.id ?? null }}>
      {/* `af-draft-dark`: the tournament screens are dark in every mode — the app's opt-out from the light clamp. */}
      <div className="af-draft-dark tournament-theme af-tournament-immersive relative min-h-dvh">
        <TournamentChrome>{children}</TournamentChrome>
      </div>
    </TournamentUiProvider>
  )
}
