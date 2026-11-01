/**
 * "No one can know you are on Exile" — the commissioner's `hideExileMembership` switch
 * (League.settings.survivorSideGames, off by default). Pure and client-safe.
 *
 * When it is on, who is on Exile Island is known only to the people already there and to a
 * commissioner who is not playing. Everyone else sees a voted-out castaway as simply "out": the
 * episode recap, the season roster, the league summary and Chimmy all say "voted out" and never
 * "sent to Exile". A return to the island is still announced — the return itself is public.
 */

import { readSurvivorSideGameSettings } from './survivorSideGameSettings'

export function exileMembershipHidden(leagueSettings: unknown): boolean {
  return readSurvivorSideGameSettings(leagueSettings).hideExileMembership
}

export function canSeeExileMembership(args: {
  hidden: boolean
  /** The viewer's own SurvivorPlayer.playerState, if they are a castaway. */
  viewerState: string | null | undefined
  /** A commissioner who is not also playing (a playing commissioner is treated as a castaway). */
  nonPlayingCommissioner: boolean
}): boolean {
  if (!args.hidden) return true
  if (args.viewerState === 'exile') return true
  return args.nonPlayingCommissioner
}

/** A castaway's state as a viewer who may not know about Exile sees it. */
export function exileSafePlayerState(state: string, canSee: boolean): string {
  return !canSee && state === 'exile' ? 'eliminated' : state
}
