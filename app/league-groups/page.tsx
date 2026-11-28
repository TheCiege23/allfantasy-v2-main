import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { listLeagueGroupsFor } from '@/lib/league-groups/leagueGroupsRead'
import { LeagueGroupsView } from '@/components/league-groups/LeagueGroupsView'
import '../tournament-hub/[tournamentId]/tournament-hub.css'

/**
 * League groups — every league a commissioner has put under one name, side by side.
 * The rules and the storage are in lib/league-groups/leagueGroups.ts.
 *
 * It borrows the tournament hub's stylesheet: same kind of screen (a list of leagues that belong
 * together), and a second look-alike stylesheet is how two screens drift apart.
 */
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'League groups — AllFantasy',
  robots: { index: false, follow: false },
}

export default async function LeagueGroupsPage() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) redirect('/api/auth/signin?callbackUrl=%2Fleague-groups')
  const groups = await listLeagueGroupsFor(userId).catch(() => null)
  return <LeagueGroupsView groups={groups} />
}
