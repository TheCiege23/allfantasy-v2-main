import 'server-only'

import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import { isMissingDatabaseObjectError } from '@/lib/canonical/getCanonicalPlayer'

/**
 * Follow a player across every league — retention item 3 (user decisions, 2026-09-14).
 *
 * The one place that reads or writes `player_follows`. The player card's ☆, the home
 * "Following" card, and (next) the brief, push senders and waiver nudges all go through
 * here, so what "following" means cannot drift between them.
 *
 * 🛑 RAW SQL, NOT A PRISMA MODEL, UNTIL THE MIGRATION IS APPLIED. The table is created by
 * `prisma/migrations-pending/20260914190000_player_follows`, whose apply is the user's call.
 * A model in schema.prisma before that would (a) raise P2021 on every query against a
 * database without the table, and (b) show up as NEW drift in the schema-drift guard on the
 * next schema push to main. The repo's rule for a new table is apply → model → writers; this
 * keeps the writers shippable without jumping that order. Once applied, swap these queries
 * for a model in one change.
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
