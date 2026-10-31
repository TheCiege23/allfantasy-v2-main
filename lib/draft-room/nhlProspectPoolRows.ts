import type { NhlFantraxProspect } from '@/lib/player-identity/nhlFantraxProspects'

/**
 * Where the Fantrax NHL prospect layer (`lib/player-identity/nhlFantraxProspects.ts`) joins a draft
 * board, and the rows it adds.
 *
 * ONLY AN NHL ROOKIE DRAFT. A rookie draft is the league's `rookie` follow-up draft
 * (`createNextLeagueDraft.ts` writes `draftModeLabel: 'rookie'`, `playerPool: 'rookies_only'`), or any
 * NHL draft a commissioner set to "rookies only". A startup, a redraft, a veterans-only draft and every
 * other sport are untouched: their boards are built exactly as before.
 *
 * A prospect row is a rookie by construction (`yearsExp: 0` — no NHL game in our data, see the reader's
 * rule), so the rookies-only filter keeps it and the server's pick check (`serverRookieStatus.ts`)
 * accepts it. `team` is the NHL org abbreviation, or null for a player Fantrax lists with no club —
 * the board labels that "Unsigned" (`draftRoom.pool.prospectUnsigned`), and the pool's teamless filter
 * exempts these rows because `prospectSource` marks them.
 */

export const NHL_PROSPECT_SOURCE = 'fantrax' as const

export function shouldOfferNhlFantraxProspects(input: {
  sport: string | null | undefined
  playerPool: string | null | undefined
  draftModeLabel: string | null | undefined
}): boolean {
  if (String(input.sport ?? '').trim().toUpperCase() !== 'NHL') return false
  const pool = String(input.playerPool ?? '').trim().toLowerCase()
  if (pool === 'veterans_only') return false
  return pool === 'rookies_only' || String(input.draftModeLabel ?? '').trim().toLowerCase() === 'rookie'
}

export type NhlProspectRawRow = {
  name: string
  position: string
  team: string | null
  playerId: string
  adp: null
  bye: null
  sport: 'NHL'
  yearsExp: 0
  isRookie: true
  prospectSource: typeof NHL_PROSPECT_SOURCE
  poolType?: 'pro'
}

export function nhlProspectRawRows(prospects: readonly NhlFantraxProspect[], useMixedPoolTypeMarkers = false): NhlProspectRawRow[] {
  return prospects.map((p) => ({
    name: p.name,
    position: p.position,
    team: p.orgTeam,
    playerId: p.playerId,
    adp: null,
    bye: null,
    sport: 'NHL',
    yearsExp: 0,
    isRookie: true,
    prospectSource: NHL_PROSPECT_SOURCE,
    ...(useMixedPoolTypeMarkers ? { poolType: 'pro' as const } : {}),
  }))
}

/** The pool drops rows with no team; a Fantrax prospect with no club is the one exception. */
export function isTeamlessExemptProspect(entry: { prospectSource?: unknown }): boolean {
  return entry.prospectSource === NHL_PROSPECT_SOURCE
}
