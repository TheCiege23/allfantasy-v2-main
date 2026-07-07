'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ManagerIntelligenceHub } from '@/components/manager-intelligence/ManagerIntelligenceHub'

// /league/[leagueId]/manager-hub — unified, display-only Manager Intelligence Hub
// (Decision OS Manager Intelligence Platform, Phase 1). Consumes existing
// intelligence sources only; changes no replay/recommendation logic.
export default function ManagerHubPage() {
  const params = useParams<{ leagueId: string }>() ?? ({} as { leagueId: string })
  const leagueId = params.leagueId
  if (!leagueId) {
    return <main className="mx-auto max-w-3xl px-4 py-10 text-sm text-white/60">Loading…</main>
  }
  return (
    <div>
      <div className="mx-auto max-w-4xl px-4 pt-4">
        <Link href={`/league/${leagueId}`} className="text-xs text-cyan-300/90 hover:underline">
          ← Back to league
        </Link>
      </div>
      <ManagerIntelligenceHub leagueId={leagueId} />
    </div>
  )
}
