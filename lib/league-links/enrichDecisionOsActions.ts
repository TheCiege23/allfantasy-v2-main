/**
 * Server-side enricher: attach `actionLinks` (internal AF analysis + external source-platform action) to
 * live Decision OS lineup-action items.
 *
 * SECURITY / DB-first contract:
 *  - The external link is resolved from the CANONICAL `League` row (platform / platformLeagueId / name /
 *    season) looked up by the item's internal `leagueId` — NEVER from a URL carried by the item, the
 *    cached Decision OS payload, or the client. Items hold no navigation URL by design; even if a future
 *    payload smuggled one in, this enricher ignores it.
 *  - No provider API call — resolution is pure over stored data (safe on the render/response path).
 *  - Each item's link is keyed to its OWN leagueId, so one league's action can never appear on another's.
 *  - A missing/native league fails safe (no external action; internal AF action still offered).
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import type { LineupActionItem } from '@/lib/lineup-actions/types'
import { resolveSourceLink, normalizeSourcePlatform, type SourceLink } from './sourceLinkResolver'
import { decisionActionConfig, internalActionHref } from './decisionOsActionMap'

export async function enrichLineupActionsWithLinks(
  items: LineupActionItem[],
): Promise<LineupActionItem[]> {
  if (!items.length) return items

  const ids = Array.from(new Set(items.map((i) => i.leagueId).filter(Boolean)))
  const leagues = ids.length
    ? await prisma.league.findMany({
        where: { id: { in: ids } },
        select: { id: true, platform: true, platformLeagueId: true, name: true, season: true, lastSyncedAt: true },
      })
    : []
  const byId = new Map(leagues.map((l) => [l.id, l]))

  return items.map((item) => {
    const league = byId.get(item.leagueId) ?? null
    const cfg = decisionActionConfig(item.reasonType)
    const imported = league ? normalizeSourcePlatform(league.platform) !== null : false
    const dataAsOf = league?.lastSyncedAt ? league.lastSyncedAt.toISOString() : null

    // Internal AF analysis — available for native + imported leagues (never external).
    const internal = cfg.internalLabel
      ? { href: internalActionHref(item.leagueId, cfg.internalTab), label: cfg.internalLabel }
      : null

    // External source-platform action — resolved SERVER-SIDE from canonical data, imported + actionable only.
    let external: { link: SourceLink; label: string } | null = null
    if (cfg.actionable && cfg.action && imported && league) {
      const leagueName = league.name ?? item.leagueName
      const link = resolveSourceLink({
        platform: league.platform,
        sourceLeagueId: league.platformLeagueId,
        leagueName,
        season: league.season,
        action: cfg.action,
      })
      if (link) external = { link, label: cfg.externalLabel(leagueName) }
    }

    return {
      ...item,
      actionLinks: { actionable: cfg.actionable, imported, dataAsOf, internal, external },
    }
  })
}
