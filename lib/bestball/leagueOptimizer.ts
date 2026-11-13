import type { LeagueSport } from '@prisma/client'
import { OPTIMAL_LINEUP_ALGORITHM } from '@/lib/lineup-optimizer/optimalLineup'
import { computeBestBallLineup, resolveBestBallSlots } from '@/lib/bestball/productionLineup'

export type BestBallOptimizerPlayer = {
  playerId: string
  playerName: string
  position: string
  team?: string | null
  points: number
}

export type BestBallOptimizerResult = {
  starterIds: string[]
  totalPoints: number
  starters: Array<{
    playerId: string
    playerName: string
    position: string
    slot: string
    points: number
  }>
  benchIds: string[]
  notes: string[]
}

function normalizeSoccerPosition(raw: string): 'GK' | 'DEF' | 'MID' | 'FWD' | null {
  const value = String(raw ?? '').trim().toUpperCase()
  if (!value) return null
  if (['GK', 'GKP'].includes(value)) return 'GK'
  if (['DEF', 'CB', 'LB', 'RB', 'LWB', 'RWB'].includes(value)) return 'DEF'
  if (['MID', 'CM', 'CDM', 'CAM', 'LM', 'RM', 'AM'].includes(value)) return 'MID'
  if (['FWD', 'ST', 'CF', 'LW', 'RW', 'SS'].includes(value)) return 'FWD'
  return null
}

/**
 * The best ball lineup for one roster-week in the generic weekly processor (`server/services/weeklyProcessor.ts`).
 *
 * 🛑 THIS WAS A DFS OVER HARD-CODED SLOTS (`lib/bestball/rules.ts`): no K, no DST, no superflex, never the
 * league's own roster, and exponential — 18 s on a 30-player MLB roster (audit 2026-11-06, finding #17).
 * It now seats the league's slots (`buildBestBallSlots(sport, leagueSettings)`, what matchup scoring
 * seats) with the production optimizer (`computeOptimalLineup`, exact, polynomial).
 *
 * `leagueSettings` is the league's `settings`; omitted, the sport's `best_ball` template is used (what a
 * new league is given). A sport with no best ball slots returns an empty lineup and says so in `notes` —
 * never a sum of the roster.
 */
export function optimizeBestBallLeagueLineup(
  sport: LeagueSport | string,
  players: BestBallOptimizerPlayer[],
  leagueSettings?: unknown,
): BestBallOptimizerResult {
  const sportKey = String(sport ?? 'NFL').trim().toUpperCase()
  const safePlayers = players
    .filter((player) => player.playerId)
    .map((player) => {
      const position = String(player.position ?? 'UTIL').trim().toUpperCase() || 'UTIL'
      return {
        ...player,
        // Soccer feeds alias positions (CB, ST, …); the league's seats read DEF / MID / FWD / GK.
        position: sportKey === 'SOCCER' ? (normalizeSoccerPosition(position) ?? position) : position,
        points: Number.isFinite(player.points) ? player.points : 0,
      }
    })

  const slots = resolveBestBallSlots(sportKey, leagueSettings)
  if (!slots) {
    return {
      starterIds: [],
      totalPoints: 0,
      starters: [],
      benchIds: safePlayers.map((p) => p.playerId),
      notes: [`No best ball lineup slots could be resolved for ${sportKey}; no lineup was scored.`],
    }
  }

  const lineup = computeBestBallLineup({ slots, players: safePlayers })
  const byId = new Map(safePlayers.map((p) => [p.playerId, p]))
  const starterIds = lineup.assignments.map((a) => a.playerId)
  const seated = new Set(starterIds)
  return {
    starterIds,
    totalPoints: lineup.total,
    starters: lineup.assignments.map((a) => ({
      playerId: a.playerId,
      playerName: byId.get(a.playerId)?.playerName ?? a.playerId,
      position: byId.get(a.playerId)?.position ?? '',
      slot: a.slot,
      points: a.points,
    })),
    benchIds: [...new Set(safePlayers.map((p) => p.playerId))].filter((id) => !seated.has(id)),
    notes: [
      `algorithm=${OPTIMAL_LINEUP_ALGORITHM}`,
      ...lineup.unfilledSlots.map((u) => `${u.slot} #${u.seat} unfilled — no eligible player`),
    ],
  }
}
