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

/** A pick's player id resolves to a name and position through the canonical identity map. */
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
  /** Player ids with no canonical identity row. Reported, never silently dropped. */
  skippedUnresolvedPlayer: number
  /**
   * The same count split by the league's import platform, so "ESPN picks are not resolving" is
   * visible rather than averaged into one number. A platform with no identity column (Yahoo today)
   * shows up here in full.
   */
  skippedUnresolvedByPlatform: Record<string, number>
  /** Draft groups with no measurable round-1 team count. */
  skippedNoTeamCount: number
  /** Facts whose league row is missing (deleted league, orphaned facts). */
  skippedNoLeague: number
  draftsCovered: number
}

const DEFAULT_MAX_FACTS = 200_000

/**
 * The `PlayerIdentityMap` column holding each import platform's own player id.
 *
 * 🛑 THIS USED TO RESOLVE SLEEPER IDS ONLY, AND EVERY OTHER PLATFORM'S DRAFTS WERE DISCARDED.
 * ESPN, MFL, Fantrax and Yahoo historical backfills all write `DraftFact` — with THEIR OWN player
 * id in `playerId` — and this module looked every one of them up in `sleeperId`. None matched, so
 * each pick was counted as "unresolved" and an imported ESPN league with years of drafts added
 * nothing to ADP. Same mapping `lib/league-import/playerIdResolver.ts` declares; that module
 * resolves one id per query and has no production caller, so it is mirrored here rather than
 * called in a loop over 200k facts.
 *
 * Yahoo has no column. Its picks stay unresolved — reported per platform, never name-guessed:
 * `DraftFact` carries no name to match on, and a wrong match puts one player's draft slot on
 * another's ADP.
 */
const PLATFORM_ID_COLUMN = {
  sleeper: 'sleeperId',
  espn: 'espnId',
  mfl: 'mflId',
  fantrax: 'fantraxId',
  fleaflicker: 'fleaflickerId',
} as const
type IdColumn = (typeof PLATFORM_ID_COLUMN)[keyof typeof PLATFORM_ID_COLUMN]

/**
 * Platforms whose ids must NOT be looked up as Sleeper ids. Yahoo player ids are bare integers in
 * the same range as Sleeper's, so a Sleeper lookup would not merely miss — it would match a
 * DIFFERENT player and put his name on this pick.
 */
const NO_ID_COLUMN = new Set(['yahoo'])

/**
 * ⚠ ANY OTHER PLATFORM FALLS BACK TO `sleeperId`, WHICH IS WHAT EVERY LEAGUE GOT BEFORE. Leagues
 * created from an import (`copyImportedHistory`) and older rows can carry a platform other than the
 * source's while their facts hold Sleeper ids; resolving them by any other column would silently
 * drop picks that count today.
 */
function idColumnFor(platform: string | null | undefined): IdColumn | null {
  const key = String(platform ?? '').trim().toLowerCase()
  if (NO_ID_COLUMN.has(key)) return null
  return (PLATFORM_ID_COLUMN as Record<string, IdColumn>)[key] ?? 'sleeperId'
}

/** Key a resolution by platform AND id: an ESPN id and a Sleeper id may be the same digits. */
function resolutionKey(column: IdColumn, playerId: string): string {
  return `${column}:${playerId}`
}

/**
 * Resolve each platform's player ids to name + position.
 *
 * `PlayerIdentityMap` is canonical. Only `sleeperId` is unique there, so the other columns are
 * scoped to the sport — an ESPN athlete id is not guaranteed unique across sports — and an id held
 * by more than one row is dropped rather than picked arbitrarily. `SportsPlayer` stays the Sleeper
 * fallback, because the identity sync can lag a freshly-added Sleeper id.
 *
 * A player we cannot name is discarded entirely. `aggregateAdp` keys on `name|position`, so an
 * unnamed pick would collapse every unknown player into one shared key — a single fabricated
 * "player" whose ADP is the mean of everyone we failed to identify.
 */
async function resolvePlayers(
  idsByColumn: Map<IdColumn, Set<string>>,
  sport: string,
): Promise<Map<string, ResolvedPlayer>> {
  const out = new Map<string, ResolvedPlayer>()

  for (const [column, idSet] of idsByColumn) {
    const ids = Array.from(idSet)
    if (ids.length === 0) continue

    const rows = (await prisma.playerIdentityMap.findMany({
      where: {
        [column]: { in: ids },
        ...(column === 'sleeperId' ? {} : { sport: sport.toUpperCase() }),
      },
      select: { [column]: true, canonicalName: true, position: true },
    } as any)) as unknown as Array<Record<string, string | null>>

    const seen = new Map<string, number>()
    for (const row of rows) {
      const id = row[column]
      if (id) seen.set(id, (seen.get(id) ?? 0) + 1)
    }
    for (const row of rows) {
      const id = row[column]
      if (!id || (seen.get(id) ?? 0) > 1) continue
      const name = (row.canonicalName ?? '').trim()
      const position = (row.position ?? '').trim()
      if (!name || !position) continue
      out.set(resolutionKey(column, id), { name, position })
    }

    if (column !== 'sleeperId') continue
    const missing = ids.filter((id) => !out.has(resolutionKey(column, id)))
    if (missing.length === 0) continue

    const players = await prisma.sportsPlayer.findMany({
      where: { sleeperId: { in: missing } },
      select: { sleeperId: true, name: true, position: true },
    })
    for (const row of players) {
      if (!row.sleeperId || out.has(resolutionKey(column, row.sleeperId))) continue
      const name = (row.name ?? '').trim()
      const position = (row.position ?? '').trim()
      if (!name || !position) continue
      out.set(resolutionKey(column, row.sleeperId), { name, position })
    }
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
    skippedUnresolvedByPlatform: {},
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
    select: { id: true, scoring: true, isDynasty: true, leagueVariant: true, platform: true },
  })
  const leagueById = new Map(leagues.map((l) => [l.id, l]))

  const idsByColumn = new Map<IdColumn, Set<string>>()
  for (const fact of facts) {
    const column = idColumnFor(leagueById.get(fact.leagueId)?.platform)
    if (!column) continue
    const bucket = idsByColumn.get(column) ?? new Set<string>()
    bucket.add(fact.playerId)
    idsByColumn.set(column, bucket)
  }
  const resolved = await resolvePlayers(idsByColumn, options.sport)

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

    const platform = String(league.platform ?? 'unknown').toLowerCase()
    const column = idColumnFor(league.platform)
    let contributed = false
    for (const fact of bucket) {
      const player = column ? resolved.get(resolutionKey(column, fact.playerId)) : undefined
      if (!player) {
        result.skippedUnresolvedPlayer++
        result.skippedUnresolvedByPlatform[platform] = (result.skippedUnresolvedByPlatform[platform] ?? 0) + 1
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
