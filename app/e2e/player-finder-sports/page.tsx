import { notFound } from 'next/navigation'
import { normalizeFinderSport } from '@/lib/core-app/finderSports'
import PlayerFinderSportsHarnessClient from './PlayerFinderSportsHarnessClient'

/**
 * DB-free render of the Player Finder "My players" home with its sport tabs (2026-11-11), on sample
 * multi-sport data, for visual review. Production is refused by app/e2e/layout.tsx; this check is the
 * redundant second guard that file describes.
 *
 *   /e2e/player-finder-sports            ← All sports
 *   /e2e/player-finder-sports?sport=NBA  ← one sport's tab
 */
export default async function PlayerFinderSportsHarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  return <PlayerFinderSportsHarnessClient sport={normalizeFinderSport(sp.sport)} />
}
