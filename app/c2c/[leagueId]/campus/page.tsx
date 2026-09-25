import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Link from 'next/link'
import { resolveLivePlanFlags } from '@/lib/subscription/livePlanFlags'
import { C2CRosterClient } from '../roster/C2CRosterClient'

export const dynamic = 'force-dynamic'

export default async function C2CCampusPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/c2c/${leagueId}/campus`)}`)
  }

  // The live plan, not the profile flag (lib/subscription/livePlanFlags.ts).
  const plans = await resolveLivePlanFlags(session.user.id)

  return (
    <div className="min-h-screen bg-[#040915]">
      <header className="sticky top-0 z-20 border-b border-violet-500/20 bg-violet-950/40 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
          <Link href={`/league/${leagueId}`} className="text-[12px] font-semibold text-violet-200/90 hover:text-violet-100">
            ← League
          </Link>
          <span className="truncate text-[13px] font-bold text-violet-100">🎓 Campus</span>
          <span className="w-12" />
        </div>
      </header>
      <C2CRosterClient
        leagueId={leagueId}
        userId={session.user.id}
        hasAfSub={plans.commissioner}
        initialViewMode="campus"
      />
    </div>
  )
}
