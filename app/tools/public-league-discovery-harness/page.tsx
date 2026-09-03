import { notFound } from 'next/navigation'
import PublicLeagueDiscoveryHarnessClient from '@/app/e2e/public-league-discovery/PublicLeagueDiscoveryHarnessClient'

export default function PublicLeagueDiscoveryHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <PublicLeagueDiscoveryHarnessClient />
}
