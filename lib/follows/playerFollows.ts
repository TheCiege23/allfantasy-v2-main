import 'server-only'

import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import { isMissingDatabaseObjectError } from '@/lib/canonical/getCanonicalPlayer'
import { newsClub, type NewsIdentityCandidate } from '@/lib/notifications/newsPlayerBinding'
import { buildNameIndex, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'

/**
 * Follow a player across every league — retention item 3 (user decisions, 2026-09-14).
 *
 * The one place that reads or writes `player_follows`. The player card's ☆, the home
 * "Following" card, and (next) the brief, push senders and waiver nudges all go through
 * here, so what "following" means cannot drift between them.
 *
 * RAW SQL, ON PURPOSE. The table comes from `prisma/migrations/20260914190000_player_follows`,
 * applied to production 2026-09-16, and `model PlayerFollow` now mirrors it. These queries stay
 * raw: the follow is an `INSERT … ON CONFLICT` that refreshes the snapshot columns, and the news
 * lookup matches on `lower(name)`, whose index Prisma cannot express. A database without the
 * table (an old branch or test DB) still reads as "follows unavailable" through the 42P01 checks
 * below.
 *
 * ⚠ A MISSING TABLE IS "UNAVAILABLE", NEVER "NOT FOLLOWING". Every read returns `null` for
 * 42P01, so a surface can hide the feature instead of showing an empty list that reads as
 * "you follow nobody" — and a write reports `unavailable` so the star can revert rather than
 * pretend it saved. Any other database error propagates to the caller.
 *
 * ⚠ THE KEY IS THE SLEEPER ID WHEN HE HAS ONE. Every NFL surface in Core joins on it. The
 * same player arrives as several `SportsPlayer` rows (one per provider) with different
 * `externalId`s, so keying on externalId would lose a follow the day a newer row wins. A
 * player with no Sleeper id (other sports) falls back to his externalId.
 */

export const MAX_PLAYER_FOLLOWS = 50

export type PlayerFollow = {
  sport: string
  playerKey: string
  externalId: string | null
  sleeperId: string | null
  name: string
  position: string | null
  team: string | null
  createdAt: Date
}

export type FollowPlayerInput = {
  sport: string
  externalId: string | null
  sleeperId: string | null
  name: string
  position: string | null
  team: string | null
}

export type FollowResult = 'followed' | 'limit' | 'unavailable' | 'invalid'

export function normalizeFollowSport(sport: string): string {
  return String(sport ?? '').trim().toUpperCase()
}

export function followKeyFor(p: { sleeperId?: string | null; externalId?: string | null }): string | null {
  return p.sleeperId?.trim() || p.externalId?.trim() || null
}

type FollowRow = {
  sport: string
  player_key: string
  external_id: string | null
  sleeper_id: string | null
  name: string
  position: string | null
  team: string | null
  created_at: Date
}

/** Newest first. `null` when follows are unavailable (the table does not exist yet). */
export async function listPlayerFollows(userId: string, limit = MAX_PLAYER_FOLLOWS): Promise<PlayerFollow[] | null> {
  if (!userId) return []
  try {
    const rows = await prisma.$queryRaw<FollowRow[]>`
      SELECT "sport", "player_key", "external_id", "sleeper_id", "name", "position", "team", "created_at"
      FROM "player_follows"
      WHERE "user_id" = ${userId}
      ORDER BY "created_at" DESC
      LIMIT ${Math.max(1, Math.min(limit, MAX_PLAYER_FOLLOWS))}
    `
    return rows.map((r) => ({
      sport: r.sport,
      playerKey: r.player_key,
      externalId: r.external_id,
      sleeperId: r.sleeper_id,
      name: r.name,
      position: r.position,
      team: r.team,
      createdAt: r.created_at,
    }))
  } catch (err) {
    if (isMissingDatabaseObjectError(err)) return null
    throw err
  }
}

/** `null` when follows are unavailable, so the card can fall back instead of showing an unlit star. */
export async function isFollowingPlayer(userId: string, sport: string, playerKey: string): Promise<boolean | null> {
  if (!userId || !playerKey) return false
  try {
    const rows = await prisma.$queryRaw<Array<{ one: number }>>`
      SELECT 1 AS "one" FROM "player_follows"
      WHERE "user_id" = ${userId} AND "sport" = ${normalizeFollowSport(sport)} AND "player_key" = ${playerKey}
      LIMIT 1
    `
    return rows.length > 0
  } catch (err) {
    if (isMissingDatabaseObjectError(err)) return null
    throw err
  }
}

/**
 * Follow him. Re-following refreshes the name/position/team snapshot (a traded player's
 * row should not keep his old team) and never counts against the limit.
 */
export async function followPlayer(userId: string, input: FollowPlayerInput): Promise<FollowResult> {
  const sport = normalizeFollowSport(input.sport)
  const key = followKeyFor(input)
  if (!userId || !sport || !key || !input.name?.trim()) return 'invalid'
  try {
    const [held] = await prisma.$queryRaw<Array<{ n: number; mine: boolean | null }>>`
      SELECT count(*)::int AS "n", bool_or("sport" = ${sport} AND "player_key" = ${key}) AS "mine"
      FROM "player_follows"
      WHERE "user_id" = ${userId}
    `
    if (!held?.mine && Number(held?.n ?? 0) >= MAX_PLAYER_FOLLOWS) return 'limit'

    await prisma.$executeRaw`
      INSERT INTO "player_follows"
        ("id", "user_id", "sport", "player_key", "external_id", "sleeper_id", "name", "position", "team")
      VALUES
        (${randomUUID()}, ${userId}, ${sport}, ${key}, ${input.externalId}, ${input.sleeperId},
         ${input.name.trim()}, ${input.position}, ${input.team})
      ON CONFLICT ("user_id", "sport", "player_key") DO UPDATE SET
        "external_id" = EXCLUDED."external_id",
        "sleeper_id"  = EXCLUDED."sleeper_id",
        "name"        = EXCLUDED."name",
        "position"    = EXCLUDED."position",
        "team"        = EXCLUDED."team"
    `
    return 'followed'
  } catch (err) {
    if (isMissingDatabaseObjectError(err)) return 'unavailable'
    throw err
  }
}

/**
 * Everyone following ONE player, for the news sender — keyed on his Sleeper id, never on his name.
 *
 * 🛑 THIS WAS `lower(name) = lower(<news name>)` (until 2026-10-11), and a name is not a player:
 * a follow of QB Josh Allen (BUF) matched every story about DL Josh Allen (JAX), and the reverse —
 * and QB Josh Allen is a live follow in production. Now:
 *   - a follow carrying a `sleeper_id` is his only when that id IS his; any other id is some other
 *     player, whatever the snapshot name says;
 *   - a follow with only a name (no Sleeper id — other sports) is resolved against the same registry
 *     candidates the story was bound with, using its own position and team snapshot, and counts only
 *     if verified matching lands on THIS identity. An ambiguous follow is refused.
 *
 * The caller binds the story first (lib/notifications/newsPlayerBinding) and must not call this for
 * a story it could not bind. `null` when follows are unavailable, so a sender skips rather than
 * treating it as "nobody".
 */
export async function listFollowerIdsForPlayerIdentity(
  sport: string,
  player: {
    identity: NewsIdentityCandidate
    /** Every registry identity sharing the name, `identity` included. */
    candidates: readonly NewsIdentityCandidate[]
    /** The name as the story spelled it, so a follow stored under that spelling is still seen. */
    newsName?: string | null
  },
  limit = 5000,
): Promise<string[] | null> {
  const S = normalizeFollowSport(sport)
  const sleeperId = player.identity.sleeperId?.trim() || null
  const canonical = String(player.identity.name ?? '').trim()
  const spelled = String(player.newsName ?? '').trim() || canonical
  if (!S || !canonical) return []
  type Row = { user_id: string; sleeper_id: string | null; name: string; position: string | null; team: string | null }
  let rows: Row[]
  try {
    rows = await prisma.$queryRaw<Row[]>`
      SELECT "user_id", "sleeper_id", "name", "position", "team" FROM "player_follows"
      WHERE "sport" = ${S}
        AND ("sleeper_id" = ${sleeperId ?? ''} OR lower("name") = lower(${canonical}) OR lower("name") = lower(${spelled}))
      LIMIT ${limit}
    `
  } catch (err) {
    if (isMissingDatabaseObjectError(err)) return null
    throw err
  }
  const index = buildNameIndex([...player.candidates])
  const out = new Set<string>()
  for (const r of rows) {
    const followed = r.sleeper_id?.trim() || null
    if (followed) {
      if (sleeperId && followed === sleeperId) out.add(r.user_id)
      continue
    }
    const m = resolveVerifiedMatch(index, { name: r.name, position: r.position, team: newsClub(r.team, S) })
    if (m.match?.id === player.identity.id) out.add(r.user_id)
  }
  return [...out]
}

/**
 * Everyone following at least one player of this sport who carries a Sleeper id — the audience of
 * the "he's free in your league" alert (lib/follows/followFreeAgentCheck.ts), whose roster join is
 * Sleeper-keyed. Most recently active followers first, so a capped run reaches people still using
 * the feature. `null` when follows are unavailable.
 */
export async function listFollowingUserIds(sport: string, limit = 500): Promise<string[] | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ user_id: string }>>`
      SELECT "user_id" FROM "player_follows"
      WHERE "sport" = ${normalizeFollowSport(sport)} AND "sleeper_id" IS NOT NULL
      GROUP BY "user_id"
      ORDER BY max("created_at") DESC
      LIMIT ${Math.max(1, limit)}
    `
    return rows.map((r) => r.user_id)
  } catch (err) {
    if (isMissingDatabaseObjectError(err)) return null
    throw err
  }
}

export async function unfollowPlayer(
  userId: string,
  sport: string,
  playerKey: string,
): Promise<'unfollowed' | 'unavailable'> {
  if (!userId || !playerKey) return 'unfollowed'
  try {
    await prisma.$executeRaw`
      DELETE FROM "player_follows"
      WHERE "user_id" = ${userId} AND "sport" = ${normalizeFollowSport(sport)} AND "player_key" = ${playerKey}
    `
    return 'unfollowed'
  } catch (err) {
    if (isMissingDatabaseObjectError(err)) return 'unavailable'
    throw err
  }
}
