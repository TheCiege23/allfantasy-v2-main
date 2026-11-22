'use client'
import type { MyTeamData } from '@/lib/core-app/myTeam'
import RecentClips from './RecentClips'
import { useMessages } from '@/components/i18n/useMessages'
import { corePartsMessages } from '@/lib/core-app/messages/coreParts'

export default function MyTeamRecentClips({ data }: { data: MyTeamData }) {
  const m = useMessages(corePartsMessages)
  const players = [
    ...(data.starters.available ? data.starters.data.flatMap(slot => slot.player ? [slot.player] : []) : []),
    ...(data.bench.available ? data.bench.data : []),
    ...(data.ir.available ? data.ir.data : []),
    ...(data.taxi.available ? data.taxi.data : []),
  ]
  const playerIds = [...new Set(players.filter(p => p.sport?.toUpperCase() === 'NFL').map(p => p.sleeperId).filter(Boolean))].sort().slice(0, 60)
  if (!playerIds.length) return null
  return <RecentClips key={data.league.id + ':' + playerIds.join(',')} title={m.clipsMyTeam} request={{ kind: 'roster', playerIds }} />
}

