import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePlayerName, normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { reduceCrosswalk } from '@/lib/core-app/crosswalkRules'

/** Link college projections to identities using name, school and position agreement.
 * Missing evidence and ambiguity in either direction are refused. This scheduled
 * heuristic never changes an established CFBD link; reviewed repairs are separate.
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

type CfbdCandidate = { cfbdId: string; name: string; team: string | null; position: string | null }
const role = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim().toUpperCase().replace(/^FB$/, 'RB').replace(/^PK$/, 'K') : null

/** The stat-line payload fields `cfbdPlayerStats` writes. Read defensively — it is Json. */
function readStatLineIdentity(row: { playerId: string; team: string | null; stats: unknown }): CfbdCandidate | null {
  const cfbdId = row.playerId?.trim()
  if (!cfbdId) return null
  const stats = row.stats && typeof row.stats === 'object' ? (row.stats as Record<string, unknown>) : {}
  const rawName = typeof stats.name === 'string' ? stats.name : typeof stats.riPlayerName === 'string' ? stats.riPlayerName : ''
  const name = normalizePlayerName(rawName)
  if (!name) return null
  return { cfbdId, name, team: normalizeTeamAbbrev(row.team), position: role(stats.position) }
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
    select: { id: true, normalizedName: true, currentTeam: true, position: true, cfbdId: true },
  })
  result.identityRowsRead = identityRows.length

  const identityByName = new Map<string, Array<{ id: string; team: string | null; position: string | null; cfbdId: string | null }>>()
  for (const row of identityRows) {
    const name = row.normalizedName?.trim()
    if (!name) continue
    const entry = { id: row.id, team: normalizeTeamAbbrev(row.currentTeam), position: role(row.position), cfbdId: row.cfbdId }
    const bucket = identityByName.get(name)
    if (bucket) bucket.push(entry)
    else identityByName.set(name, [entry])
  }

  // A missing school or role is missing evidence. Never fall back to a bare name
  // when schools disagree: this assigned three imported reserves to namesakes.
  const pairs: Array<{ from: string; to: string }> = []
  for (const c of candidates) {
    const bucket = identityByName.get(c.name)
    if (!bucket || bucket.length === 0) {
      result.unmatched++
      continue
    }
    if (!c.team || !c.position) continue
    for (const row of bucket) {
      if (row.team !== c.team || row.position !== c.position) continue
      // An established provider link is immutable to this heuristic backfill.
      if (row.cfbdId && row.cfbdId !== c.cfbdId) continue
      pairs.push({ from: c.cfbdId, to: row.id })
    }
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
      const changed = await prisma.playerIdentityMap.updateMany({
        where: { id: identityId, sport: 'NCAAF', cfbdId: null, normalizedName: existing!.normalizedName, currentTeam: existing!.currentTeam, position: existing!.position },
        data: { cfbdId },
      })
      result.linked += changed.count
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
