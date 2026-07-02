'use client'

import { useState } from 'react'

import { CommissionerDraftControls } from '@/components/draft/live/CommissionerDraftControls'

export default function E2EDraftApiControlsClient({ leagueId }: { leagueId: string }) {
  const [status, setStatus] = useState('idle')

  return (
    <div className="min-h-screen bg-[#040915] p-4 text-white">
      <h1 className="mb-4 text-lg font-semibold">E2E draft API controls</h1>
      <CommissionerDraftControls leagueId={leagueId} onSessionUpdated={() => setStatus('updated')} />
      <p className="mt-4 text-sm text-white/70" data-testid="draft-api-controls-callback">
        {status}
      </p>
    </div>
  )
}
