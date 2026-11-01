/**
 * Which island scene (public/survivor/scenes/<scene>.svg) the standalone Survivor pages under
 * app/survivor/[leagueId]/ show, so they read as the same island as the /core Survivor screens
 * (lib/core-app/survivorIsland.ts picks the scene there from the core summary).
 *
 * Pure: the hub banner passes league state, the shell passes the route.
 */
import type { IslandScene } from '@/lib/core-app/survivorIsland'

export type LegacyIslandSceneInput = {
  phase?: string | null
  councilStatus?: string | null
  challengeStatus?: string | null
  playerState?: string | null
}

const POST_MERGE = new Set(['merge', 'jury', 'finale'])

/** The hub banner's scene, from league state (same precedence as the core banner's islandView). */
export function legacyIslandScene(s: LegacyIslandSceneInput): IslandScene {
  const phase = s.phase ?? ''
  if (phase === 'finale') return 'finale'
  if (s.councilStatus === 'voting_open' || s.councilStatus === 'revealing') return 'tribal'
  if (s.playerState === 'exile') return 'exile'
  if (s.challengeStatus === 'open') return POST_MERGE.has(phase) ? 'merge' : 'jungle'
  if (POST_MERGE.has(phase)) return 'merge'
  return 'beach'
}

/** The scene painted behind the top of every page in the shell, from the route. */
export function legacyBackdropScene(pathname: string): IslandScene {
  if (pathname.includes('/tribal')) return 'tribal'
  if (pathname.includes('/exile')) return 'exile'
  if (pathname.includes('/jury') || pathname.includes('/finale')) return 'finale'
  if (pathname.includes('/merge') || pathname.includes('/swap')) return 'merge'
  if (pathname.includes('/challenges')) return 'jungle'
  return 'tribal'
}
