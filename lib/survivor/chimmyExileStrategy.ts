import { addExilePlayer, emptyExileRoster, isExileAnchor, type ExileWeeklyRoster } from './exileRosterRules'

/** A real player Chimmy could claim on Exile, with what he has scored lately under this league's scoring. */
export type ExileCandidate = { id: string; name: string; position: string; team: string; recentPoints: number }

export type ChimmyExilePlan = {
  team: string
  /** Sum of the starters' recent points: what Chimmy expects this roster to score. */
  expected: number
  /** Claims in order — the anchor first, because it is what reserves the team. */
  picks: { id: string; slot: string }[]
}

/**
 * Chimmy's Exile pick, pure. Each week an exiled castaway reserves ONE real team by claiming its anchor
 * (QB, C, G, P…) and plays a lineup from that team only. Chimmy builds the best legal starting lineup
 * for every team still open, ranks the teams by those starters' recent fantasy points, and takes the
 * best. Ties go to the team that fills more starting spots, then to the team code, so the pick is
 * stable. Bench spots score nothing on Exile, so Chimmy leaves them empty.
 *
 * `openTeams` is every team that has a game left to play in this Exile period and is not reserved by
 * another exiled manager; the caller decides that from the schedule.
 */
export function chimmyExilePlan(
  candidates: readonly ExileCandidate[],
  sport: string,
  settings: unknown,
  openTeams: readonly string[],
  takenTeams: readonly string[] = [],
): ChimmyExilePlan | null {
  const open = new Set(openTeams.map((t) => t.toUpperCase()))
  const byTeam = new Map<string, ExileCandidate[]>()
  for (const c of candidates) {
    const team = c.team.trim().toUpperCase()
    if (!open.has(team) || takenTeams.includes(team)) continue
    byTeam.set(team, [...(byTeam.get(team) ?? []), { ...c, team }])
  }
  let best: (ChimmyExilePlan & { filled: number }) | null = null
  for (const [team, players] of byTeam) {
    const ranked = [...players].sort((a, b) => b.recentPoints - a.recentPoints || a.id.localeCompare(b.id))
    const anchor = ranked.find((p) => isExileAnchor(sport, p.position))
    if (!anchor) continue
    let roster: ExileWeeklyRoster
    try {
      roster = addExilePlayer(emptyExileRoster(), anchor, sport, settings, [...takenTeams])
    } catch {
      continue
    }
    if (roster.players[0]?.slot === 'BENCH') continue
    let expected = anchor.recentPoints
    for (const player of ranked) {
      if (player.id === anchor.id) continue
      try {
        const next = addExilePlayer(roster, player, sport, settings, [...takenTeams])
        if (next.players[next.players.length - 1]?.slot === 'BENCH') continue
        roster = next
        expected += player.recentPoints
      } catch {
        // No starting spot this player fits; try the next one.
      }
    }
    const plan = { team, expected: Math.round(expected * 100) / 100, picks: roster.players.map((p) => ({ id: p.id, slot: p.slot })), filled: roster.players.length }
    if (!best || plan.expected > best.expected || (plan.expected === best.expected && (plan.filled > best.filled || (plan.filled === best.filled && team < best.team)))) {
      best = plan
    }
  }
  if (!best) return null
  const { filled: _filled, ...plan } = best
  return plan
}
