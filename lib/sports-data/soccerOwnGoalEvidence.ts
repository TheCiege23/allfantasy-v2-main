import { playerNamesAgree } from '@/lib/player-identity/externalIdNamespace'
import { proTeamCode } from '@/lib/player-identity/proFantraxIdentityPlan'

export type SoccerOwnGoal = { player: string; club: string }
export type SoccerGoalReceipt = { eventId: string; ownGoals: SoccerOwnGoal[] }
export const EPL_GOAL_RECEIPT_PREFIX = 'thesportsdb:epl:goals:'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function eplGoalReceiptKey(date: string, home: string, away: string): string {
  return EPL_GOAL_RECEIPT_PREFIX + [date, home, away].join(':')
}

/** Rolling Insights' match ID contains the date, away team ID, then home team ID. */
export function eplGoalKeyForRollingMatch(gameId: string): string | null {
  const match = /^(\d{8})-(\d+)-(\d+)(?::[a-z_]+)?$/.exec(gameId)
  if (!match) return null
  const [, day, awayId, homeId] = match
  const home = proTeamCode('SOCCER', homeId)
  const away = proTeamCode('SOCCER', awayId)
  return home && away && home !== away ? eplGoalReceiptKey(day!, home, away) : null
}

/** Validate every scored event against the final score. An own goal is assigned to the opposing club. */
export function parseEplGoalReceipt(
  body: unknown,
  match: { eventId: string; home: string; away: string; homeScore: number; awayScore: number },
): SoccerGoalReceipt | null {
  const timeline = record(body)?.timeline
  if (!Array.isArray(timeline)) return null
  const seen = new Set<string>()
  let home = 0
  let away = 0
  const ownGoals: SoccerOwnGoal[] = []
  for (const item of timeline) {
    const event = record(item)
    if (!event || event.idEvent !== match.eventId) return null
    if (event.strTimeline !== 'Goal') continue
    const { idTimeline, strTimelineDetail, strHome, strPlayer, strTeam } = event
    if (typeof idTimeline !== 'string' || !idTimeline || seen.has(idTimeline)) return null
    seen.add(idTimeline)
    if (strHome !== 'Yes' && strHome !== 'No') return null
    const awardedClub = strHome === 'Yes' ? match.home : match.away
    if (typeof strTeam !== 'string' || proTeamCode('SOCCER', strTeam) !== awardedClub) return null
    if (strHome === 'Yes') home++
    else away++
    if (strTimelineDetail === 'Own Goal') {
      if (typeof strPlayer !== 'string' || !strPlayer.trim()) return null
      ownGoals.push({ player: strPlayer.trim(), club: strHome === 'Yes' ? match.away : match.home })
    } else if (strTimelineDetail !== 'Normal Goal' && strTimelineDetail !== 'Penalty') {
      return null
    }
  }
  return home === match.homeScore && away === match.awayScore ? { eventId: match.eventId, ownGoals } : null
}

export function readEplGoalReceipt(value: unknown): SoccerGoalReceipt | null {
  const row = record(value)
  if (typeof row?.eventId !== 'string' || !Array.isArray(row.ownGoals)) return null
  const ownGoals: SoccerOwnGoal[] = []
  for (const item of row.ownGoals) {
    const goal = record(item)
    if (typeof goal?.player !== 'string' || !goal.player.trim() || typeof goal.club !== 'string' ||
        proTeamCode('SOCCER', goal.club) !== goal.club) return null
    ownGoals.push({ player: goal.player, club: goal.club })
  }
  return { eventId: row.eventId, ownGoals }
}

/** Every own-goal scorer must link to one match participant before the receipt can be used. */
export function ownGoalsByPlayer(
  receipt: SoccerGoalReceipt,
  participants: readonly { playerId: string; name: string | null; team: string | null }[],
): Map<string, number> | null {
  const result = new Map<string, number>()
  for (const goal of receipt.ownGoals) {
    const matches = new Set(participants.filter((player) =>
      player.name && proTeamCode('SOCCER', player.team) === goal.club && playerNamesAgree(player.name, goal.player),
    ).map((player) => player.playerId))
    if (matches.size !== 1) return null
    const id = [...matches][0]!
    result.set(id, (result.get(id) ?? 0) + 1)
  }
  return result
}
