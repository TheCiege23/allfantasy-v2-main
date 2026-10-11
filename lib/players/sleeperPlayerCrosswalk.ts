import { toImageUrl } from '@/lib/media/imageUrl'
import 'server-only'

import { prisma } from '@/lib/prisma'
import { looksLikeSleeperExternalId } from '@/lib/draft-sports-models/player-asset-resolver'
import { sleeperHeadshotUrl } from '@/lib/player-media-urls'
import { sleeperIdWhere } from '@/lib/player-identity/externalIdNamespace'
import { buildNameIndex, normalizeMatchName, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

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
 *   id -> name   `SportsPlayer` resolves 150 of 201 sampled roster ids (75%),
 *                131 of them to the RIGHT player. Our own `redraft_roster_players`
 *                rows, which store the Sleeper id and the name side by side, cover
 *                the rest.
 *   name -> row  191 of 214 (89%), and every one of those has an image.
 *
 * ⚠ THE OLD NUMBERS HERE WERE MEASURED THROUGH A BROKEN QUERY AND FLATTERED IT.
 * This used to record "60 of 402 (15%)" for the first hop. That hop matched Sleeper
 * ids against `externalId`, which cannot reach a Sleeper-sourced row at all and
 * instead hit Rolling Insights rows that happen to carry the same bare number. Re-run
 * on 201 real roster ids: the old query resolved 121 and only 42 were the right
 * player — 79 were STRANGERS. Mike Evans came back as Harlan Miller, Justin Jefferson
 * as DaRon Bland, Jahmyr Gibbs as Mike Boone. Those names were going into grounding
 * blocks presented as fact. A low resolution rate was never the problem; a confidently
 * wrong one was.
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

/**
 * 🛑 A NAME IS NOT A ROW (2026-10-11). Both name hops below used to build
 * `new Map(rows.map(r => [name.toLowerCase(), r]))` — LAST row wins — over a `Player` table that
 * holds Justin Jefferson twice (WR/MIN, LB/CLE), Lamar Jackson twice (QB/BAL, CB) and Josh Allen
 * twice (QB/BUF, G). So the receiver could carry the linebacker's canonical id and headshot.
 *
 * Now: a name shared by several rows binds only when position and/or team single one out
 * (`resolveVerifiedMatch`), and a LONE row whose side of the ball contradicts the asker's is
 * refused too. Teams are compared as NFL abbreviations, because `SportsPlayer`'s Sleeper rows
 * spell them out ("Philadelphia Eagles") where `Player` writes `PHI`.
 */
type CanonicalRow = { id?: string; name: string; imageUrl: string | null; position: string | null; team: string | null }

function teamKey(team: string | null | undefined, sport: string): string | null {
  const t = String(team ?? '').trim()
  if (!t) return null
  return sport.toUpperCase() === 'NFL' ? normalizeTeamAbbrev(t) : t.toUpperCase()
}

function canonicalIndex<T extends CanonicalRow>(rows: T[], sport: string) {
  return buildNameIndex(rows.map((r) => ({ ...r, team: teamKey(r.team, sport), row: r })))
}

function matchCanonical<T extends CanonicalRow>(
  index: ReturnType<typeof canonicalIndex<T>>,
  lookup: { name: string; position?: string | null; team?: string | null },
  sport: string,
): T | null {
  const bucket = index.get(normalizeMatchName(lookup.name)) ?? []
  /*
   * A lone row is checked for side of ball only: `Player.team` lags trades, and a stale team on
   * the one row the name has is not evidence of a different man. A collision uses both.
   */
  const verifying =
    bucket.length === 1
      ? { name: lookup.name, position: lookup.position ?? null }
      : { name: lookup.name, position: lookup.position ?? null, team: teamKey(lookup.team, sport) }
  const m = resolveVerifiedMatch(index, verifying, { refuseContradictedSingle: true })
  return m.match ? m.match.row : null
}

/** One player to find an image for. A bare string is a name with nothing to verify it by. */
export type PlayerImageLookup = string | { name: string; position?: string | null; team?: string | null }

/** The key `resolveImagesByPlayerName` stores a lookup's image under. */
export function playerImageKey(lookup: PlayerImageLookup): string {
  const l = typeof lookup === 'string' ? { name: lookup } : lookup
  const pos = String(l.position ?? '').trim().toUpperCase()
  const team = String(l.team ?? '').trim().toUpperCase()
  return pos || team ? `${l.name.toLowerCase()}|${pos}|${team}` : l.name.toLowerCase()
}

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
  /*
   * ⚠ THESE ARE SLEEPER IDS AND THEY MUST NOT BE MATCHED AGAINST `externalId`.
   * This asked for `externalId: { in: ids }`, which cannot find a Sleeper-sourced row at all —
   * those store `sleeper:8144`, not `8144` — and instead matched Rolling Insights rows, whose
   * `externalId` IS a bare number. 42,032 bare ids collide with a Sleeper id and 42,031 of them
   * are a different person, so this hop was naming players after strangers, then writing that
   * name, position, team and photo into a grounding block presented as fact.
   */
  try {
    const rows = await prisma.sportsPlayer.findMany({
      where: sleeperIdWhere(ids, sportUpper),
      select: {
        externalId: true,
        sleeperId: true,
        name: true,
        position: true,
        team: true,
        imageUrl: true,
      },
    })
    for (const r of rows) {
      // A row can arrive by either spelling; both resolve back to the bare Sleeper id we asked for.
      const key =
        r.sleeperId ?? (r.externalId.startsWith('sleeper:') ? r.externalId.slice('sleeper:'.length) : null)
      if (!key) continue
      const entry = byId.get(key)
      if (!entry || !r.name) continue
      entry.name = r.name
      entry.position = r.position ?? null
      entry.team = r.team ?? null
      entry.source = 'sports_player'
      // A vendor placeholder (`contact_support`) must not overwrite a real Sleeper CDN URL.
      const img = toImageUrl(r.imageUrl)
      if (img) entry.imageUrl = img
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
       * Normalised (case, accents, punctuation) because the two tables were populated by
       * different pipelines and their spelling does not always agree — and verified by
       * position/team, because a shared name is several rows. See `matchCanonical`.
       */
      const index = canonicalIndex(rows, sport)
      for (const entry of named) {
        const hit = matchCanonical(
          index,
          { name: entry.name as string, position: entry.position, team: entry.team },
          sport,
        )
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
 * Read the result with `playerImageKey(lookup)`; misses are simply absent, never a
 * placeholder.
 *
 * 🛑 PASS POSITION AND TEAM. A bare name shared by several `Player` rows gets NO image — the
 * initials fallback is honest, another man's face is not.
 */
export async function resolveImagesByPlayerName(
  lookups: PlayerImageLookup[],
  sport: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const wanted = lookups
    .map((l) => (typeof l === 'string' ? { name: l } : l))
    .filter((l) => typeof l.name === 'string' && l.name.trim().length > 0)
    .slice(0, MAX_IDS)
  if (wanted.length === 0) return out
  try {
    const rows = await prisma.player.findMany({
      where: { name: { in: [...new Set(wanted.map((l) => l.name))] }, sport: { equals: sport, mode: 'insensitive' } },
      select: { name: true, imageUrl: true, position: true, team: true },
    })
    const index = canonicalIndex(rows, sport)
    for (const lookup of wanted) {
      const hit = matchCanonical(index, lookup, sport)
      if (hit?.imageUrl) out.set(playerImageKey(lookup), hit.imageUrl)
    }
  } catch {
    // No image is a legitimate outcome; the UI falls back to initials.
  }
  return out
}
