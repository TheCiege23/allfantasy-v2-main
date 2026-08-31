import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NewTournamentClient, type PickableLeague } from './NewTournamentClient'

/**
 * Pick the leagues that make up a tournament.
 *
 * ⚠ A STATIC SEGMENT BESIDE `[tournamentId]`, and Next.js gives it precedence —
 * so `/tournament-hub/new` renders this rather than looking for a tournament
 * whose id is the word "new".
 */
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'New tournament — AllFantasy',
  robots: { index: false, follow: false },
}

export default async function NewTournamentPage() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) redirect('/api/auth/signin?callbackUrl=%2Ftournament-hub%2Fnew')

  const leagues = await prisma.league.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      platform: true,
      season: true,
      _count: { select: { teams: true } },
    },
    orderBy: [{ season: 'desc' }, { name: 'asc' }],
  })

  /*
   * ⚠ SHOWN AS TAKEN RATHER THAN HIDDEN. `TournamentLeague.leagueId` is globally
   * unique, so a league already in a tournament cannot join another — and a
   * commissioner looking for a league that has silently vanished from the list
   * has no way to find out why.
   */
  const taken = await prisma.tournamentLeague.findMany({
    where: { leagueId: { in: leagues.map((l) => l.id) } },
    select: { leagueId: true, tournament: { select: { name: true } } },
  })
  const takenBy = new Map(
    taken.map((t) => [t.leagueId ?? '', t.tournament?.name ?? 'another tournament']),
  )

  const pickable: PickableLeague[] = leagues.map((l) => ({
    id: l.id,
    name: l.name?.trim() || 'Untitled league',
    platform: String(l.platform ?? '').toLowerCase(),
    season: l.season ?? null,
    teamCount: l._count.teams,
    takenBy: takenBy.get(l.id) ?? null,
  }))

  return <NewTournamentClient leagues={pickable} />
}
