'use client'
import type { PlayerCardIdentity } from '@/lib/core-app/playerCard'
import RecentClips from './RecentClips'
import { useMessages } from '@/components/i18n/useMessages'
import { corePartsMessages } from '@/lib/core-app/messages/coreParts'

export default function PlayerRecentClips({ player }: { player: PlayerCardIdentity }) {
  const m = useMessages(corePartsMessages)
  if (player.sport?.toUpperCase() !== 'NFL' || (!player.externalId && !player.sleeperId)) return null
  return <RecentClips key={'NFL:' + (player.externalId || player.sleeperId)} title={m.clipsRecent} request={{ kind: 'player', sport: 'NFL', ...(player.externalId ? { externalId: player.externalId } : { sleeperId: player.sleeperId! }) }} />
}

