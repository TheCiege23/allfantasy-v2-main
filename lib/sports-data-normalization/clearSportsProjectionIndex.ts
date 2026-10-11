import type { ClearSportsSport } from '@/lib/clear-sports'
import { foldInjuryTeam } from '@/lib/injuries/matchInjuryRows'
import { buildNameIndex, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'

type CsRow = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * Build a lookup from ClearSports projection rows (shape varies by endpoint), keyed by name and
 * holding EVERY row for that name, with the row's team and position for disambiguation.
 *
 * 🛑 NO ID INDEX ANY MORE, AND NO LAST-WRITE-WINS BY NAME (2026-10-11). The id index was keyed by
 * ClearSports' own ids and read with `SportsPlayer.externalId ?? riRow.playerId` — a Rolling
 * Insights or Sleeper-space number, which can only collide (RI 8394 is Rome Odunze, Sleeper 8394
 * is Percy Butler), never genuinely match. And `byName.set(name, row)` kept whichever of two
 * same-named athletes came last (WR vs LB Justin Jefferson). Rows are now bound by name, verified by
 * team/position when the name is shared, and left unbound when they cannot be told apart.
 */
export function indexClearSportsProjections(
  rows: Array<CsRow>,
  sport: ClearSportsSport,
): { byName: Map<string, Array<{ name: string; team: string | null; position: string | null; row: CsRow }>> } {
  const candidates = rows.flatMap((row) => {
    const name = str(row.name) ?? str(row.playerName) ?? str(row.fullName) ?? str(row.player)
    if (!name) return []
    const team = str(row.team_abbr) ?? str(row.teamAbbr) ?? str(row.team) ?? str(row.team_name)
    const position = str(row.position) ?? str(row.pos)
    return [{ name, team: foldInjuryTeam(team, sport), position: position?.toUpperCase() ?? null, row }]
  })
  return { byName: buildNameIndex(candidates) }
}

export function pickProjectionRowForPlayer(args: {
  name: string
  team?: string | null
  position?: string | null
  sport?: string | null
  index: ReturnType<typeof indexClearSportsProjections>
}): CsRow | null {
  return (
    resolveVerifiedMatch(args.index.byName, {
      name: args.name,
      team: foldInjuryTeam(args.team, args.sport ?? 'NFL'),
      position: args.position?.trim().toUpperCase() || null,
    }).match?.row ?? null
  )
}
