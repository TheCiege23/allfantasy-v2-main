'use client'

import { useCallback, useState } from 'react'
import { QueuePanel } from '@/components/app/draft-room/QueuePanel'
import type { QueueEntry } from '@/lib/live-draft-engine/types'

export default function E2EDraftQueueHarnessClient() {
  const [queue, setQueue] = useState<QueueEntry[]>([
    { playerName: 'Queue Player One', position: 'RB', team: 'NYJ', playerId: 'e2e-q1' },
  ])
  const [autoPickFromQueue, setAutoPickFromQueue] = useState(false)
  const [awayMode, setAwayMode] = useState(false)

  const onRemove = useCallback((index: number) => {
    setQueue((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const onReorder = useCallback((fromIndex: number, toIndex: number) => {
    setQueue((prev) => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])

  const onDraftFromQueue = useCallback((entry: QueueEntry) => {
    setQueue((prev) => prev.filter((e) => e.playerId !== entry.playerId))
  }, [])

  return (
    <div className="min-h-screen bg-[#040915] p-4 text-white">
      <h1 className="mb-4 text-lg font-semibold text-white">E2E draft queue harness</h1>
      <div className="mx-auto max-w-lg">
        <QueuePanel
          queue={queue}
          canDraft
          onRemove={onRemove}
          onReorder={onReorder}
          onDraftFromQueue={onDraftFromQueue}
          autoPickFromQueue={autoPickFromQueue}
          onAutoPickFromQueueChange={setAutoPickFromQueue}
          awayMode={awayMode}
          onAwayModeChange={setAwayMode}
          autoPickEnabled
        />
      </div>
    </div>
  )
}
