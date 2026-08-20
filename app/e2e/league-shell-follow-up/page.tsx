import { notFound } from 'next/navigation'
import { LeagueShellFollowUpHarnessClient } from './LeagueShellFollowUpHarnessClient'

export default function LeagueShellFollowUpHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <LeagueShellFollowUpHarnessClient />
}
