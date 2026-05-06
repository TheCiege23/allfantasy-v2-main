'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { CommissionerDraftControls } from '@/components/draft/live'

export default function DraftApiControlsHarnessClient() {
  const searchParams = useSearchParams()
  const leagueId = searchParams.get('leagueId') ?? 'e2e-draft-api-league'
  const [callbackText, setCallbackText] = useState<string>('idle')

  return (
    <main className="min-h-screen bg-[#040915] p-6 text-white">
      <h1 className="mb-4 text-xl font-semibold">E2E Draft API Controls</h1>
      <CommissionerDraftControls
        leagueId={leagueId}
        onSessionUpdated={() => setCallbackText('updated')}
      />
      <p className="mt-4 text-sm text-white/60" data-testid="draft-api-controls-callback">
        {callbackText}
      </p>
    </main>
  )
}
