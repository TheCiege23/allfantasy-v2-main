'use client'

import { useState } from 'react'
import { QueuePanel } from '@/components/app/draft-room/QueuePanel'
import type { QueueEntry } from '@/lib/live-draft-engine/types'

const INITIAL_QUEUE: QueueEntry[] = [
  { playerName: 'Queue Player One', position: 'RB', team: 'NYJ', playerId: 'qp1' },
  { playerName: 'Queue Player Two', position: 'WR', team: 'DAL', playerId: 'qp2' },
  { playerName: 'Queue Player Three', position: 'QB', team: 'KC', playerId: 'qp3' },
]

export default function DraftQueueHarnessClient() {
  const [queue, setQueue] = useState<QueueEntry[]>(INITIAL_QUEUE)
  const [autoPickFromQueue, setAutoPickFromQueue] = useState(false)
  const [awayMode, setAwayMode] = useState(false)

  const handleRemove = (index: number) => {
    setQueue((prev) => prev.filter((_, i) => i !== index))
  }

  const handleReorder = (fromIndex: number, toIndex: number) => {
    setQueue((prev) => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }

  const handleDraftFromQueue = (entry: QueueEntry) => {
    setQueue((prev) => prev.filter((e) => e.playerName !== entry.playerName))
  }

  return (
    <main className="min-h-screen bg-[#040915] p-6 text-white">
      <h1 className="mb-4 text-xl font-semibold">E2E Draft Queue Harness</h1>
      <div className="max-w-md">
        <QueuePanel
          queue={queue}
          canDraft
          onRemove={handleRemove}
          onReorder={handleReorder}
          onDraftFromQueue={handleDraftFromQueue}
          autoPickFromQueue={autoPickFromQueue}
          onAutoPickFromQueueChange={setAutoPickFromQueue}
          awayMode={awayMode}
          onAwayModeChange={setAwayMode}
          autoPickEnabled
        />
      </div>
    </main>
  )
}
