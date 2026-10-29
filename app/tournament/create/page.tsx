import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { TournamentPlanFlow } from '@/components/tournament/divisions/TournamentPlanFlow'

export default async function TournamentCreatePage() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) redirect('/api/auth/signin?callbackUrl=%2Ftournament%2Fcreate')
  return <TournamentPlanFlow />
}
