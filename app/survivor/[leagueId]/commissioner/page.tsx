import { Suspense } from 'react'
import { SurvivorCommissionerDashboard } from '@/components/survivor/SurvivorCommissionerDashboard'

export default async function SurvivorCommissionerPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  return (
    <div className="mx-auto max-w-6xl px-3 pb-16 pt-4 sm:px-4">
      <Suspense fallback={<div className="p-8 text-center text-[var(--survivor-text-dim)]">Loading command center…</div>}>
        <SurvivorCommissionerDashboard leagueId={leagueId} />
      </Suspense>
    </div>
  )
}
