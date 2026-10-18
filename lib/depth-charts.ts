import 'server-only'

import { depthChartPlayerNames, selectCurrentDepthRows } from '@/lib/depthChartRows'
import { prisma } from '@/lib/prisma'

export type DepthChartEntry = {
  team: string
  position: string
  /** Player names in depth order, starter first. */
  players: string[]
  source: string
}

/** Cache-only depth chart lookup: checks DepthChart table and never calls providers. */
export async function getDepthCharts(sport: string, options?: { team?: string }): Promise<DepthChartEntry[]> {
  // 1. Check DepthChart table
  try {
    const where: Record<string, unknown> = { sport: sport.toUpperCase() }
    if (options?.team) where.team = options.team
    const rows = await prisma.depthChart.findMany({
      where,
      orderBy: [{ team: 'asc' }, { position: 'asc' }],
    })
    if (rows.length > 0) {
      // One row per team/position (freshest wins), and names rather than the raw stored entries:
      // object-shaped rows were cast to string[] here, so name comparisons downstream matched nothing.
      return selectCurrentDepthRows(rows).map((r) => ({
        team: r.team,
        position: r.position,
        players: depthChartPlayerNames(r.players),
        source: r.source,
      }))
    }
  } catch {}

  return []
}

/** Get depth chart for a specific team. */
export async function getTeamDepthChart(team: string, sport: string): Promise<DepthChartEntry[]> {
  return getDepthCharts(sport, { team })
}

/** Get the starter for a position on a team. */
export async function getStarter(team: string, position: string, sport: string): Promise<string | null> {
  const entries = await getTeamDepthChart(team, sport)
  const entry = entries.find((e) => e.position.toUpperCase() === position.toUpperCase())
  return entry?.players[0] ?? null
}
