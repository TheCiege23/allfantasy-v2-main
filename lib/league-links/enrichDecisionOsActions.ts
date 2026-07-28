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
import type { DecisionOsActionLinks, LineupActionItem, LineupCheckLeagueBlock } from '@/lib/lineup-actions/types'
import { resolveSourceLink, normalizeSourcePlatform, type SourceActionType, type SourceLink } from './sourceLinkResolver'
import { decisionActionConfig, internalActionHref, lineupBlockActionConfig } from './decisionOsActionMap'

const CANONICAL_LEAGUE_SELECT = {
  id: true, platform: true, platformLeagueId: true, name: true, season: true, lastSyncedAt: true,
} as const

/**
 * Build a per-league action bundle (internal AF analysis + secure external source action) for surfaces
 * grouped BY LEAGUE — pending trades, waiver recommendations, and per-league lineup blocks. Resolves the
 * external link SERVER-SIDE from the CANONICAL League row (one query), never from anything the caller
 * carries. Internal action is always offered; external only for an imported league whose link resolves.
 */
export async function buildLeagueActionBundles(
  entries: Array<{ leagueId: string; leagueName?: string | null }>,
  cfg: { action: SourceActionType; internalLabel: string; internalTab: string; externalLabel: (leagueName: string) => string },
): Promise<Map<string, DecisionOsActionLinks>> {
  const out = new Map<string, DecisionOsActionLinks>()
  const ids = Array.from(new Set(entries.map((e) => e.leagueId).filter(Boolean)))
  if (!ids.length) return out
  const leagues = await prisma.league.findMany({ where: { id: { in: ids } }, select: CANONICAL_LEAGUE_SELECT })
  const byId = new Map(leagues.map((l) => [l.id, l]))
  for (const e of entries) {
    if (out.has(e.leagueId)) continue
    const league = byId.get(e.leagueId) ?? null
    const imported = league ? normalizeSourcePlatform(league.platform) !== null : false
    const leagueName = league?.name ?? e.leagueName ?? 'your league'
    let external: { link: SourceLink; label: string } | null = null
    if (imported && league) {
      const link = resolveSourceLink({
        platform: league.platform,
        sourceLeagueId: league.platformLeagueId,
        leagueName,
        season: league.season,
        action: cfg.action,
      })
      // A homepage fallback must NEVER claim a specific trade/waiver/lineup page — show the honest
      // "Go to {provider}" label the resolver produced; only a real league page gets the action CTA.
      if (link) external = { link, label: link.isFallback ? link.label : cfg.externalLabel(leagueName) }
    }
    out.set(e.leagueId, {
      actionable: true,
      imported,
      dataAsOf: league?.lastSyncedAt ? league.lastSyncedAt.toISOString() : null,
      internal: { href: internalActionHref(e.leagueId, cfg.internalTab), label: cfg.internalLabel },
      external,
    })
  }
  return out
}

/**
 * Enrich per-league lineup blocks (LineupIssuesModal) with a source action. The block's action is derived
 * from its issue types (`lineupBlockActionConfig`, not display text); the external link is resolved
 * SERVER-SIDE from the canonical League (one query), imported + actionable only.
 */
export async function enrichLineupBlocksWithLinks(
  blocks: LineupCheckLeagueBlock[],
): Promise<LineupCheckLeagueBlock[]> {
  if (!blocks.length) return blocks
  const ids = Array.from(new Set(blocks.map((b) => b.leagueId).filter(Boolean)))
  const leagues = ids.length
    ? await prisma.league.findMany({ where: { id: { in: ids } }, select: CANONICAL_LEAGUE_SELECT })
    : []
  const byId = new Map(leagues.map((l) => [l.id, l]))
  return blocks.map((block) => {
    const league = byId.get(block.leagueId) ?? null
    const cfg = lineupBlockActionConfig(block.issues.map((i) => i.type))
    const imported = league ? normalizeSourcePlatform(league.platform) !== null : false
    const leagueName = league?.name ?? block.leagueName
    const internal = cfg.internalLabel
      ? { href: internalActionHref(block.leagueId, cfg.internalTab), label: cfg.internalLabel }
      : null
    let external: { link: SourceLink; label: string } | null = null
    if (cfg.actionable && cfg.action && imported && league) {
      const link = resolveSourceLink({
        platform: league.platform,
        sourceLeagueId: league.platformLeagueId,
        leagueName,
        season: league.season,
        action: cfg.action,
      })
      if (link) external = { link, label: link.isFallback ? link.label : cfg.externalLabel(leagueName) }
    }
    return {
      ...block,
      actionLinks: {
        actionable: cfg.actionable,
        imported,
        dataAsOf: league?.lastSyncedAt ? league.lastSyncedAt.toISOString() : null,
        internal,
        external,
      },
    }
  })
}

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
      // A homepage fallback must NEVER claim a specific trade/waiver/lineup page — show the honest
      // "Go to {provider}" label the resolver produced; only a real league page gets the action CTA.
      if (link) external = { link, label: link.isFallback ? link.label : cfg.externalLabel(leagueName) }
    }

    return {
      ...item,
      actionLinks: { actionable: cfg.actionable, imported, dataAsOf, internal, external },
    }
  })
}
