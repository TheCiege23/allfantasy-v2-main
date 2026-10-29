import type { Metadata } from 'next'
import { SurvivorGuillotineLeague } from '@/components/survivor-guillotine/SurvivorGuillotineLeague'

export const metadata: Metadata = { title: 'Survivor Guilly | AllFantasy' }

export default async function Page({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  return <SurvivorGuillotineLeague leagueId={leagueId} />
}
