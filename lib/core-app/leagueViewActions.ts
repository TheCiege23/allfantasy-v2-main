import type { PlayerLeagueView } from './playerLeagueView'
import { claimLink, lineupLink, tradeLink } from './platformLinks'

/**
 * The next move for a player in the league in view — set your lineup, trade for him, or claim him —
 * as ONE rule, read by both the league card (LeagueOwnershipCard) and the phone's sticky action bar
 * (StickyActionBar). Two copies of "which button goes here" would disagree the first time one changed.
 *
 * Pure, client-safe.
 */

export type ViewAction = {
  label: string
  href: string
  /** Opens the provider's site in a new tab. */
  external: boolean
  /** An AllFantasy route — rendered as a Next link rather than a plain anchor. */
  internal: boolean
}

export type LeagueViewActions = {
  primary: ViewAction | null
  secondary: ViewAction | null
  /** Where he stands in this league, in a few words — the bar's context line. */
  status: string
}

export function leagueViewActions(view: PlayerLeagueView, playerName: string): LeagueViewActions {
  const last = playerName.trim().split(/\s+/).slice(-1)[0] || playerName
  const o = view.ownership
  const league = {
    id: view.leagueId,
    platform: view.platform,
    platformLeagueId: view.platformLeagueId,
    season: view.season,
    name: view.leagueName,
    teamId: view.yourTeam?.externalId ?? null,
    partnerTeamId: o.kind === 'other' ? (o.owner?.externalId ?? null) : null,
  }

  if (o.kind === 'yours') {
    const l = lineupLink(league)
    return {
      primary: l ? { label: l.label, href: l.href, external: l.external, internal: false } : null,
      secondary: null,
      status: `Yours · ${(o.exactSlot ?? o.slot).toLowerCase()}`,
    }
  }
  if (o.kind === 'other') {
    const t = tradeLink(league)
    return {
      primary: { label: `Trade for ${last} →`, href: t.here.href, external: false, internal: true },
      secondary: t.there ? { label: t.there.label, href: t.there.href, external: true, internal: false } : null,
      status: o.owner ? `${o.owner.teamName}'s` : 'Another manager’s',
    }
  }
  if (o.kind === 'free-agent') {
    const c = claimLink(league)
    return {
      primary: c ? { label: `Claim ${last} — ${c.label.replace(/^Open in /, 'on ')}`, href: c.href, external: c.external, internal: false } : null,
      secondary: null,
      status: 'Free agent',
    }
  }
  return { primary: null, secondary: null, status: 'Not readable here' }
}
