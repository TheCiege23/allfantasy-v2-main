import { isNativePlatform } from '@/lib/dashboard/platform-label'
import type { PlayerCardLeague } from '@/lib/core-app/playerCard'

/**
 * Which roster actions the league player card offers, and where each one goes.
 *
 * ⚠ THE CARD DECIDES WHAT TO OFFER; THE SERVER DECIDES WHAT IS ALLOWED. None of these call a write.
 * Drop and Add hand off to the league's own Players & waivers screen, which runs the existing
 * add/drop and claim flows (`/api/waiver-wire/leagues/[id]/add-drop`, `/claims`) with every rule
 * they already carry: game locks, the bench lock, commissioner locks, waiver holds and FAAB.
 * A Drop on its own has no endpoint of its own — the hand-off lets the manager pick the add, or
 * claim, that goes with it.
 *
 * ⚠ NATIVE LEAGUES ONLY FOR DROP AND ADD. An imported league's real roster lives on its platform;
 * AllFantasy cannot make the move there, so the card does not offer a button that would only move
 * a local copy.
 */
export type PlayerCardActions = {
  drop: { href: string } | null
  add: { href: string } | null
  trade: { href: string } | null
}

type ActionLeague = Pick<PlayerCardLeague, 'leagueId' | 'platform' | 'slot' | 'isYours' | 'rosterPlayerId'>

function waiversHref(leagueId: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ view: 'waivers', ...params })
  return `/league/${encodeURIComponent(leagueId)}?${q.toString()}`
}

export function playerCardActions(
  league: ActionLeague | null | undefined,
  subject: { sleeperId?: string | null; externalId?: string | null; name: string },
): PlayerCardActions {
  const none: PlayerCardActions = { drop: null, add: null, trade: null }
  if (!league || league.slot === 'UNREADABLE') return none
  const native = isNativePlatform(league.platform)
  const freeAgent = league.slot === 'NOT ROSTERED'

  if (league.isYours) {
    const id = league.rosterPlayerId ?? subject.sleeperId ?? null
    return { ...none, drop: native && id ? { href: waiversHref(league.leagueId, { drop: id }) } : null }
  }
  if (freeAgent) {
    const id = subject.sleeperId ?? subject.externalId ?? null
    if (!native) return none
    return { ...none, add: { href: waiversHref(league.leagueId, { ...(id ? { add: id } : {}), q: subject.name }) } }
  }
  return {
    ...none,
    trade: {
      href: native
        ? `/league/${encodeURIComponent(league.leagueId)}?view=trades`
        : `/core/trades?league=${encodeURIComponent(league.leagueId)}`,
    },
  }
}
