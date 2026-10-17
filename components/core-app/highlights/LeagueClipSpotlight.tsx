'use client'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import RecentClips from './RecentClips'

export default function LeagueClipSpotlight({ leagueIds }: { leagueIds: string[] }) {
  const { language } = useOptionalLanguage()
  if (!leagueIds.length) return null
  return <RecentClips key={leagueIds.join(',')} compact title={language === 'es' ? 'Clips de tus ligas' : 'Around your leagues'} request={{ kind: 'leagues', leagueIds: leagueIds.slice(0, 5) }} />
}

