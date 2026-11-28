'use client'

import '@/components/core-app/af-core.css'
import '@/components/league/league-admin.css'
import { useState } from 'react'
import { NativeUndoView } from '@/components/league-home/NativeUndoCard'

/** Sample data: a Sleeper dynasty league that switched in December and has been busy since. */
const PREVIEW = {
  status: 'open' as const, conversionId: 'e2e', convertedAt: '2026-12-02T15:00:00.000Z', fromPlatform: 'sleeper', token: 'e2e',
  discards: [
    { code: 'trades', label: '2 trades proposed or made on AllFantasy', count: 2 },
    { code: 'pickups', label: '5 waiver or free-agent pickups', count: 5 },
    { code: 'players_dropped', label: '4 players dropped', count: 4 },
    { code: 'joined', label: '1 manager who joined through an invite link loses their team', count: 1 },
  ],
}

export default function NativeUndoHarnessClient({ state }: { state: 'idle' | 'confirm' | 'nothing' }) {
  const [confirming, setConfirming] = useState(state !== 'idle')
  return (
    <div className="af-core af-league-admin min-h-screen p-4 sm:p-5" data-testid="native-undo-harness">
      <p className="mb-3 text-xs text-white/50">Sample data — harness for the Commissioner tab&apos;s undo card.</p>
      <div className="mx-auto max-w-3xl">
        <NativeUndoView
          preview={state === 'nothing' ? { ...PREVIEW, discards: [] } : PREVIEW}
          confirming={confirming}
          onStart={() => setConfirming(true)}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {}}
        />
      </div>
    </div>
  )
}
