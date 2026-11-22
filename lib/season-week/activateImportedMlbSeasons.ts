import type { PrismaClient } from '@prisma/client'
import { NATIVE_PLATFORM_VALUES } from '@/lib/dashboard/platform-label'
import { knownDailySportSeasons, resolveDailySportSeasonStart } from './dailySportSeasonStarts'
import { ensureDailySportSeasonStart } from './deriveDailySportSeasonStart'

/** Preserve preseason draft controls; enroll carried rosters only when their season opens. */
export async function activateImportedMlbSeasons(db: PrismaClient, now: Date, limit: number) {
  // The curated years plus the current one: a 2028+ season has no curated line, and without priming
  // its schedule-derived opener here it would never be a candidate for activation at all.
  const candidates = [...new Set([...knownDailySportSeasons('MLB'), now.getUTCFullYear()])]
  for (const year of candidates) await ensureDailySportSeasonStart('MLB', year, { db, now })
  const opened = candidates.filter((year) => {
    const opener = resolveDailySportSeasonStart('MLB', year)
    return opener != null && Date.parse(opener) <= now.getTime()
  })
  const seasons = await db.redraftSeason.findMany({
    where: { sport: 'MLB', season: { in: opened }, status: { in: ['setup', 'active', 'in_season'] }, league: { platform: { in: [...NATIVE_PLATFORM_VALUES] }, lifecycleState: 'post_draft' } },
    select: { id: true, leagueId: true, season: true, league: { select: { settings: true } } },
    take: limit,
  })
  for (const season of seasons) {
    const settings = season.league?.settings as Record<string, unknown> | null
    if (!settings?.importCarryover) continue
    const opener = resolveDailySportSeasonStart('MLB', season.season)
    if (!opener || now.getTime() < Date.parse(opener)) continue
    const session = await db.draftSession.findFirst({ where: { leagueId: season.leagueId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { status: true, draftModeLabel: true } })
    if (session?.status !== 'completed') continue
    await db.$transaction(async tx => {
      const activated = await tx.league.updateMany({ where: { id: season.leagueId, lifecycleState: 'post_draft' }, data: { lifecycleState: 'in_season' } })
      if (activated.count) await tx.redraftSeason.updateMany({ where: { id: season.id, status: 'setup' }, data: { status: 'active', currentWeek: 1 } })
    })
  }
}
