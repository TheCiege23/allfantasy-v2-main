import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Link from 'next/link'
import { resolveLivePlanFlags } from '@/lib/subscription/livePlanFlags'
import { C2CRosterClient } from './C2CRosterClient'

export const dynamic = 'force-dynamic'

export default async function C2CRosterPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/c2c/${leagueId}/roster`)}`)
  }

  // The live plan, not the profile flag (lib/subscription/livePlanFlags.ts).
  const plans = await resolveLivePlanFlags(session.user.id)

  return (
    <div className="min-h-screen bg-[#040915]">
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#0c0c1e]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
          <Link
            href={`/league/${leagueId}`}
            className="text-[12px] font-semibold text-cyan-300/90 hover:text-cyan-200"
            data-testid="c2c-roster-back"
          >
            ← League
          </Link>
          <span className="truncate text-[13px] font-bold text-white">C2C franchise</span>
          <span className="w-12" />
        </div>
      </header>
      <C2CRosterClient leagueId={leagueId} userId={session.user.id} hasAfSub={plans.commissioner} />
    </div>
  )
}
