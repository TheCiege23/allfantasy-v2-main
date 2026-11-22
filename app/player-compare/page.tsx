import { permanentRedirect } from 'next/navigation'

/**
 * Retired 2026-11-12 (owner's call): the Player Comparison Lab is the one player-comparison tool.
 * This page compared two players and, from a league, added the league's start/sit read — the Lab
 * now does both (LeagueStartVsCard) and runs on arrival when both players are in the link. A 308
 * keeps bookmarks and old links working, with the players, sport and league carried over.
 */
const CARRIED = ['playerA', 'playerB', 'sport', 'leagueId'] as const

export default async function PlayerComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const q = new URLSearchParams()
  for (const key of CARRIED) {
    const raw = sp[key]
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
    if (value) q.set(key, value)
  }
  const qs = q.toString()
  permanentRedirect(qs ? `/player-comparison-lab?${qs}` : '/player-comparison-lab')
}
