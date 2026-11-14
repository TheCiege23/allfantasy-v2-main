import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const revalidate = 86400

export type SlimPlayer = {
  id: string
  name: string
  position: string
  team: string
  espn_id?: string
  /** NBA.com / Sleeper NBA `stats_id` when present */
  nba_id?: string
  /** From Sleeper NFL payload when present — used for rookie filters */
  years_exp?: number
}

function parseSlimMapFromDb(
  rows: Array<{ id: string; name: string; position: string; team: string; stats: unknown; projections: unknown }>,
  opts: { nba: boolean },
): Record<string, SlimPlayer> {
  const out: Record<string, SlimPlayer> = {}

  const fromUnknownRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value as Record<string, unknown>
  }

  const pickString = (record: Record<string, unknown> | null, keys: string[]): string | undefined => {
    if (!record) return undefined
    for (const key of keys) {
      const value = record[key]
      if (value == null || value === '') continue
      return typeof value === 'number' ? String(value) : String(value).trim()
    }
    return undefined
  }

  for (const row of rows) {
    const stats = fromUnknownRecord(row.stats)
    const projections = fromUnknownRecord(row.projections)
    const canonicalId = row.id
    const fallbackId = row.id.includes(':') ? row.id.split(':').pop() || row.id : row.id
    const team = row.team?.trim() || 'FA'

    const slim: SlimPlayer = {
      id: canonicalId,
      name: row.name,
      position: row.position,
      team,
      ...(pickString(stats, ['espn_id', 'espnId']) || pickString(projections, ['espn_id', 'espnId'])
        ? { espn_id: pickString(stats, ['espn_id', 'espnId']) || pickString(projections, ['espn_id', 'espnId']) }
        : {}),
      ...(opts.nba && (pickString(stats, ['stats_id', 'statsId', 'nba_id']) || pickString(projections, ['stats_id', 'statsId', 'nba_id']))
        ? {
            nba_id:
              pickString(stats, ['stats_id', 'statsId', 'nba_id']) ||
              pickString(projections, ['stats_id', 'statsId', 'nba_id']),
          }
        : {}),
    }

    out[canonicalId] = slim
    if (!out[fallbackId]) {
      out[fallbackId] = { ...slim, id: fallbackId }
    }
  }

  return out
}

/** Slim map of Sleeper players — cached 24h via segment config. Supports `?sport=nfl|nba`. */
export async function GET(req: NextRequest) {
  const sport = (req.nextUrl.searchParams?.get('sport') || 'nfl').trim().toLowerCase()

  if (sport !== 'nfl' && sport !== 'nba') {
    return NextResponse.json({})
  }

  const dbSport = sport === 'nba' ? 'NBA' : 'NFL'

  try {
    const rows = await prisma.sportsPlayerRecord.findMany({
      where: { sport: dbSport },
      select: {
        id: true,
        name: true,
        position: true,
        team: true,
        stats: true,
        projections: true,
      },
      take: 6000,
      orderBy: { lastUpdated: 'desc' },
    })
    if (!rows.length) {
      return NextResponse.json({})
    }

    const out = parseSlimMapFromDb(rows, { nba: sport === 'nba' })
    return NextResponse.json(out)
  } catch {
    return NextResponse.json({})
  }
}

