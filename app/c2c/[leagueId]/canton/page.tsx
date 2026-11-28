import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { C2CPageFrame } from '@/app/c2c/components/C2CPageFrame'
import { authOptions } from '@/lib/auth'
import { resolveLivePlanFlags } from '@/lib/subscription/livePlanFlags'
import { C2CRosterClient } from '../roster/C2CRosterClient'

export const dynamic = 'force-dynamic'

export default async function C2CCantonPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/c2c/${leagueId}/canton`)}`)
  }

  // The live plan, not the profile flag (lib/subscription/livePlanFlags.ts).
  const plans = await resolveLivePlanFlags(session.user.id)

  return (
    <C2CPageFrame leagueId={leagueId} title="🏙 Canton" tone="canton">
      <C2CRosterClient
        leagueId={leagueId}
        userId={session.user.id}
        hasAfSub={plans.commissioner}
        initialViewMode="canton"
      />
    </C2CPageFrame>
  )
}
