import 'server-only'

import type { LeagueSport } from '@prisma/client'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { loadNbaSurvivorRosterEligibility, nbaSurvivorPlayerIdMatches, shouldVerifyCurrentNbaRoster } from '@/lib/draft-room/nbaSurvivorRosterEligibility'

type WaiverPoolLeague = { id: string; sport: LeagueSport; leagueVariant?: string | null; isDynasty?: boolean | null }

export function verifiesCurrentNbaWaiverRoster(league: WaiverPoolLeague): boolean {
  const variant = String(league.leagueVariant ?? '').toLowerCase()
  return shouldVerifyCurrentNbaRoster({ sport: league.sport, variant, isDynasty: Boolean(league.isDynasty),
    isDevy: variant.includes('devy'), isC2C: variant.includes('c2c'), mergeCollegePool: false })
}

/** The same verified identities back the listing and transaction eligibility. */
export async function loadLeagueWaiverPlayerPool(league: WaiverPoolLeague, filters: { position?: string; teamId?: string } = {}) {
  const verify = verifiesCurrentNbaWaiverRoster(league)
  const pool = await getPlayerPoolForLeague(league.id, league.sport, { limit: verify ? 5000 : 800, ...filters })
  if (!verify) return pool
  const eligibility = await loadNbaSurvivorRosterEligibility(1)
  if (!eligibility.ready) throw new Error(eligibility.reason ?? 'Current NBA roster unavailable')
  const positions = new Set(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'GF', 'FC'])
  return pool.filter(row => positions.has(row.position.trim().toUpperCase()) &&
    /^\d+$/.test(row.external_source_id ?? '') &&
    nbaSurvivorPlayerIdMatches(eligibility, row.full_name, row.external_source_id)).slice(0, 800)
}

export async function assertCurrentNbaWaiverPlayer(league: WaiverPoolLeague, playerId: string): Promise<void> {
  if (!verifiesCurrentNbaWaiverRoster(league)) return
  const pool = await loadLeagueWaiverPlayerPool(league)
  if (!pool.some(row => row.player_id === playerId || row.external_source_id === playerId)) {
    throw new Error('This player is not on a verified current NBA roster.')
  }
}
