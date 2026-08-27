'use client'

import WaiverWirePage from '@/components/waiver-wire/WaiverWirePage'

export interface SportAwareWaiverWireProps {
  leagueId: string
}

/**
 * SportAwareWaiverWire — sport-aware waiver surface wrapper.
 * WaiverWirePage resolves sport-specific pools/filters from league settings.
 *
 * The lineup-gain board briefly lived here and now sits on the /core Waivers Center
 * (`components/core-app/WaiverLineupBoard.tsx`), which is the surface managers actually use.
 * Two copies of the same ranking on two waiver pages would drift, so this one is a plain
 * passthrough again.
 */
export function SportAwareWaiverWire({ leagueId }: SportAwareWaiverWireProps) {
  return <WaiverWirePage leagueId={leagueId} />
}
