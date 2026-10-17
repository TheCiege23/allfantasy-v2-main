'use client'
import type { PlayerCardIdentity } from '@/lib/core-app/playerCard'
import RecentClips from './RecentClips'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

export default function PlayerRecentClips({ player }: { player: PlayerCardIdentity }) {
  const { language } = useOptionalLanguage()
  if (player.sport?.toUpperCase() !== 'NFL' || (!player.externalId && !player.sleeperId)) return null
  return <RecentClips key={'NFL:' + (player.externalId || player.sleeperId)} title={language === 'es' ? 'Clips recientes' : 'Recent clips'} request={{ kind: 'player', sport: 'NFL', ...(player.externalId ? { externalId: player.externalId } : { sleeperId: player.sleeperId! }) }} />
}

