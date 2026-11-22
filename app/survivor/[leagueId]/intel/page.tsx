'use client'

import { useParams } from 'next/navigation'
import { SurvivorPremiumCommandCenterPanel } from '@/components/survivor/SurvivorPremiumCommandCenterPanel'

/** Premium intel for every manager: the player-lens tiles, locked or opened by the server. */
export default function SurvivorIntelPage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  return (
    <div className="px-3 pb-28 pt-4 md:px-6 md:pb-10" data-testid="survivor-intel-page">
      {leagueId ? <SurvivorPremiumCommandCenterPanel leagueId={leagueId} tokensRemaining={null} tilesOnly /> : null}
    </div>
  )
}
