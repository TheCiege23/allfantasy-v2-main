'use client'
import { useParams } from 'next/navigation'
import BehaviorProfilesPanel from '@/components/app/settings/BehaviorProfilesPanel'
export default function CompetitiveEdgePage() {
  const params = useParams<{ leagueId: string }>()
  return <main className="mx-auto max-w-4xl p-4"><BehaviorProfilesPanel leagueId={params?.leagueId ?? ''} /></main>
}
