import { notFound } from 'next/navigation'
import { SwitchingLeagueHarnessClient } from './SwitchingLeagueHarnessClient'

/**
 * Dev-only: the switching league's cards (components/league-home/SwitchingLeagueCard.tsx) with sample states, so each
 * can be looked at without a league in season. Nothing here reads or writes: the views take their state as props.
 */
export default function SwitchingLeagueHarnessPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <SwitchingLeagueHarnessClient />
}
