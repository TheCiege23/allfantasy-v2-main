import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  BACKUP_CAP,
  DEPTH_CHART_MAX_AGE_DAYS,
  DEPTH_FANTASY_SLOTS,
  parseDepthPlayers,
  pickDepthRow,
  presenceCells,
  type BackupCell,
  type DepthChartView,
  type DepthEntry,
} from './depthChart'
import { resolveLeagueSlots } from './playerFinder'
import { waiverClaimLink } from './platformLinks'
import { playerRef } from './playerRef'

/**
 * Loader for the finder's depth-chart card (depthChart.ts has the shape and the rules).
 *
 * DB-first: `depth_charts` is written weekly by /api/cron/import-depth-charts (NFL only is kept
 * current — measured 2026-09-28, every other sport's rows date from May). Vendor ids reach Sleeper ids
 * through `PlayerIdentityMap.rollingInsightsId`: 545 of 552 fantasy-spot entries map to exactly one
 * Sleeper id, none ambiguously.
 *
 * ⚠ A LINK ONLY WHEN THE REF ROUND-TRIPS. The finder resolves `NFL:<externalId>` to the row with the
 * highest sleeperId under that externalId, and bare NFL externalIds have collided across providers
 * before (#1511). So a backup's name is a link only when EVERY NFL row under the chosen externalId that
 * carries a sleeperId carries HIS — otherwise the link could open another player's card. Measured: all
 * 545 round-trip today; the check is what keeps that true tomorrow.
 */

type ChartRow = { team: string; position: string; players: unknown; fetchedAt: Date }

export async function loadDepthChartView(args: {
  sleeperId: string | null
  sport: string
  userId: string | null
  /** The leagues in scope; empty when signed out or unread — then no presence is computed. */
  leagueIds: readonly string[]
  now?: Date
}): Promise<DepthChartView | null> {
  if (args.sport !== 'NFL' || !args.sleeperId) return null
  const now = args.now ?? new Date()

  const me = await prisma.playerIdentityMap.findFirst({
    where: { sport: 'NFL', sleeperId: args.sleeperId, rollingInsightsId: { not: null } },
    select: { rollingInsightsId: true },
  })
  const riId = me?.rollingInsightsId ?? null
  if (!riId) return null

  const rows = await prisma.$queryRaw<ChartRow[]>(Prisma.sql`
    SELECT team, position, players, "fetchedAt"
    FROM depth_charts
    WHERE sport = 'NFL'
      AND source = 'rolling_insights'
      AND position IN (${Prisma.join([...DEPTH_FANTASY_SLOTS])})
      AND players::jsonb @> jsonb_build_array(jsonb_build_object('id', ${riId}::text))
  `)
  const row = pickDepthRow(
    rows.map((r) => ({ ...r, players: parseDepthPlayers(r.players) })),
    riId,
  )
  if (!row) return null
  const fetchedAt = new Date(row.fetchedAt)
  if (!(now.getTime() - fetchedAt.getTime() <= DEPTH_CHART_MAX_AGE_DAYS * 86_400_000)) return null

  // Vendor id -> Sleeper id, only where the map names exactly one.
  const riIds = [...new Set(row.players.map((p) => p.id))]
  const maps = await prisma.playerIdentityMap.findMany({
    where: { sport: 'NFL', rollingInsightsId: { in: riIds } },
    select: { rollingInsightsId: true, sleeperId: true },
  })
  const sleeperByRi = new Map<string, string | null>()
  for (const m of maps) {
    if (!m.rollingInsightsId) continue
    sleeperByRi.set(m.rollingInsightsId, sleeperByRi.has(m.rollingInsightsId) ? null : m.sleeperId ?? null)
  }

  const refBySleeper = await roundTripRefs([...sleeperByRi.values()].filter((s): s is string => Boolean(s)))

  const entries: DepthEntry[] = row.players.map((p, i) => {
    const sleeperId = p.id === riId ? args.sleeperId : sleeperByRi.get(p.id) ?? null
    return { depth: i + 1, name: p.name, sleeperId, ref: sleeperId ? refBySleeper.get(sleeperId) ?? null : null, isHim: p.id === riId }
  })

  const presence = args.userId && args.leagueIds.length > 0 ? await loadPresence(entries, args.userId, args.leagueIds) : null

  return { team: row.team, slot: row.position, asOfIso: fetchedAt.toISOString(), hisDepth: row.depth, entries, presence }
}

/** sleeperId -> `NFL:<externalId>` for the ids whose ref resolves back to them (see the header). */
async function roundTripRefs(sleeperIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (sleeperIds.length === 0) return out
  const own = await prisma.sportsPlayer.findMany({
    where: { sport: 'NFL', sleeperId: { in: [...sleeperIds] } },
    select: { externalId: true, sleeperId: true, source: true, fetchedAt: true },
  })
  // Prefer the vendor's own row (the one search results link to), then the newest.
  own.sort((a, b) => Number(b.source === 'rolling_insights') - Number(a.source === 'rolling_insights') || +new Date(b.fetchedAt) - +new Date(a.fetchedAt))
  const chosen = new Map<string, string>()
  for (const r of own) if (r.sleeperId && !chosen.has(r.sleeperId)) chosen.set(r.sleeperId, r.externalId)
  if (chosen.size === 0) return out

  const sharing = await prisma.sportsPlayer.findMany({
    where: { sport: 'NFL', externalId: { in: [...new Set(chosen.values())] }, sleeperId: { not: null } },
    select: { externalId: true, sleeperId: true },
  })
  const claimants = new Map<string, Set<string>>()
  for (const r of sharing) {
    const set = claimants.get(r.externalId) ?? new Set<string>()
    if (r.sleeperId) set.add(r.sleeperId)
    claimants.set(r.externalId, set)
  }
  for (const [sid, ext] of chosen) {
    const who = claimants.get(ext)
    if (who && who.size === 1 && who.has(sid)) out.set(sid, playerRef('NFL', ext))
  }
  return out
}

async function loadPresence(entries: readonly DepthEntry[], userId: string, leagueIds: readonly string[]): Promise<Record<string, BackupCell[]> | null> {
  const backups = entries.filter((e) => !e.isHim && e.sleeperId).slice(0, BACKUP_CAP)
  if (backups.length === 0) return null
  const ids = [...leagueIds]
  const leagues = await prisma.league
    .findMany({ where: { id: { in: ids } }, select: { id: true, name: true, platform: true, platformLeagueId: true, season: true } })
    .catch(() => [] as Array<{ id: string; name: string | null; platform: string | null; platformLeagueId: string | null; season: number | null }>)
  if (leagues.length === 0) return null
  const byId = new Map(leagues.map((l) => [l.id, l]))
  const named = leagues.map((l) => ({ id: l.id, name: l.name ?? 'League' }))
  const claimFor = (leagueId: string) => {
    const l = byId.get(leagueId)
    return l ? waiverClaimLink({ id: l.id, platform: l.platform, platformLeagueId: l.platformLeagueId, season: l.season, name: l.name }) : null
  }

  const reads = await Promise.all(
    backups.map(async (b) => {
      const got = await resolveLeagueSlots(b.sleeperId!, ids, userId).catch(() => null)
      // A failed read is not "free everywhere" — the backup gets no cells rather than wrong ones.
      return [b.sleeperId!, got ? presenceCells(named, got.slots, got.unmatched, claimFor) : null] as const
    }),
  )
  const out: Record<string, BackupCell[]> = {}
  for (const [sid, cells] of reads) if (cells) out[sid] = cells
  return Object.keys(out).length > 0 ? out : null
}
