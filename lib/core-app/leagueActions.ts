import type { LeagueSlot } from './playerFinder'
import type { FreeAgentBidRow } from './freeAgentBids'
import { handoffFor, lineupFixLink, tradeLink, verifiedHandoff, type LinkLeague, type PlatformLink } from './platformLinks'

/**
 * One-tap actions per league (Guap, 2026-10-08): for the open player, in every league where he is
 * yours, someone else's, or free — the move to make there and the button that goes straight to the
 * platform screen that makes it. Start / Bench / Trade / Add.
 *
 * Every destination comes from platformLinks.ts, which is the ONE place provider URLs are built:
 *   - a lineup move uses `lineupFixLink` (the platform's VERIFIED lineup screen, or a native league's
 *     in-app team tab). Where the format is not verified the action falls back to that league's
 *     verified page, and SAYS "Open league" — never "Start him" over a page that cannot start anyone.
 *   - a trade starts on AllFantasy's own trade screen for that league (it grades the offer); the
 *     platform's trade screen, when verified, is the second button.
 *   - an add is the free-agent row's own claim link (freeAgentBids.ts → `waiverClaimLink`).
 *
 * ⚠ AllFantasy is read-only. None of these change anything here; they open where the change is made.
 *
 * Pure, client-safe. The words are built at render (leagueActionsCopy.ts) from `kind` + `platform`.
 */

export type LeagueActionKind = 'start' | 'bench' | 'activate' | 'lineup' | 'open_league' | 'trade_away' | 'trade_for' | 'propose' | 'add' | 'league_home'

export type LeagueAction = {
  kind: LeagueActionKind
  href: string
  external: boolean
  /** "Sleeper", "ESPN", "AllFantasy" — the screen the tap lands in. */
  platformLabel: string
}

export type LeagueCardState = 'start' | 'bench' | 'ir' | 'taxi' | 'other' | 'free'

export type LeagueActionCard = {
  leagueId: string
  leagueName: string
  platform: string | null
  state: LeagueCardState
  /** The other manager, on an `other` card. */
  owner: string | null
  bestBall: boolean
  /** The tap the card leads with; null when there is nothing to do there (best ball, no link). */
  primary: LeagueAction | null
  /** Everything else, for the sheet. */
  more: LeagueAction[]
}

function action(kind: LeagueActionKind, link: PlatformLink): LeagueAction {
  return { kind, href: link.href, external: link.external, platformLabel: link.platformLabel }
}

function linkLeague(slot: LeagueSlot, partner?: string | null): LinkLeague {
  return {
    id: slot.leagueId,
    platform: slot.platform,
    platformLeagueId: slot.platformLeagueId,
    season: slot.season,
    name: slot.leagueName,
    teamId: slot.teamExternalId,
    partnerTeamId: partner ?? null,
  }
}

function stateOf(slot: LeagueSlot): LeagueCardState {
  if (!slot.isYours) return 'other'
  if (slot.slot === 'STARTER') return 'start'
  if (slot.slot === 'IR SLOT') return 'ir'
  if (slot.slot === 'TAXI') return 'taxi'
  return 'bench'
}

/** In-app league home — always there, the last button in every sheet. */
function leagueHome(leagueId: string): LeagueAction {
  return { kind: 'league_home', href: `/core?league=${encodeURIComponent(leagueId)}`, external: false, platformLabel: 'AllFantasy' }
}

/** A league where he is on a roster — yours or someone else's. */
export function cardForSlot(slot: LeagueSlot): LeagueActionCard {
  const state = stateOf(slot)
  const bestBall = slot.bestBall === true
  const base = { leagueId: slot.leagueId, leagueName: slot.leagueName, platform: slot.platform, state, bestBall }

  if (state === 'other') {
    const trades = tradeLink(linkLeague(slot, slot.owner?.externalId ?? null))
    const more: LeagueAction[] = []
    // The platform's own trade screen, only when it lands there (verified) — else AllFantasy's is the one place.
    const there = verifiedHandoff(linkLeague(slot, slot.owner?.externalId ?? null), 'trade')
    if (there) more.push(action('propose', there))
    more.push(leagueHome(slot.leagueId))
    return { ...base, owner: slot.owner?.ownerName ? `@${slot.owner.ownerName}` : (slot.owner?.teamName ?? null), primary: action('trade_for', trades.here), more }
  }

  const more: LeagueAction[] = [action('trade_away', tradeLink(linkLeague(slot)).here)]
  let primary: LeagueAction | null = null
  if (!bestBall) {
    const fix = lineupFixLink(linkLeague(slot))
    if (fix) {
      const kind: LeagueActionKind = state === 'start' ? 'bench' : state === 'bench' ? 'start' : state === 'ir' ? 'activate' : 'lineup'
      primary = action(kind, fix)
      // A starter's sheet still offers the lineup under its plain name, for a slot change rather than a bench.
      if (state === 'start') more.unshift(action('lineup', fix))
    } else {
      // No verified lineup screen: the league's verified page, named as what it is.
      const page = handoffFor(linkLeague(slot), 'league')
      if (page) primary = action('open_league', page)
    }
  }
  more.push(leagueHome(slot.leagueId))
  return { ...base, owner: null, primary, more }
}

/** A league where nobody has him — the claim. */
export function cardForFree(row: FreeAgentBidRow): LeagueActionCard {
  return {
    leagueId: row.leagueId,
    leagueName: row.leagueName,
    platform: row.platform,
    state: 'free',
    owner: null,
    bestBall: false,
    primary: row.claim ? action('add', row.claim) : null,
    more: [leagueHome(row.leagueId)],
  }
}

const ORDER: Record<LeagueCardState, number> = { start: 0, bench: 1, ir: 2, taxi: 3, free: 4, other: 5 }

/**
 * Every card for the open player: yours first, then where he is free, then other managers'. `slots`
 * come already filtered and folded by the screen (OTHERS_FOLD_AFTER), so the cards and the table
 * show the same leagues.
 */
export function buildLeagueCards(slots: readonly LeagueSlot[], free: readonly FreeAgentBidRow[]): LeagueActionCard[] {
  const held = new Set(slots.map((s) => s.leagueId))
  return [...slots.map(cardForSlot), ...free.filter((f) => !held.has(f.leagueId)).map(cardForFree)].sort(
    (a, b) => ORDER[a.state] - ORDER[b.state],
  )
}

