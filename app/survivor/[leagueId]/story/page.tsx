'use client'

import { useParams } from 'next/navigation'
import { SurvivorSeasonStory } from '@/components/survivor/SurvivorSeasonStory'

export default function SurvivorSeasonStoryPage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  return leagueId ? <SurvivorSeasonStory leagueId={leagueId} backHref={`/league/${encodeURIComponent(leagueId)}`} /> : null
}
