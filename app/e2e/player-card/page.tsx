import { notFound } from 'next/navigation'
import PlayerCardHarnessClient from './PlayerCardHarnessClient'

/**
 * DB-free harness for the league player card (components/core-app/player-card/PlayerCardSheet.tsx).
 *
 *   /e2e/player-card?sport=NFL|NBA|MLB&who=mine|fa|theirs[&confirm=1]
 *
 * Fixture data only: no route is called, so the card renders the same way on any machine. `confirm=1`
 * opens the Drop confirm sheet on your own player.
 */
export default async function PlayerCardHarnessPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const q = await props.searchParams
  const sport = (q.sport ?? 'NFL').toUpperCase()
  const who = q.who === 'fa' || q.who === 'theirs' ? q.who : 'mine'
  return <PlayerCardHarnessClient sport={sport} who={who} confirm={q.confirm === '1'} />
}
