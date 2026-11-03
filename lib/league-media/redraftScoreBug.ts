/**
 * Live scores (batch A6): the pure mappings behind the broadcast-style score bug and the Game Center's
 * sport-specific chrome. No rendering, so every sport is unit-tested.
 *
 * 🛑 REAL DATA ONLY. A label is built from what the feed sent — status, period, clock — and nothing is
 * estimated. A period of 0 (or a missing one) prints no period, never "Q0".
 *
 * Sport keys are the normalized ones (`normalizeToSupportedSport`): NFL, NCAAF, NBA, NCAAB, NHL, MLB,
 * SOCCER. Anything else takes the football wording the tab always used, so nothing regresses.
 */

export type ScoreBugTone = 'live' | 'final' | 'upcoming'

export type ScoreBugGame = {
  status: string
  period: number
  clock: string
  completed: boolean
  startTime: string
}

/** "Q3", "2nd half", "P2", "Inn 6", or null when the feed gave no period. */
export function periodLabel(sportU: string, period: number): string | null {
  if (!Number.isInteger(period) || period <= 0) return null
  switch (sportU) {
    case 'NHL':
      return period > 3 ? 'OT' : `P${period}`
    case 'MLB':
      return `Inn ${period}`
    case 'NCAAB':
    case 'SOCCER':
      return period > 2 ? (sportU === 'SOCCER' ? 'ET' : 'OT') : period === 1 ? '1st half' : '2nd half'
    default:
      return period > 4 ? 'OT' : `Q${period}`
  }
}

function formatStart(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** The bug's status bar: what is happening in this game right now. */
export function scoreBugStatus(sportU: string, g: ScoreBugGame): { label: string; tone: ScoreBugTone } {
  if (g.completed || g.status === 'STATUS_FINAL') return { label: 'Final', tone: 'final' }
  if (g.status === 'STATUS_HALFTIME') return { label: 'Halftime', tone: 'live' }
  if (g.status === 'STATUS_IN_PROGRESS') {
    const period = periodLabel(sportU, g.period)
    const clock = g.clock?.trim() || ''
    return { label: [period, clock].filter(Boolean).join(' · ') || 'Live', tone: 'live' }
  }
  return { label: formatStart(g.startTime), tone: 'upcoming' }
}

/** Position filter pills. College sports use their pro sport's positions; soccer has its own. */
export function positionPillsForSport(sportU: string): string[] {
  if (sportU === 'NBA' || sportU === 'NCAAB') return ['All', 'PG', 'SG', 'SF', 'PF', 'C']
  if (sportU === 'NHL') return ['All', 'C', 'LW', 'RW', 'D', 'G']
  if (sportU === 'MLB') return ['All', 'P', 'C', '1B', '2B', '3B', 'SS', 'OF']
  if (sportU === 'SOCCER') return ['All', 'GK', 'DEF', 'MID', 'FWD']
  return ['All', 'QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB']
}

/** The ball on the "Game day leaders" nav item. It was a football for every sport. */
export function sportGlyph(sportU: string): string {
  if (sportU === 'NBA' || sportU === 'NCAAB') return '🏀'
  if (sportU === 'NHL') return '🏒'
  if (sportU === 'MLB') return '⚾'
  if (sportU === 'SOCCER') return '⚽'
  return '🏈'
}
