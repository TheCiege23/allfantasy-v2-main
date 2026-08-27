'use client'

import WaiverWirePage from '@/components/waiver-wire/WaiverWirePage'
import { WaiverBoardPanel } from '@/components/waiver-wire/WaiverBoardPanel'

export interface SportAwareWaiverWireProps {
  leagueId: string
}

/**
 * SportAwareWaiverWire — sport-aware waiver surface wrapper.
 * WaiverWirePage resolves sport-specific pools/filters from league settings.
 *
 * The board sits ABOVE the wire rather than inside it: `WaiverWirePage` owns claims, FAAB,
 * watchlists and automation — the mechanics of getting a player — and has never answered the
 * question that comes first, which is who is worth getting. Mounting here keeps that 1,550-line
 * file untouched and lets the panel remove itself when it has nothing to say.
 */
export function SportAwareWaiverWire({ leagueId }: SportAwareWaiverWireProps) {
  return (
    <div className="flex flex-col gap-4">
      <WaiverBoardPanel leagueId={leagueId} />
      <WaiverWirePage leagueId={leagueId} />
    </div>
  )
}
