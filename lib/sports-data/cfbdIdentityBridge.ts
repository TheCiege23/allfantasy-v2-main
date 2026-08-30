import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePlayerName, normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { reduceCrosswalk } from '@/lib/core-app/crosswalkRules'

/**
 * Link CFBD athlete ids onto `PlayerIdentityMap` so college projections can reach
 * a college roster.
 *
 * 🛑 THE GAP THIS CLOSES IS AN IDENTITY GAP, NOT A DATA GAP. NCAAF projections are
 * already computed and stored — `import-stat-lines` pulls CFBD season lines,
 * `compute-projections` runs every sport, and `AFProjectionSnapshot` holds
 * thousands of NCAAF rows. Not one of them is readable by a surface a college
 * manager sees, because the two id spaces never meet:
 *
 *   AFProjectionSnapshot.playerId   CFBD athlete id (via FantasyStatLine.playerId)
 *   SportsPlayer (NCAAF)            Rolling-Insights keyed, `sleeperId` NULL on every row
 *   PlayerIdentityMap               bridges roster ids to `sleeperId` — the thing core-app joins
 *
 * So `crosswalkToSleeperIds` resolves nothing for NCAAF and the projections join to
 * nothing. This writes the missing edge.
 *
 * ⚠ IT RESOLVES BY NAME, WHICH IS WHY IT REFUSES MORE THAN IT ACCEPTS. There is no
 * shared key to join on — that is the whole problem — so the only available bridge
 * is the athlete's name, and college rosters are the worst place in this product to
 * trust one. `reduceCrosswalk` is reused rather than reimplemented for exactly the
 * reason its own header gives: an id that does not resolve to precisely one player
 * is DROPPED, because putting a stranger in somebody's lineup silently is worse
 * than showing no projection.
 *
 * ⚠ AND IT IS DIRECTIONAL IN BOTH DIRECTIONS. One CFBD id matching two identity
 * rows is ambiguous, and so is one identity row claimed by two CFBD ids — the
 * second is the case a naive `from → to` guard misses, and it is common in college
 * football where a school fields two players of the same name in different years.
 * Both are reduced and both are counted.
 *
 * ⚠ IT IS A NAME MATCH, AND `rosterIdCrosswalk.ts` SAYS THAT IS THE WRONG MOVE.
 * That module refuses to name-match ESPN ids and gives the reason: an id chain
 * exists (`espnId` -> the same row's `sleeperId`), so a name match would be a
 * worse method chosen over a better one, against 178 NFL duplicate groups no key
 * separates. The rule holds and this is not an exception to it — it is the case
 * the rule does not cover. For CFBD there is NO chain: no table anywhere links a
 * CFBD athlete id to a Rolling-Insights one, which is precisely why this column
 * had to be added. Name is not the lazy option here, it is the only one.
 *
 * So the name matching is confined to THIS one-time backfill, where ambiguity can
 * be detected, dropped and counted. Nothing resolves by name at read time — once
 * a link is written, every later hop is an id.
 *
 * ⚠ REQUIRES THE `cfbdId` COLUMN. See
 * `prisma/migrations/20260830150000_player_identity_cfbd_id`. The migration must be
 * applied before this runs, or every query selecting the column raises P2022.
 */

export interface CfbdIdentityBridgeResult {
  season: string | null
  /** NCAAF CFBD stat lines examined. */
  statLinesRead: number
  /** Identity rows for NCAAF examined. */
  identityRowsRead: number
  /** Newly written links. */
  linked: number
  /** Already carried this exact cfbdId — no write needed, not a failure. */
  alreadyLinked: number
  /**
   * Candidate pairs discarded because the name did not resolve one-to-one.
   *
   * ⚠ REPORTED, NOT SWALLOWED. A bridge that silently drops half its input and
   * returns a healthy `linked` count reads as success; the gap then shows up as
   * "some college players have no projection" with nothing pointing here.
   */
  ambiguous: number
  /** CFBD players whose name matched no identity row at all. */
  unmatched: number
  errors: string[]
}

type CfbdCandidate = { cfbdId: string; name: string; team: string | null }

/** The stat-line payload fields `cfbdPlayerStats` writes. Read defensively — it is Json. */
function readStatLineIdentity(row: { playerId: string; team: string | null; stats: unknown }): CfbdCandidate | null {
  const cfbdId = row.playerId?.trim()
  if (!cfbdId) return null
  const stats = row.stats && typeof row.stats === 'object' ? (row.stats as Record<string, unknown>) : {}
  const rawName = typeof stats.name === 'string' ? stats.name : typeof stats.riPlayerName === 'string' ? stats.riPlayerName : ''
  const name = normalizePlayerName(rawName)
  if (!name) return null
  return { cfbdId, name, team: normalizeTeamAbbrev(row.team) }
}

/**
 * Write `cfbdId` onto every NCAAF identity row that resolves unambiguously.
 *
 * `season` defaults to the newest NCAAF stat-line season present, because that is
 * the roster the projections describe — pinning a stale season would bridge last
 * year's players and leave this year's unmatched.
 */
export async function backfillCfbdIdsForNcaaf(opts?: { season?: string; dryRun?: boolean }): Promise<CfbdIdentityBridgeResult> {
  const result: CfbdIdentityBridgeResult = {
    season: null,
    statLinesRead: 0,
    identityRowsRead: 0,
    linked: 0,
    alreadyLinked: 0,
    ambiguous: 0,
    unmatched: 0,
    errors: [],
  }

  let season = opts?.season ?? null
  if (!season) {
    const newest = await prisma.fantasyStatLine.findFirst({
      where: { sport: 'NCAAF', source: 'cfbd' },
      orderBy: { season: 'desc' },
      select: { season: true },
    })
    season = newest?.season ?? null
  }
  if (!season) {
    // Not an error: import-stat-lines has simply not run for NCAAF yet. Saying so
    // beats returning a clean zero that reads as "nothing to link".
    result.errors.push('no NCAAF CFBD stat lines present — run import-stat-lines first')
    return result
  }
  result.season = season

  const statLines = await prisma.fantasyStatLine.findMany({
    where: { sport: 'NCAAF', source: 'cfbd', season },
    select: { playerId: true, team: true, stats: true },
  })
  result.statLinesRead = statLines.length

  const candidates: CfbdCandidate[] = []
  for (const row of statLines) {
    const c = readStatLineIdentity(row)
    if (c) candidates.push(c)
  }

  const identityRows = await prisma.playerIdentityMap.findMany({
    where: { sport: 'NCAAF' },
    select: { id: true, normalizedName: true, currentTeam: true, cfbdId: true },
  })
  result.identityRowsRead = identityRows.length

  const identityByName = new Map<string, Array<{ id: string; team: string | null; cfbdId: string | null }>>()
  for (const row of identityRows) {
    const name = row.normalizedName?.trim()
    if (!name) continue
    const entry = { id: row.id, team: normalizeTeamAbbrev(row.currentTeam), cfbdId: row.cfbdId }
    const bucket = identityByName.get(name)
    if (bucket) bucket.push(entry)
    else identityByName.set(name, [entry])
  }

  /*
   * Emit every plausible pairing and let `reduceCrosswalk` refuse the ambiguous
   * ones, rather than picking a winner here. Team narrows a pairing ONLY when both
   * sides state one — a missing team must not be read as agreement, so a candidate
   * with no team stays paired against every same-name row and is duly dropped as
   * ambiguous if there is more than one.
   */
  const pairs: Array<{ from: string; to: string }> = []
  for (const c of candidates) {
    const bucket = identityByName.get(c.name)
    if (!bucket || bucket.length === 0) {
      result.unmatched++
      continue
    }
    const narrowed = c.team ? bucket.filter((b) => b.team == null || b.team === c.team) : bucket
    const usable = narrowed.length > 0 ? narrowed : bucket
    for (const row of usable) pairs.push({ from: c.cfbdId, to: row.id })
  }

  const cfbdToIdentity = reduceCrosswalk(pairs)
  // The inverse guard: one identity row claimed by two different CFBD athletes is
  // just as wrong, and a from→to reduction cannot see it.
  const identityToCfbd = reduceCrosswalk(pairs.map((p) => ({ from: p.to, to: p.from })))

  const identityById = new Map(identityRows.map((r) => [r.id, r]))
  let resolved = 0

  for (const [cfbdId, identityId] of cfbdToIdentity) {
    if (identityToCfbd.get(identityId) !== cfbdId) continue // contested from the other side
    resolved++
    const existing = identityById.get(identityId)
    if (existing?.cfbdId === cfbdId) {
      result.alreadyLinked++
      continue
    }
    if (opts?.dryRun) {
      result.linked++
      continue
    }
    try {
      await prisma.playerIdentityMap.update({ where: { id: identityId }, data: { cfbdId } })
      result.linked++
    } catch (e) {
      if (result.errors.length < 5) {
        result.errors.push(`link failed for cfbdId=${cfbdId}: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`)
      }
    }
  }

  // Everything that had a candidate pairing but did not survive both reductions.
  result.ambiguous = Math.max(0, candidates.length - result.unmatched - resolved)

  return result
}
