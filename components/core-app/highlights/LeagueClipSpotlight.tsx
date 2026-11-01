'use client'
import RecentClips from './RecentClips'
import { useMessages } from '@/components/i18n/useMessages'
import { corePartsMessages } from '@/lib/core-app/messages/coreParts'

export default function LeagueClipSpotlight({ leagueIds }: { leagueIds: string[] }) {
  const m = useMessages(corePartsMessages)
  if (!leagueIds.length) return null
  return <RecentClips key={leagueIds.join(',')} compact title={m.clipsAroundLeagues} request={{ kind: 'leagues', leagueIds: leagueIds.slice(0, 5) }} />
}

