import type { LeagueActivityItem } from '@/lib/core-app/leagueActivity'

/**
 * One line of league activity on the Trades tab (2026-11-14): who, what they added and dropped, and
 * what the claim cost when the platform recorded it. Pure, so the wording is testable without a database.
 */
export type ActivityRow = {
  id: string
  team: string | null
  kind: 'waiver' | 'roster_move'
  adds: string[]
  drops: string[]
  /** Null means the bid was not recorded, never $0 (lib/core-app/leagueActivity.ts). */
  bid: number | null
  at: string
}

/** How many rows the section shows. Moves showed 8; the trade history above is already long. */
export const ACTIVITY_ROWS = 10

/**
 * Trades are dropped: the trade history above lists every one with its grade, and listing them here too
 * would say each trade twice.
 */
export function activityRows(items: readonly LeagueActivityItem[], limit = ACTIVITY_ROWS): ActivityRow[] {
  return items
    .filter((i): i is LeagueActivityItem & { kind: 'waiver' | 'roster_move' } => i.kind !== 'trade')
    .slice(0, limit)
    .map((i) => ({
      id: i.id,
      team: i.teamName ?? i.managerName ?? null,
      kind: i.kind,
      adds: i.adds.map((p) => p.label),
      drops: i.drops.map((p) => p.label),
      bid: i.bid,
      at: i.occurredAt.toISOString(),
    }))
}

type Words = {
  added: (players: string) => string
  dropped: (players: string) => string
  bid: (amount: string) => string
  aClaim: string
  aMove: string
}

/** "added Micah McFadden (LB · NYG) for $12 · dropped Charlie Jones (WR · NYG)". */
export function activityText(row: ActivityRow, t: Words): string {
  const parts: string[] = []
  if (row.adds.length > 0) {
    parts.push(row.bid != null && row.bid > 0 ? `${t.added(row.adds.join(', '))} ${t.bid(`$${row.bid}`)}` : t.added(row.adds.join(', ')))
  }
  if (row.drops.length > 0) parts.push(t.dropped(row.drops.join(', ')))
  if (parts.length === 0) return row.kind === 'waiver' ? t.aClaim : t.aMove
  return parts.join(' · ')
}
