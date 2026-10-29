'use client'

import { useParams } from 'next/navigation'
import { SurvivorSettingsScreen } from '@/components/survivor/SurvivorSettingsScreen'

export default function SurvivorSettingsPage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  return leagueId ? <SurvivorSettingsScreen leagueId={leagueId} backHref={`/league/${encodeURIComponent(leagueId)}`} /> : null
}
