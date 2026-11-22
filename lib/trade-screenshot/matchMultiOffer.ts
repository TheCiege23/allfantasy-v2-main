import type { LeagueRoster } from '@/components/core-app/screens/useLeagueRosters'
import type { MultiAsset } from '@/lib/trade-intel/multiTeamGrade'
import { MAX_MULTI_TEAMS, MIN_MULTI_TEAMS } from '@/lib/trade-intel/multiTeamGrade'
import { findRosterPlayer, rosterIsNamed } from './matchOffer'
import type { OfferRead, ReadAsset } from './offerRead'

/**
 * A screenshot of a 3- or 4-team offer, placed on this league's rosters (2026-11-14). The two-team
 * matcher (`./matchOffer.ts`) is unchanged and still handles every two-team offer.
 *
 * HOW THE SIDES ARE FOUND. Sleeper draws one "@username" section per manager, listing what that
 * manager RECEIVES. So each section is matched to a roster by its LABEL. One unlabelled section is
 * allowed when the viewer is the only manager left unplaced — that is the viewer's own section. Anything
 * else ambiguous is refused, never guessed.
 *
 * WHERE EACH ASSET COMES FROM. Before the trade every player sits on exactly one roster, so a player's
 * sender is the one team in the deal (other than the receiver) that holds him. A pick's sender is the
 * one team that holds a pick of that year and round; its "(originalOwner)" breaks a tie. FAAB is not
 * part of a 3–4 team grade, so it is listed as not placed.
 *
 * 🛑 NOTHING IS GUESSED. Whatever cannot be placed is listed in `unmatched` for the manager to add by hand.
 *
 * PURE and client-safe.
 */

/** Reasons are codes, worded by the screen in the reader's language (lib/core-app/messages/multiTeamTrade.ts). */
export type MultiOfferRefusal =
  | { code: 'unreadable' }
  | { code: 'team_count'; count: number }
  | { code: 'unplaced' }
  | { code: 'duplicate' }

export type MultiOfferMatch =
  | {
      ok: true
      teamIds: string[]
      assets: MultiAsset[]
      /** Names and picks that could not be placed on a roster. */
      unmatched: string[]
      /** FAAB amounts the offer carried; FAAB is not part of a 3-4 team grade. */
      faabLeftOut: number[]
    }
  | { ok: false; reason: MultiOfferRefusal }

function describe(a: ReadAsset): string {
  if (a.type === 'player') return a.name
  if (a.type === 'faab') return `$${a.amount} FAAB`
  return `${a.year ?? '?'} round ${a.round ?? '?'}`
}

export function matchMultiTeamOffer(args: {
  read: OfferRead
  rosters: readonly LeagueRoster[]
  viewerRosterId: string | null
}): MultiOfferMatch {
  const { read, rosters } = args
  if (read.kind !== 'offer') {
    return { ok: false, reason: { code: 'unreadable' } }
  }
  const teams = read.teams.filter((t) => t.receives.length > 0 || t.name)
  if (teams.length < MIN_MULTI_TEAMS || teams.length > MAX_MULTI_TEAMS) {
    return { ok: false, reason: { code: 'team_count', count: teams.length } }
  }

  /* Each section to a roster by its label; at most one unlabelled section, and only the viewer's. */
  const placed: Array<LeagueRoster | null> = teams.map((t) => {
    const named = rosters.filter((r) => rosterIsNamed(r, t.name?.replace(/^@/, '')))
    return named.length === 1 ? named[0]! : null
  })
  const unplaced = placed.flatMap((r, i) => (r ? [] : [i]))
  const viewer = rosters.find((r) => r.rosterId === args.viewerRosterId) ?? null
  if (unplaced.length === 1 && viewer && !placed.some((r) => r?.rosterId === viewer.rosterId)) {
    placed[unplaced[0]!] = viewer
  }
  if (placed.some((r) => r == null)) {
    return { ok: false, reason: { code: 'unplaced' } }
  }
  const deal = placed as LeagueRoster[]
  if (new Set(deal.map((r) => r.rosterId)).size !== deal.length) {
    return { ok: false, reason: { code: 'duplicate' } }
  }

  const unmatched: string[] = [...read.unreadable]
  const faabLeftOut: number[] = []
  const usedPicks = new Set<string>()
  const assets: MultiAsset[] = []
  teams.forEach((team, i) => {
    const to = deal[i]!
    const senders = deal.filter((r) => r.rosterId !== to.rosterId)
    for (const a of team.receives) {
      if (a.type === 'faab') {
        faabLeftOut.push(a.amount)
        continue
      }
      if (a.type === 'player') {
        const owners = senders.filter((r) => findRosterPlayer(r, a.name) != null)
        if (owners.length !== 1) {
          unmatched.push(a.name)
          continue
        }
        const p = findRosterPlayer(owners[0]!, a.name)!
        assets.push({ key: `player:${p.id}`, kind: 'player', from: owners[0]!.rosterId, to: to.rosterId, label: p.name, position: p.position, value: p.value, playerId: p.id })
        continue
      }
      if (a.year == null || a.round == null) {
        unmatched.push(describe(a))
        continue
      }
      const holders = senders.flatMap((r) =>
        r.picks.filter((p) => p.season === a.year && p.round === a.round && !usedPicks.has(p.pickId)).map((p) => ({ r, p })),
      )
      const byOwner = a.originalOwner
        ? holders.filter(({ r, p }) => rosterIsNamed(r, a.originalOwner) || (p.fromTeam != null && p.fromTeam === a.originalOwner))
        : []
      const hit = holders.length === 1 ? holders[0] : byOwner.length === 1 ? byOwner[0] : null
      if (!hit) {
        unmatched.push(describe(a))
        continue
      }
      usedPicks.add(hit.p.pickId)
      assets.push({ key: `pick:${hit.p.pickId}`, kind: 'pick', from: hit.r.rosterId, to: to.rosterId, label: hit.p.label, value: hit.p.value, pickId: hit.p.pickId })
    }
  })
  return { ok: true, teamIds: deal.map((r) => r.rosterId), assets, unmatched, faabLeftOut }
}

/** How many teams a read offer shows — the Trade Center uses it to pick the 2-team or the 3–4 team matcher. */
export function offerTeamCount(read: OfferRead): number {
  return read.kind === 'offer' ? read.teams.filter((t) => t.receives.length > 0 || t.name).length : 0
}
