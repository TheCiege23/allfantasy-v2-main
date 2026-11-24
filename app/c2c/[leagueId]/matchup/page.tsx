import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { C2CPageFrame } from '@/app/c2c/components/C2CPageFrame'
import { authOptions } from '@/lib/auth'
import { C2CMatchupClient } from './C2CMatchupClient'

export const dynamic = 'force-dynamic'

export default async function C2CMatchupPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/c2c/${leagueId}/matchup`)}`)
  }

  return (
    <C2CPageFrame leagueId={leagueId} title="C2C matchup">
      <C2CMatchupClient leagueId={leagueId} userId={session.user.id} />
    </C2CPageFrame>
  )
}
