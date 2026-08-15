import { notFound } from 'next/navigation'
import E2ELeagueCommissionerChimmySettingsClient from './E2ELeagueCommissionerChimmySettingsClient'

export default function E2ELeagueCommissionerChimmySettingsPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <E2ELeagueCommissionerChimmySettingsClient />
}