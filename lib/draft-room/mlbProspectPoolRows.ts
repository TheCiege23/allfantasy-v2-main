import type { MlbFantraxProspect } from '@/lib/player-identity/mlbFantraxProspects'
import { NHL_PROSPECT_SOURCE } from '@/lib/draft-room/nhlProspectPoolRows'

/**
 * Where the Fantrax MLB prospect layer (`lib/player-identity/mlbFantraxProspects.ts`) joins a draft
 * board, and the rows it adds. The MLB twin of `nhlProspectPoolRows.ts`, with the same gate:
 *
 * ONLY AN MLB ROOKIE DRAFT — `draftModeLabel: 'rookie'` (the league's follow-up draft) or a
 * `rookies_only` pool, never `veterans_only`. MLB startup and redraft boards, and every other sport,
 * are built exactly as before.
 *
 * Rows carry the same `prospectSource: 'fantrax'` marker as NHL, so the board shows the same badge
 * and "Unsigned" label, and the pool's teamless filter (`isTeamlessExemptProspect`) exempts an
 * unsigned prospect. `yearsExp: 0` — no MLB game in our data, see the reader's rule.
 */

export function shouldOfferMlbFantraxProspects(input: {
  sport: string | null | undefined
  playerPool: string | null | undefined
  draftModeLabel: string | null | undefined
}): boolean {
  if (String(input.sport ?? '').trim().toUpperCase() !== 'MLB') return false
  const pool = String(input.playerPool ?? '').trim().toLowerCase()
  if (pool === 'veterans_only') return false
  return pool === 'rookies_only' || String(input.draftModeLabel ?? '').trim().toLowerCase() === 'rookie'
}

export type MlbProspectRawRow = {
  name: string
  position: string
  team: string | null
  playerId: string
  adp: null
  bye: null
  sport: 'MLB'
  yearsExp: 0
  isRookie: true
  prospectSource: typeof NHL_PROSPECT_SOURCE
  poolType?: 'pro'
}

export function mlbProspectRawRows(prospects: readonly MlbFantraxProspect[], useMixedPoolTypeMarkers = false): MlbProspectRawRow[] {
  return prospects.map((p) => ({
    name: p.name,
    position: p.position,
    team: p.orgTeam,
    playerId: p.playerId,
    adp: null,
    bye: null,
    sport: 'MLB',
    yearsExp: 0,
    isRookie: true,
    prospectSource: NHL_PROSPECT_SOURCE,
    ...(useMixedPoolTypeMarkers ? { poolType: 'pro' as const } : {}),
  }))
}
