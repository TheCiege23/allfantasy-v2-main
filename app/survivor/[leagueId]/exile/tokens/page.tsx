'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ExileTokenWallet } from '@/components/league/survivor/ExileTokenWallet'
export default function SurvivorExileTokensPage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  return <div className="space-y-6 px-3 pb-28 pt-4 md:px-6">
    <Link href={`/survivor/${leagueId}/exile`} className="sv-link inline-flex min-h-11 items-center text-sm">← Back to Exile Island</Link>
    <ExileTokenWallet leagueId={leagueId} />
    <p className="text-sm text-white/50">Tokens are settled after verified Exile results. Returning managers rebuild their main-island roster through waivers.</p>
  </div>
}
