/**
 * Sport-specific derived labels for unified player product views (DraftRoom, waivers, rosters).
 */

import type { LeagueSport } from '@prisma/client'

/** Rolling Insights soccer position families for UI grouping. */
export type SoccerPositionFamily = 'Goalkeeper' | 'Defender' | 'Midfielder' | 'Forward'

const WS = /\s+/g

export function normalizeSoccerPositionCode(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .replace(WS, ' ')
    .toUpperCase()
}

/**
 * Map pool/API position tokens to a coarse soccer group for filters and stat columns.
 */
export function mapSoccerPositionGroup(position: string | null | undefined): SoccerPositionFamily | null {
  const p = normalizeSoccerPositionCode(position)
  if (!p) return null
  if (p === 'GK' || p === 'GKP' || p.includes('GOALKEEP')) return 'Goalkeeper'
  if (p === 'DEF' || p === 'D' || p.includes('DEFEND')) return 'Defender'
  if (p === 'MID' || p.includes('MIDFIELD')) return 'Midfielder'
  if (p === 'FWD' || p === 'F' || p.includes('FORWARD') || p === 'ST' || p === 'ATT') return 'Forward'
  return null
}

/** NCAAFB / NFL-adjacent offensive skill buckets (display only). */
export type NflLikePositionCategory = 'OFF' | 'DEF' | 'ST' | 'K' | 'DST' | 'IDP' | 'UNK'

export function mapNflLikePositionCategory(
  sport: LeagueSport | string,
  position: string | null | undefined,
): NflLikePositionCategory {
  const s = String(sport).toUpperCase()
  const pos = String(position ?? '')
    .trim()
    .toUpperCase()
  if (!pos) return 'UNK'

  if (s === 'SOCCER') {
    const g = mapSoccerPositionGroup(pos)
    if (g === 'Goalkeeper') return 'UNK'
    return 'OFF'
  }

  if (pos === 'K' || pos === 'PK') return 'K'
  if (pos === 'DST' || pos === 'DEF') return 'DST'
  if (['DE', 'DT', 'LB', 'CB', 'S', 'DL', 'DB', 'INT'].includes(pos) || pos.startsWith('IDP')) return 'IDP'
  if (['QB', 'RB', 'WR', 'TE', 'FB', 'TQB'].includes(pos)) return 'OFF'
  return 'UNK'
}

/** Map PK → K for roster slot matching while preserving raw position elsewhere. */
export function aliasKickerPosition(position: string | null | undefined): string {
  const p = String(position ?? '').trim().toUpperCase()
  return p === 'PK' ? 'K' : p || '—'
}
