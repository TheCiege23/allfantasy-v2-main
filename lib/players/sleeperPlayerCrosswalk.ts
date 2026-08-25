import 'server-only'

import { prisma } from '@/lib/prisma'
import { looksLikeSleeperExternalId } from '@/lib/draft-sports-models/player-asset-resolver'
import { sleeperHeadshotUrl } from '@/lib/player-media-urls'

/**
 * SLEEPER PLAYER ID -> CANONICAL IDENTITY.
 *
 * ⚠ THE TWO ID SPACES DO NOT MEET, AND THERE IS NO COLUMN THAT JOINS THEM.
 * `Player.id` is a slug (`nfl-mante-morrow-a50bced6`) — measured against
 * production 2026-08-25, ZERO of 13,010 NFL rows carry a numeric id. Sleeper ids
 * (`5859`) arrive on rosters, on trades, and from the import pipeline. A direct
 * join returns nothing: 0 of 205 `redraft_roster_players` rows match `Player.id`.
 *
 * So identity is reconstructed in two hops — id to NAME, then name to the
 * canonical row — and every hop is measured rather than assumed:
 *
 *   id -> name   `SportsPlayer.externalId` resolves 60 of 402 traded ids (15%).
 *                Our own `redraft_roster_players` rows, which store the Sleeper
 *                id and the name side by side, add another 108 for a combined
 *                168 of 402 (42%).
 *   name -> row  191 of 214 (89%), and every one of those has an image.
 *
 * ⚠ 58% OF SLEEPER IDS STILL DO NOT RESOLVE, and the honest fix is ingesting
 * Sleeper's own ~12,200-entry player directory. Until that exists this returns
 * `unresolved` for the remainder — never a guess. A wrong name attached to a
 * trade or a start/sit call is the failure this module exists to prevent.
 *
 * ⚠ EVERY LOOKUP IS SPORT-FILTERED. `SportsPlayer.externalId` is unique only
 * WITHIN a sport — `340` is simultaneously an NBA, NCAAF, SOCCER, MLB and NCAAB
 * player — so an unfiltered query returns an arbitrary athlete, and a different
 * one run to run.
 */

export type SleeperPlayerIdentity = {
  sleeperId: string
  name: string | null
  position: string | null
  team: string | null
  /** `Player.id` when the name reached a canonical row. */
  canonicalPlayerId: string | null
  /** null means "no image", never a placeholder. */
  imageUrl: string | null
  /** Which hop produced the name, so callers can report confidence honestly. */
  source: 'sports_player' | 'roster' | 'unresolved'
}

export type SleeperCrosswalkResult = {
  byId: Map<string, SleeperPlayerIdentity>
  resolved: number
  unresolved: number
}

/** Guards the `IN` clauses; a trade or roster never legitimately exceeds this. */
const MAX_IDS = 300

function emptyIdentity(sleeperId: string, sport: string): SleeperPlayerIdentity {
  return {
    sleeperId,
    name: null,
    position: null,
    team: null,
    canonicalPlayerId: null,
    /*
     * Even with no name, a numeric Sleeper id yields a real CDN headshot — the
     * draft room has relied on this derivation for as long as it has existed.
     * An unnamed face is still the right face.
     */
    imageUrl: looksLikeSleeperExternalId(sleeperId)
      ? sleeperHeadshotUrl(sleeperId, sport.toLowerCase() as never)
      : null,
    source: 'unresolved',
  }
}

/**
 * Resolve Sleeper player ids to names, positions, teams and images.
 *
 * Never throws: a failed hop leaves those ids unresolved rather than failing the
 * caller, because a grounding block that reports "3 players I could not name" is
 * useful and one that returns nothing is not.
 */
export async function resolveSleeperPlayerIdentities(
  sleeperIds: string[],
  sport: string,
): Promise<SleeperCrosswalkResult> {
  const ids = [...new Set(sleeperIds.filter((id) => typeof id === 'string' && id.length > 0))].slice(
    0,
    MAX_IDS,
  )
  const byId = new Map<string, SleeperPlayerIdentity>()
  if (ids.length === 0) return { byId, resolved: 0, unresolved: 0 }

  for (const id of ids) byId.set(id, emptyIdentity(id, sport))

  const sportUpper = sport.toUpperCase()

  // ── Hop 1a: the provider-backed player table ───────────────────────────────
  try {
    const rows = await prisma.sportsPlayer.findMany({
      where: { externalId: { in: ids }, sport: sportUpper },
      select: { externalId: true, name: true, position: true, team: true, imageUrl: true },
    })
    for (const r of rows) {
      const entry = byId.get(r.externalId)
      if (!entry || !r.name) continue
      entry.name = r.name
      entry.position = r.position ?? null
      entry.team = r.team ?? null
      entry.source = 'sports_player'
      if (r.imageUrl) entry.imageUrl = r.imageUrl
    }
  } catch {
    /* leave those ids unresolved */
  }

  // ── Hop 1b: pairs we have already observed on our own rosters ──────────────
  const stillUnnamed = ids.filter((id) => !byId.get(id)?.name)
  if (stillUnnamed.length > 0) {
    try {
      const rows = await prisma.redraftRosterPlayer.findMany({
        where: { playerId: { in: stillUnnamed }, sport: { equals: sport, mode: 'insensitive' } },
        select: { playerId: true, playerName: true, position: true, team: true },
        distinct: ['playerId'],
      })
      for (const r of rows) {
        const entry = byId.get(r.playerId)
        if (!entry || !r.playerName) continue
        entry.name = r.playerName
        entry.position = r.position ?? entry.position
        entry.team = r.team ?? entry.team
        entry.source = 'roster'
      }
    } catch {
      /* leave those ids unresolved */
    }
  }

  // ── Hop 2: name to the canonical row, for the id and the image ─────────────
  const named = [...byId.values()].filter((e) => e.name)
  if (named.length > 0) {
    try {
      const rows = await prisma.player.findMany({
        where: { name: { in: named.map((e) => e.name as string) }, sport: { equals: sport, mode: 'insensitive' } },
        select: { id: true, name: true, imageUrl: true, position: true, team: true },
      })
      /*
       * Lower-cased because the two tables were populated by different pipelines
       * and their casing does not always agree; a case-only mismatch would drop a
       * player who is in fact present.
       */
      const canonical = new Map(rows.map((r) => [r.name.toLowerCase(), r]))
      for (const entry of named) {
        const hit = canonical.get((entry.name as string).toLowerCase())
        if (!hit) continue
        entry.canonicalPlayerId = hit.id
        entry.position = entry.position ?? hit.position ?? null
        entry.team = entry.team ?? hit.team ?? null
        if (hit.imageUrl) entry.imageUrl = hit.imageUrl
      }
    } catch {
      /* names still stand; only the canonical id and image are missing */
    }
  }

  let resolved = 0
  for (const entry of byId.values()) if (entry.name) resolved += 1

  return { byId, resolved, unresolved: byId.size - resolved }
}

/**
 * Canonical images for players we already know the NAME of but whose id is not a
 * Sleeper id — the `name:Brian Thomas Jr.:WR:JAX` synthetic keys that rosters
 * carry, which no id-based lookup can ever resolve.
 *
 * Worth its own entry point because the name hop is the strong one: 191 of 214
 * roster names reach a canonical row, and every one of those rows has an image.
 * Returns a lower-cased-name map; misses are simply absent, never a placeholder.
 */
export async function resolveImagesByPlayerName(
  names: string[],
  sport: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const wanted = [...new Set(names.filter((n) => typeof n === 'string' && n.trim().length > 0))].slice(
    0,
    MAX_IDS,
  )
  if (wanted.length === 0) return out
  try {
    const rows = await prisma.player.findMany({
      where: { name: { in: wanted }, sport: { equals: sport, mode: 'insensitive' } },
      select: { name: true, imageUrl: true },
    })
    for (const r of rows) {
      if (r.imageUrl) out.set(r.name.toLowerCase(), r.imageUrl)
    }
  } catch {
    // No image is a legitimate outcome; the UI falls back to initials.
  }
  return out
}
