'use client'

import { useState } from 'react'
import { PlayerPanel, type PlayerEntry } from '@/components/app/draft-room/PlayerPanel'

const players: PlayerEntry[] = Array.from({ length: 562 }, (_, index) => ({
  id: `nba-row-${index}`, name: index === 0 ? 'Nikola Jokic' : `NBA Player ${index}`,
  position: ['C', 'PG', 'SF', 'PF', 'SG'][index % 5], team: 'DEN', adp: index + 1,
}))
const drafted = new Set<string>()
export default function PlayerMeasurementHarness() {
  const [queued, setQueued] = useState<string[]>([])
  return <main className="h-[100dvh] bg-[#040915] text-white">
    <output data-testid="measurement-queue">{queued.join(', ')}</output>
    <div className="h-[calc(100dvh-30px)] min-h-0">
      <PlayerPanel players={players} draftedNames={drafted} sport="NBA" canDraft={false}
        onAddToQueue={p => setQueued(q => [...q, p.name])} onMakePick={() => undefined}
        isPlayerQueued={p => queued.includes(p.name)} poolLayout="card" />
    </div>
  </main>
}
