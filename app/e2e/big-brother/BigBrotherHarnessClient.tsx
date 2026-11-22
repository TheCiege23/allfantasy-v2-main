'use client'

import { BigBrotherHome } from '@/components/big-brother/BigBrotherHome'
import type { BigBrotherView } from '@/components/big-brother/types'

/** Harness only (app/e2e is 404 in production). The fixture viewer is the commissioner, so every view shows. */
export default function BigBrotherHarnessClient({ leagueId, view }: { leagueId: string; view: BigBrotherView }) {
  return (
    <div className="min-h-screen bg-[#040915] px-3 py-4 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <BigBrotherHome leagueId={leagueId} isCommissioner initialView={view} />
      </div>
    </div>
  )
}
