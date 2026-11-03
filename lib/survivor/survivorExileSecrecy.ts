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

export type ExileExposureCheck =
  | { ok: true; penalty: 'remove' | 'strike'; confirmed: boolean }
  | { ok: false; status: 400 | 404 | 409; reason: 'rule_off' | 'not_hidden' | 'not_castaway' | 'already_out' | 'self' }

/**
 * The commissioner's "removed if exposed" action (the original league's rule, never automatic):
 * allowed only while Exile membership is secret and the commissioner turned the rule on, against a
 * castaway still in the season. Nothing is applied until `confirm` is true — the first call is the
 * preview the Hub shows in its confirm step. Pure.
 */
export function exileExposureCheck(args: {
  hidden: boolean
  rule: 'off' | 'remove' | 'strike'
  target: { playerState: string } | null
  targetIsActor: boolean
  confirm: boolean
}): ExileExposureCheck {
  if (args.rule === 'off') return { ok: false, status: 409, reason: 'rule_off' }
  if (!args.hidden) return { ok: false, status: 409, reason: 'not_hidden' }
  if (!args.target) return { ok: false, status: 404, reason: 'not_castaway' }
  if (args.targetIsActor) return { ok: false, status: 400, reason: 'self' }
  if (args.target.playerState === 'eliminated') return { ok: false, status: 409, reason: 'already_out' }
  return { ok: true, penalty: args.rule, confirmed: args.confirm }
}

/**
 * A member list (chat members, alliance members, rosters of names) as a viewer who may not know
 * about Exile sees it: an exiled member reads as simply out. The list keeps everyone it had — a name
 * that silently vanished would be its own tell.
 */
export function exileSafeMembers<T extends { playerState?: string | null }>(members: readonly T[], canSee: boolean): T[] {
  return members.map((m) => (m.playerState === 'exile' && !canSee ? { ...m, playerState: 'eliminated' } : m))
}

/** How many castaways are on Exile, or null when this viewer may not know (a count is a tell too). */
export function visibleExileCount(players: ReadonlyArray<{ playerState?: string | null }>, canSee: boolean): number | null {
  return canSee ? players.filter((p) => p.playerState === 'exile').length : null
}

/**
 * The Exile page for one viewer. `viewerIsExile` and `nonPlayingCommissioner` always see everything;
 * a viewer who may not know sees no count, no names and no "players marooned" line.
 */
export function exilePageVisibility(args: { membershipHidden: boolean; viewerIsExile: boolean; nonPlayingCommissioner: boolean; players: ReadonlyArray<{ playerState?: string | null }> }): {
  showCount: boolean
  count: number | null
  showMembers: boolean
} {
  const canSee = !args.membershipHidden || args.viewerIsExile || args.nonPlayingCommissioner
  const count = visibleExileCount(args.players, canSee)
  return { showCount: count != null, count, showMembers: args.viewerIsExile || (canSee && args.nonPlayingCommissioner) }
}
