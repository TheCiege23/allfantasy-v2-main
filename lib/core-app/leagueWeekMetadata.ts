import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type LeagueWeekMetadata = {
  id: string
  platformLeagueId: string | null
  season: number | null
  status: string | null
  settings: { leg?: string | null }
}

/** Read the period marker once per league, without copying large settings blobs per team. */
export async function readLeagueWeekMetadata(ids: string[]): Promise<LeagueWeekMetadata[]> {
  if (!ids.length) return []
  try {
    const rows = await prisma.$queryRaw<LeagueWeekMetadata[]>(Prisma.sql`
      SELECT id, "platformLeagueId", season, status,
        jsonb_build_object('leg', COALESCE(
          settings->>'current_week', settings->>'currentWeek', settings->>'leg',
          settings#>>'{sleeper,leg}', settings#>>'{sleeper,current_week}', settings#>>'{sleeper,currentWeek}',
          settings#>>'{sleeperLeague,leg}', settings#>>'{sleeperLeague,current_week}', settings#>>'{sleeperLeague,currentWeek}',
          settings#>>'{league,leg}', settings#>>'{league,current_week}', settings#>>'{league,currentWeek}'
        )) AS settings
      FROM leagues WHERE id IN (${Prisma.join(ids)})
    `)
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}
