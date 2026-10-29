'use client'

import { useParams } from 'next/navigation'
import { TribeShuffle } from '@/components/survivor/late/TribeShuffle'

export default function SurvivorSwapPage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  return (
    <div className="px-3 pb-28 pt-4 md:px-6 md:pb-10">
      {leagueId ? <TribeShuffle leagueId={leagueId} initialTab="swap" /> : null}
    </div>
  )
}
