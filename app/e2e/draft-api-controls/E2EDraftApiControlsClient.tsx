'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CommissionerDraftControls } from '@/components/draft/live/CommissionerDraftControls'

function E2EDraftApiControlsInner() {
  const searchParams = useSearchParams()
  const leagueId = searchParams.get('leagueId') ?? ''
  const [callbackState, setCallbackState] = useState('idle')

  return (
    <div className="min-h-screen bg-[#040915] p-4 text-white">
      <h1 className="mb-4 text-lg font-semibold">E2E draft API controls</h1>
      <CommissionerDraftControls leagueId={leagueId} onSessionUpdated={() => setCallbackState('updated')} />
      <p className="mt-4 text-sm text-white/70" data-testid="draft-api-controls-callback">
        {callbackState}
      </p>
    </div>
  )
}

export default function E2EDraftApiControlsClient() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#040915] p-4 text-white/75">Loading…</div>}>
      <E2EDraftApiControlsInner />
    </Suspense>
  )
}
