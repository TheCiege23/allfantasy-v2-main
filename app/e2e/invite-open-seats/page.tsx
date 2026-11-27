import { notFound } from 'next/navigation'
import InviteOpenSeatsHarnessClient from './InviteOpenSeatsHarnessClient'

/**
 * DB-free render of the invite panel's "Open teams" list (OpenSeatLinks in LeagueSettingsSubPanels.tsx) for a league
 * switched to AllFantasy in place, with sample data. Production is refused by app/e2e/layout.tsx.
 */
export default function InviteOpenSeatsHarnessPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <InviteOpenSeatsHarnessClient />
}
