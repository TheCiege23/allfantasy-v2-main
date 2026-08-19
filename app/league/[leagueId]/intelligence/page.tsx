'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { CommissionerIntelligenceHub } from '@/components/commissioner-intelligence/CommissionerIntelligenceHub'

// /league/[leagueId]/intelligence — read-only Commissioner Intelligence surface (G15.6).
export default function LeagueIntelligencePage() {
  const params = useParams<{ leagueId: string }>() ?? ({} as { leagueId: string })
  const leagueId = params.leagueId
  if (!leagueId) {
    return <main className="mx-auto max-w-3xl px-4 py-10 text-sm text-white/60">Loading…</main>
  }
  return (
    <div>
      <div className="mx-auto max-w-3xl px-4 pt-4">
        <Link href={`/league/${leagueId}`} className="text-xs text-cyan-300/90 hover:underline">
          ← Back to league
        </Link>
      </div>
      <CommissionerIntelligenceHub leagueId={leagueId} />
    </div>
  )
}
