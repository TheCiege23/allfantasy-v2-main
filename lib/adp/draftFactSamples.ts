import 'server-only'

import { prisma } from '@/lib/prisma'
import type { AggregatablePick } from '@/lib/adp/computeAllFantasyAdp'

/**
 * Imported league drafts, as ADP samples.
 *
 * WHY THIS EXISTS. `SleeperHistoricalDraftSyncService` writes every draft it can reach from an
 * imported league into `DraftFact` (`dw_draft_facts`). The AllFantasy ADP recompute reads
 * `DraftPick`. Two different tables, no bridge — so importing a league with ten seasons of draft
 * history contributed exactly nothing to our own ADP. This is the bridge.
 *
 * 🛑 THE OBVIOUS FIX — DUAL-WRITING `DraftPick` FROM THE HISTORICAL SYNC — IS NOT POSSIBLE TODAY.
 * `DraftSession.leagueId` is `@unique`: one session per league, ever. Ten seasons of drafts cannot
 * be represented as ten sessions without a schema change, so reading the facts where they already
 * live is the only route that does not require a migration.
 *
 * ⚠ `draftType` IS RECORDED AS `imported`, AND THAT IS DELIBERATE — DO NOT "FIX" IT TO `snake`.
 * `DraftFact` carries no draft type. Sleeper runs snake, linear AND auction drafts, and an auction
 * is not comparable to a snake board at all — yet its pick numbers still increment 1..N, so an
 * auction is indistinguishable from a snake draft in this table. Defaulting to `snake` would
 * silently fold auction results into the snake ADP a live draft room reads, and nothing would ever
 * surface it: the numbers would simply be wrong, and confident.
 *
 * `draftType` is part of the context hash, so `imported` keeps these samples on their OWN board.
 * They cannot corrupt a live one, they are queryable in their own right, and the day `DraftFact`
 * gains a `draftType` column they can be merged deliberately rather than by assumption.
 *
 * ⚠ TEAM COUNT IS DERIVED FROM THE DRAFT, NOT FROM THE LEAGUE ROW. `League.leagueSize` is today's
 * size; a 2023 draft in a league that has since expanded would be described by the wrong number,
 * and `teamCount` is also part of the context hash. Round 1 holds exactly one pick per team, so
 * counting round-1 facts measures the draft that actually happened. A group with no round-1 facts
 * is skipped rather than guessed.
 *
 * ⚠ `pickedAt` IS NULL, NOT `DraftFact.createdAt`. That column is when the IMPORT ran, not when the
 * pick was made. Stamping it would date a 2019 draft to this morning.
 */

/** Sleeper ids resolve to a name and position through the canonical identity map. */
interface ResolvedPlayer {
  name: string
  position: string
}

export interface DraftFactSampleOptions {
  /** Prisma `LeagueSport` value. Required — these facts are never scanned across all sports. */
  sport: string
  /** Restrict to one season. Null scans every season the import captured. */
  season?: string | null
  /** Bound on facts read in one pass, so a recompute cannot be dragged under by a large import. */
  maxFacts?: number
}

export interface DraftFactSampleResult {
  picks: AggregatablePick[]
  factsScanned: number
  /** Sleeper ids with no canonical identity row. Reported, never silently dropped. */
  skippedUnresolvedPlayer: number
  /** Draft groups with no measurable round-1 team count. */
  skippedNoTeamCount: number
  /** Facts whose league row is missing (deleted league, orphaned facts). */
  skippedNoLeague: number
  draftsCovered: number
}

const DEFAULT_MAX_FACTS = 200_000

/**
 * Resolve Sleeper player ids to name + position.
 *
 * `PlayerIdentityMap` is canonical and its `sleeperId` is unique. `SportsPlayer` is the fallback,
 * because the identity sync can lag a freshly-added Sleeper id.
 *
 * A player we cannot name is discarded entirely. `aggregateAdp` keys on `name|position`, so an
 * unnamed pick would collapse every unknown player into one shared key — a single fabricated
 * "player" whose ADP is the mean of everyone we failed to identify.
 */
async function resolvePlayers(sleeperIds: string[]): Promise<Map<string, ResolvedPlayer>> {
  const out = new Map<string, ResolvedPlayer>()
  if (sleeperIds.length === 0) return out

  const identity = await prisma.playerIdentityMap.findMany({
    where: { sleeperId: { in: sleeperIds } },
    select: { sleeperId: true, canonicalName: true, position: true },
  })
  for (const row of identity) {
    if (!row.sleeperId) continue
    const name = (row.canonicalName ?? '').trim()
    const position = (row.position ?? '').trim()
    if (!name || !position) continue
    out.set(row.sleeperId, { name, position })
  }

  const missing = sleeperIds.filter((id) => !out.has(id))
  if (missing.length === 0) return out

  const players = await prisma.sportsPlayer.findMany({
    where: { sleeperId: { in: missing } },
    select: { sleeperId: true, name: true, position: true },
  })
  for (const row of players) {
    if (!row.sleeperId || out.has(row.sleeperId)) continue
    const name = (row.name ?? '').trim()
    const position = (row.position ?? '').trim()
    if (!name || !position) continue
    out.set(row.sleeperId, { name, position })
  }

  return out
}

function leagueTypeOf(league: { leagueVariant: string | null; isDynasty: boolean }): string {
  const variant = (league.leagueVariant ?? '').trim().toLowerCase()
  if (variant) return variant
  return league.isDynasty ? 'dynasty' : 'redraft'
}

export async function collectDraftFactSamples(
  options: DraftFactSampleOptions,
): Promise<DraftFactSampleResult> {
  const result: DraftFactSampleResult = {
    picks: [],
    factsScanned: 0,
    skippedUnresolvedPlayer: 0,
    skippedNoTeamCount: 0,
    skippedNoLeague: 0,
    draftsCovered: 0,
  }

  const seasonNum = options.season ? Number(options.season) : null
  const facts = await prisma.draftFact.findMany({
    where: {
      sport: options.sport,
      ...(seasonNum != null && Number.isFinite(seasonNum) ? { season: seasonNum } : {}),
    },
    select: {
      leagueId: true,
      season: true,
      round: true,
      pickNumber: true,
      playerId: true,
    },
    take: Math.min(Math.max(options.maxFacts ?? DEFAULT_MAX_FACTS, 1), DEFAULT_MAX_FACTS),
  })
  result.factsScanned = facts.length
  if (facts.length === 0) return result

  const leagues = await prisma.league.findMany({
    where: { id: { in: Array.from(new Set(facts.map((f) => f.leagueId))) } },
    select: { id: true, scoring: true, isDynasty: true, leagueVariant: true },
  })
  const leagueById = new Map(leagues.map((l) => [l.id, l]))

  const resolved = await resolvePlayers(Array.from(new Set(facts.map((f) => f.playerId))))

  /* One group per (league, season) — that is one draft. */
  const groups = new Map<string, typeof facts>()
  for (const fact of facts) {
    const key = `${fact.leagueId}::${fact.season ?? 'unknown'}`
    const bucket = groups.get(key) ?? []
    bucket.push(fact)
    groups.set(key, bucket)
  }

  for (const bucket of groups.values()) {
    const first = bucket[0]!
    const league = leagueById.get(first.leagueId)
    if (!league) {
      result.skippedNoLeague += bucket.length
      continue
    }

    const season = first.season == null ? '' : String(first.season)
    // Round 1 holds exactly one pick per team, so this measures the draft, not the league today.
    const teamCount = bucket.filter((f) => f.round === 1).length
    if (teamCount < 2 || !season) {
      result.skippedNoTeamCount += bucket.length
      continue
    }

    const context = {
      sport: options.sport.toUpperCase(),
      leagueType: leagueTypeOf(league),
      draftType: 'imported',
      scoringFormat: (league.scoring ?? 'ppr').toLowerCase(),
      rosterFormat: 'standard',
      teamCount,
      season,
    }

    let contributed = false
    for (const fact of bucket) {
      const player = resolved.get(fact.playerId)
      if (!player) {
        result.skippedUnresolvedPlayer++
        continue
      }
      if (!Number.isFinite(fact.pickNumber) || fact.pickNumber < 1) continue

      result.picks.push({
        playerName: player.name,
        position: player.position,
        overall: fact.pickNumber,
        round: fact.round,
        roundPick: ((fact.pickNumber - 1) % teamCount) + 1,
        pickedAt: null,
        context,
        draftMode: 'real',
      })
      contributed = true
    }
    if (contributed) result.draftsCovered++
  }

  return result
}
