'use client'

import { useState } from 'react'
import { DraftBoard } from '@/components/app/draft-room/DraftBoard'
import { DraftBoardPreview } from '@/components/app/draft-room/DraftBoardPreview'
import { DraftRightDockTabs } from '@/components/app/draft-room/DraftRightDockTabs'
import { QueuePanel } from '@/components/app/draft-room/QueuePanel'
import { getSlotInRoundForOverall } from '@/lib/live-draft-engine/DraftOrderService'
import type { DraftPickSnapshot } from '@/lib/live-draft-engine/types'

const sports = [
  ['NFL', ['RB', 'WR', 'QB', 'TE']], ['NBA', ['PG', 'SG', 'SF', 'C']],
  ['NHL', ['C', 'LW', 'D', 'G']], ['MLB', ['SP', 'SS', 'OF', '1B']],
  ['NCAAF', ['RB', 'WR', 'QB', 'TE']], ['NCAAB', ['PG', 'SG', 'SF', 'C']],
  ['SOCCER', ['GK', 'DEF', 'MID', 'FWD']],
] as const
const teams = Array.from({ length: 12 }, (_, index) => ({
  id: String(index + 1), slot: index + 1, name: `Team ${index + 1}`, isUser: index === 0,
}))
const slotOrder = teams.map(team => ({ slot: team.slot, rosterId: team.id, displayName: team.name }))
const noop = () => {}

/** The /e2e layout makes this route unavailable in production. Renders the real board components. */
export default function DraftBoardCoveragePage() {
  const [mode, setMode] = useState('live')
  return <main className="space-y-4 bg-[#040915] p-2 text-white">
    <label className="block">Board renderer <select aria-label="Board renderer" value={mode}
      onChange={event => setMode(event.target.value)} className="bg-slate-800 p-2">
      <option value="live">Live snake</option><option value="mock">Mock snake</option>
      <option value="linear">Mock linear</option><option value="auction">Mock auction</option>
    </select></label>
    {sports.map(([sport, positions]) => {
      const draftType = mode === 'linear' || mode === 'auction' ? mode : 'snake'
      const picks = Array.from({ length: 14 }, (_, index): DraftPickSnapshot => {
        const overall = index + 1
        const slot = getSlotInRoundForOverall({ overall, teamCount: 12, draftType, thirdRoundReversal: false })
        return { id: String(overall), overall, round: Math.ceil(overall / 12), slot, rosterId: String(slot),
          displayName: `Team ${slot}`, playerName: `Example Player ${overall}`, position: positions[index % positions.length]!,
          team: 'FA', playerId: null, byeWeek: null, source: 'mock', tradedPickMeta: null,
          pickLabel: `${Math.ceil(overall / 12)}.${(index % 12) + 1}`, createdAt: '', amount: mode === 'auction' ? 17 : null }
      })
      return <section key={sport} data-testid={`coverage-${sport}`}>
        <h2>{sport}</h2>
        {mode === 'live' ? <DraftBoard picks={picks} slotOrder={slotOrder} teamCount={12} rounds={3}
          sport={sport} draftType="snake" thirdRoundReversal={false} currentOverallPick={15} />
          : <DraftBoardPreview teams={teams} picks={picks.map(pick => ({ ...pick, headshotUrl: pick.playerImageUrl }))}
            teamCount={12} rounds={3} sport={sport} draftType={draftType} currentOverall={15} />}
      </section>
    })}
    <section data-testid="coverage-narrow-dock" className="h-[420px] w-full max-w-[360px]">
      <DraftRightDockTabs queueCount={2} queueBody={<QueuePanel
        queue={[{ playerName: 'Example Guard', playerId: 'one', position: 'PG', team: 'FA' },
          { playerName: 'Example Wing', playerId: 'two', position: 'SF', team: 'FA' }]}
        canDraft onRemove={noop} onReorder={noop} autoPickFromQueue={false} onAutoPickFromQueueChange={noop}
        awayMode={false} onAwayModeChange={noop} presentationVariant="redraft_snake" />}
        intelBody={<div>Intel</div>} chimmyBody={<div>Chimmy</div>} rosterBody={<div>Roster</div>}
        warRoomBody={<div>AF Legacy</div>} activityBody={<div>Activity</div>} chatBody={<div>Chat</div>} />
    </section>
  </main>
}
