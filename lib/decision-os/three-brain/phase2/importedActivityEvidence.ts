import 'server-only'

import { prisma as defaultPrisma } from '@/lib/prisma'

type PrismaLike = typeof defaultPrisma

/**
 * Evidence source for IMPORTED leagues.
 *
 * `loadLeagueSourceVersion` reads `intelligence_league_snapshot`, which is a projection of NATIVE
 * `DomainEvent`s — in-app behaviour. An imported league emits almost none of those, so it never
 * produces a snapshot and can never reach the evidence stage. Measured on production 2026-08-20:
 * **4 of 98 leagues** could resolve evidence, and those four were native/manual leagues in `setup`
 * carrying 1–4 real events between them.
 *
 * The behaviour of the imported leagues does exist — 6,436 rows in `decision_os_imported_activity`
 * across **42 leagues**, every one carrying manager attribution (403 distinct managers). It was
 * simply on the other side of a join nothing crossed. This module crosses it.
 *
 * ⚠ IMPORTED ACTIVITY IS NOT NATIVE BEHAVIOUR, and the packet must never present it as though it
 * were. It is provider history replayed from a read-only shadow league: it can be incomplete, it
 * stops at whatever the provider exposes, and nobody performed those actions inside this product.
 * Callers mark it explicitly — see `provenance` below and the `imported_activity` fact source.
 */
export type ImportedActivityEvidence = {
  /** Content-derived version. Any new row changes it, so unchanged evidence keeps one identity. */
  version: string
  lastActivityAt: Date | null
  total: number
  trades: number
  waivers: number
  /** Adds/drops. Deliberately NOT folded into the snapshot's `lineupCount` — a roster move is not a
   *  starting-lineup change, and mapping it there would overstate lineup engagement. */
  rosterMoves: number
  draftPicks: number
  /** Other/unrecognised activity types, counted rather than silently dropped. */
  other: number
  /** Distinct managers attributable from `normalized.managerKeys`. */
  managerCount: number
}

type Row = { activityType: string | null; occurredAt: Date | null; normalized: unknown }

function managerKeysOf(normalized: unknown): string[] {
  const raw = (normalized as { managerKeys?: unknown } | null | undefined)?.managerKeys
  if (!Array.isArray(raw)) return []
  return raw.filter((k): k is string => typeof k === 'string' && k.length > 0)
}

/**
 * Aggregate a league's imported activity into a deterministic evidence summary, or null when there
 * is none. Returning null is the honest answer — the caller then refuses rather than analysing an
 * empty packet.
 */
export async function loadImportedActivityEvidence(
  db: PrismaLike,
  leagueId: string,
): Promise<ImportedActivityEvidence | null> {
  // The generated delegate is absent in some environments (same honest-refusal precedent as the
  // activity-ingest cron). Without it we cannot read imported activity at all.
  const delegate = (db as unknown as {
    decisionOsImportedActivity?: {
      findMany(args: unknown): Promise<Row[]>
    }
  }).decisionOsImportedActivity
  if (!delegate) return null

  const rows = await delegate
    .findMany({
      where: { afLeagueId: leagueId },
      select: { activityType: true, occurredAt: true, normalized: true },
    })
    .catch(() => [] as Row[])

  if (rows.length === 0) return null

  let trades = 0, waivers = 0, rosterMoves = 0, draftPicks = 0, other = 0
  let lastActivityAt: Date | null = null
  const managers = new Set<string>()

  for (const r of rows) {
    switch (r.activityType) {
      case 'trade': trades += 1; break
      case 'waiver': waivers += 1; break
      case 'roster_move': rosterMoves += 1; break
      case 'draft_pick': draftPicks += 1; break
      default: other += 1
    }
    if (r.occurredAt && (!lastActivityAt || r.occurredAt > lastActivityAt)) lastActivityAt = r.occurredAt
    for (const k of managerKeysOf(r.normalized)) managers.add(k)
  }

  // CONTENT-based version, matching `loadLeagueSourceVersion`'s contract: derived from the semantic
  // counts and the real activity timestamp, never a row write-time. A re-ingest that changes nothing
  // must NOT look like a material change — that would invalidate cached analyses and force provider
  // spend for evidence that did not move.
  const version = [
    'imported-v1',
    lastActivityAt ? lastActivityAt.toISOString() : 'none',
    rows.length, trades, waivers, rosterMoves, draftPicks, other, managers.size,
  ].join(':')

  return {
    version,
    lastActivityAt,
    total: rows.length,
    trades,
    waivers,
    rosterMoves,
    draftPicks,
    other,
    managerCount: managers.size,
  }
}
