import { formatRecord, type StandingsBoard, type Zone } from '@/lib/core-app/standingsModel'

/**
 * What the standings share card draws — PURE, so the row selection is pinned by a test rather than by
 * rendering PNGs.
 *
 * ⚠ TEN TEAM ROWS AT MOST, BECAUSE 1200×630 HOLDS TEN READABLY. A bigger league shows its top rows and
 * then YOUR row after a gap, so the card someone shares always has them on it — a card that drops the
 * person sharing it is a card nobody shares.
 *
 * ⚠ THE PLAYOFF LINE IS DRAWN ONLY BETWEEN TWO ROWS THAT ARE ADJACENT IN THE TABLE. Below a gap, a line
 * would claim the rows on either side of it are neighbours.
 */

export const STANDINGS_CARD_MAX_ROWS = 10

export type StandingsCardRow =
  | { kind: 'team'; rosterId: string; seed: number; name: string; record: string; pointsFor: string; zone: Zone; isYou: boolean }
  | { kind: 'line'; label: string }
  | { kind: 'gap'; after: number }

export type StandingsCard = {
  rows: StandingsCardRow[]
  subtitle: string
  footnote: string
  hasRecords: boolean
  rowHeight: number
  fontSize: number
}

function pts(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export function standingsCardRows(board: StandingsBoard): StandingsCard | null {
  const teams = board.teams
  if (teams.length === 0) return null
  const field = Math.min(board.rules.playoffTeams, teams.length)
  const you = teams.find((t) => t.isYou) ?? null

  const youBelow = you != null && you.seed > STANDINGS_CARD_MAX_ROWS && teams.length > STANDINGS_CARD_MAX_ROWS
  const top = teams.length <= STANDINGS_CARD_MAX_ROWS ? teams : teams.slice(0, STANDINGS_CARD_MAX_ROWS - (youBelow ? 1 : 0))

  const row = (t: (typeof teams)[number]): StandingsCardRow => ({
    kind: 'team',
    rosterId: t.rosterId,
    seed: t.seed,
    name: t.name,
    record: board.hasHeadToHead ? formatRecord(t.record) : '',
    pointsFor: pts(t.pointsFor),
    zone: t.zone,
    isYou: t.isYou,
  })

  const rows: StandingsCardRow[] = []
  top.forEach((t, i) => {
    rows.push(row(t))
    const next = top[i + 1]
    if (board.hasHeadToHead && next && t.seed === field) rows.push({ kind: 'line', label: `PLAYOFF LINE — TOP ${field}` })
  })
  if (youBelow && you) {
    rows.push({ kind: 'gap', after: top[top.length - 1].seed })
    rows.push(row(you))
  }

  const shown = rows.filter((r) => r.kind === 'team').length
  const pending = board.pendingWeeks.length > 0 ? ` · week ${board.pendingWeeks.join(', ')} in progress` : ''
  return {
    rows,
    subtitle: `${board.season} · through week ${board.throughWeek}${pending}`,
    footnote: board.hasHeadToHead
      ? `${teams.length} teams · top ${field} make the playoffs`
      : `${teams.length} teams · ordered by points for`,
    hasRecords: board.hasHeadToHead,
    rowHeight: shown <= 8 ? 44 : 38,
    fontSize: shown <= 8 ? 26 : 23,
  }
}
