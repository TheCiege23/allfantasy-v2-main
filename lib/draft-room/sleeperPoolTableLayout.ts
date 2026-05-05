/**
 * Builds visible **`SleeperPoolTable`** column specs from **`buildSleeperPoolStatColumnDefs`**.
 * Keeps RK / PLAYER / ADP / AI ADP / optional BYE fixed; stat section is sport-aware.
 */

import { normalizeToSupportedSport } from '@/lib/sport-scope'
import {
  buildSleeperPoolStatColumnDefs,
  isLikelyIdpFootballPosition,
  type DraftStatColumnDef,
  type DraftStatColumnOptions,
} from '@/lib/draft-room/draftSportStatColumns'

export type SleeperColumnSpec = {
  key: string
  label: string
  width: number
  align: 'left' | 'right'
  title?: string
  statLabel?: string
}

export type SleeperPoolTableLayout = {
  columns: SleeperColumnSpec[]
  statDefs: DraftStatColumnDef[]
  minWidth: number
  showBye: boolean
}

/** Widths match legacy D.2 **`SLEEPER_POOL_TABLE_COLUMNS`** for NFL stat keys. */
const NFL_SLEEPER_STAT_WIDTH: Record<string, number> = {
  pts: 60,
  avg: 56,
  ru_att: 60,
  ru_yds: 64,
  ru_td: 56,
  rec: 52,
  rec_yds: 68,
  rec_td: 60,
  pa_att: 60,
  pa_yds: 68,
  pa_td: 56,
  pa_int: 60,
}

function statColumnWidth(def: DraftStatColumnDef, sport: ReturnType<typeof normalizeToSupportedSport>): number {
  if (sport === 'NFL' || sport === 'NCAAF') {
    return NFL_SLEEPER_STAT_WIDTH[def.key] ?? 58
  }
  return Math.min(78, Math.max(44, 36 + def.label.length * 5))
}

export function buildSleeperPoolTableLayout(
  draftSport: string,
  statOpts?: DraftStatColumnOptions,
): SleeperPoolTableLayout {
  const sport = normalizeToSupportedSport(draftSport)
  const statDefs = buildSleeperPoolStatColumnDefs(draftSport, statOpts)
  const showBye = sport === 'NFL' || sport === 'NCAAF'

  const base: SleeperColumnSpec[] = [
    {
      key: 'rk',
      label: 'RK',
      width: 44,
      align: 'right',
      title: 'Current rank by selected sort (defaults to ADP rank)',
      statLabel: 'rank',
    },
    {
      key: 'player',
      label: 'PLAYER',
      width: 240,
      align: 'left',
      title: 'Player — click to sort alphabetically',
    },
    {
      key: 'adp',
      label: 'ADP',
      width: 60,
      align: 'right',
      title: 'Average Draft Position',
      statLabel: 'ADP',
    },
    {
      key: 'aiAdp',
      label: 'AI ADP',
      width: 64,
      align: 'right',
      title: 'AllFantasy AI Draft Position',
      statLabel: 'AI ADP',
    },
  ]

  if (showBye) {
    base.push({
      key: 'bye',
      label: 'BYE',
      width: 44,
      align: 'right',
      title: 'NFL bye week',
      statLabel: 'bye week',
    })
  }

  const statCols: SleeperColumnSpec[] = statDefs.map((def) => ({
    key: def.key,
    label: def.label,
    width: statColumnWidth(def, sport),
    align: 'right',
    title: def.label,
    statLabel: def.label,
  }))

  const actions: SleeperColumnSpec = {
    key: 'actions',
    label: '',
    width: 124,
    align: 'right',
  }

  const columns = [...base, ...statCols, actions]
  const minWidth = columns.reduce((sum, c) => sum + c.width, 0)

  return { columns, statDefs, minWidth, showBye }
}

/**
 * Maps PlayerPanel position pills → **`getDraftStatColumnsForSport`** options so the table
 * shows LB/DL defensive columns, MLB pitcher columns, or NHL goalie columns when filtered.
 */
export function sleeperPoolStatOptionsFromPositionFilter(
  draftSport: string,
  positionFilter: string,
): DraftStatColumnOptions {
  const pf = positionFilter.trim()
  if (!pf || pf.toUpperCase() === 'ALL') return {}
  const u = pf.toUpperCase()
  if (['FLEX', 'IDP FLEX', 'OFFENSE', 'SUPER_FLEX', 'SF', 'FLX'].includes(u)) return {}
  const sport = normalizeToSupportedSport(draftSport)
  if (sport === 'MLB' && (u === 'SP' || u === 'RP' || u === 'P')) return { position: pf }
  if (sport === 'NHL' && u === 'G') return { position: 'G' }
  if ((sport === 'NFL' || sport === 'NCAAF') && isLikelyIdpFootballPosition(pf)) return { position: pf }
  return {}
}
