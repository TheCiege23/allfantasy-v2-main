import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Link from 'next/link'
import { resolveLivePlanFlags } from '@/lib/subscription/livePlanFlags'
import { DevyRosterClient } from './DevyRosterClient'

export const dynamic = 'force-dynamic'

export default async function DevyRosterPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/devy/${leagueId}/roster`)}`)
  }

  // The live plan, not the profile flag (lib/subscription/livePlanFlags.ts).
  const plans = await resolveLivePlanFlags(session.user.id)

  return (
    <div className="min-h-screen bg-[var(--surface)]">
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[var(--surface)] px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
          <Link
            href={`/league/${leagueId}`}
            className="text-[12px] font-semibold text-[var(--accent)] hover:text-[var(--accent)]"
            data-testid="devy-roster-back"
          >
            ← League
          </Link>
          <span className="truncate text-[13px] font-bold text-[var(--text)]">Devy roster</span>
          <span className="w-12" />
        </div>
      </header>
      <DevyRosterClient
        leagueId={leagueId}
        userId={session.user.id}
        hasAfSub={plans.pro || plans.commissioner}
      />
    </div>
  )
}
