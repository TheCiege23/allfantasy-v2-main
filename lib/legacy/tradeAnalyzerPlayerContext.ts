import 'server-only'

import { prisma } from '@/lib/prisma'
import { collapseSamePersonRows } from '@/lib/data/samePersonRows'
import { resolveInjuryFacts, type InjuryFact, type InjuryLookup } from '@/lib/injuries/injuryReadPort'
import { buildNameIndex, normalizeMatchName, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { SPORTS_PLAYER_TTL_MS } from '@/lib/workers/sports-player-record-freshness'

/**
 * Player context for the legacy trade analyzer's prompt, read from Postgres.
 *
 * 🛑 THIS REPLACED TWO LIVE NAME SEARCHES THAT GAVE THE WRONG PLAYER (2026-10-11). The route searched
 * TheSportsDB and ESPN by NAME for every asset and took the first hit — TheSportsDB's `arr[0]` (any sport
 * when none matched) and ESPN's `items[0]` — ignoring the position and team the asset already carried. An
 * IDP Josh Allen (JAX) was handed the Bills QB's stat line, injury and depth chart. Both were also live
 * vendor calls on a request path, which the DB-first guard reports.
 *
 * Every row bound here is VERIFIED against the asset's own position and team (`resolveVerifiedMatch`),
 * and a lone row whose team or side of the ball contradicts the asset is refused: `sports_players` holds
 * the QB under "Josh Allen" and the Jaguars' edge rusher under another name, so the name looks unique while
 * belonging to somebody else. A refused or ambiguous player is listed in `unresolved` with no data — a gap
 * the model is told about beats another athlete's numbers stated as his.
 */

export type TradeContextAsset = { name: string; position?: string | null; team?: string | null }

export type TradeContextPlayer = {
  name: string
  position: string | null
  team: string | null
  /** The importer's latest-season line for this athlete, as stored on `sports_players.stats`. */
  stats: Record<string, unknown> | null
  /** Current designation from the injury read port; null = none on file, which is NOT "healthy". */
  injury: { status: string | null; bodyPart: string | null; notes: string | null; reportedAt: string } | null
  source: 'sports_players'
  asOf: string | null
}

export type TradeContextResult = {
  ok: boolean
  players: TradeContextPlayer[]
  unresolved: Array<{ name: string; reason: 'not_found' | 'ambiguous' | 'contradicted' }>
}

type RecordRow = {
  id: string
  name: string
  team: string
  position: string
  stats: unknown
  lastUpdated: Date
}

function baseName(name: string): string {
  // Search on the name without a trailing generational suffix, so "Marvin Harrison Jr." also finds a row
  // stored as "Marvin Harrison"; the verified matcher then compares normalized keys.
  return name.trim().replace(/\s+(jr|sr|ii|iii|iv|v)\.?\s*$/i, '').trim()
}

function teamCode(team: string | null | undefined): string | null {
  const raw = String(team ?? '').trim()
  if (!raw) return null
  return normalizeTeamAbbrev(raw) ?? raw.toUpperCase()
}

function asStats(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return Object.keys(value as object).length > 0 ? (value as Record<string, unknown>) : null
}

export async function loadTradeAnalyzerPlayerContext(args: {
  sport: 'nfl' | 'nba' | string
  assets: readonly TradeContextAsset[]
  now?: Date
}): Promise<TradeContextResult> {
  const sport = String(args.sport).toUpperCase()
  const wanted: TradeContextAsset[] = []
  const seen = new Set<string>()
  for (const a of args.assets) {
    const name = String(a?.name ?? '').trim()
    if (!name) continue
    const key = `${normalizeMatchName(name)}|${String(a.position ?? '').toUpperCase()}|${teamCode(a.team) ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    wanted.push({ name, position: a.position ?? null, team: teamCode(a.team) })
  }
  if (wanted.length === 0) return { ok: false, players: [], unresolved: [] }

  let rows: RecordRow[]
  try {
    const found = (await prisma.sportsPlayerRecord.findMany({
      where: {
        sport,
        OR: [...new Set(wanted.map((w) => baseName(w.name)))].map((n) => ({ name: { contains: n, mode: 'insensitive' as const } })),
      },
      select: { id: true, name: true, team: true, position: true, stats: true, lastUpdated: true },
      orderBy: [{ lastUpdated: 'desc' }, { name: 'asc' }],
      take: 200,
    })) as RecordRow[]
    rows = await collapseSamePersonRows(found, sport, { staleAfterMs: SPORTS_PLAYER_TTL_MS })
  } catch {
    return { ok: false, players: [], unresolved: wanted.map((w) => ({ name: w.name, reason: 'not_found' as const })) }
  }

  const index = buildNameIndex(rows.map((r) => ({ name: r.name, position: r.position, team: teamCode(r.team), row: r })))
  const bound: Array<{ want: TradeContextAsset; row: RecordRow }> = []
  const unresolved: TradeContextResult['unresolved'] = []
  for (const want of wanted) {
    const lookup = { name: want.name, position: want.position ?? null, team: want.team ?? null }
    const res = resolveVerifiedMatch(index, lookup, { refuseContradictedSingle: true })
    if (!res.match) {
      unresolved.push({ name: want.name, reason: res.reason === 'ambiguous' ? 'ambiguous' : res.candidateCount > 0 ? 'contradicted' : 'not_found' })
      continue
    }
    // A multi-candidate bind narrows on position OR team; re-check the winner against BOTH, so a team-only
    // narrowing cannot hand a defender an offensive player's row.
    const recheck = resolveVerifiedMatch(buildNameIndex([res.match]), lookup, { refuseContradictedSingle: true })
    if (!recheck.match) {
      unresolved.push({ name: want.name, reason: 'contradicted' })
      continue
    }
    bound.push({ want, row: res.match.row })
  }

  /*
   * Injuries through the canonical read port, with the ASSET's position and team (verified there too).
   * Its result is keyed by normalized name, so two assets sharing a name are resolved in separate calls
   * rather than letting one overwrite the other.
   */
  const lookups: InjuryLookup[] = bound.map(({ want }) => ({ name: want.name, position: want.position, team: want.team }))
  const nameCounts = new Map<string, number>()
  for (const l of lookups) nameCounts.set(normalizeMatchName(l.name), (nameCounts.get(normalizeMatchName(l.name)) ?? 0) + 1)
  const unique = lookups.filter((l) => nameCounts.get(normalizeMatchName(l.name)) === 1)
  const repeated = lookups.filter((l) => (nameCounts.get(normalizeMatchName(l.name)) ?? 0) > 1)
  const injuryFor = new Map<InjuryLookup, InjuryFact>()
  try {
    const batches = await Promise.all([
      unique.length > 0 ? resolveInjuryFacts({ sport, players: unique, now: args.now }).then((r) => ({ group: unique, r })) : null,
      ...repeated.map((l) => resolveInjuryFacts({ sport, players: [l], now: args.now }).then((r) => ({ group: [l], r }))),
    ])
    for (const batch of batches) {
      if (!batch) continue
      for (const l of batch.group) {
        const fact = batch.r.byPlayer.get(normalizeMatchName(l.name))
        // A stale designation is a confident false statement; leave it out rather than caveat it.
        if (fact && !fact.stale) injuryFor.set(l, fact)
      }
    }
  } catch {
    // No injury context is a gap the prompt can live with; it never blocks the rest.
  }

  const players: TradeContextPlayer[] = bound.map(({ row }, i) => {
    const fact = injuryFor.get(lookups[i]!)
    return {
      name: row.name,
      position: row.position || null,
      team: row.team || null,
      stats: asStats(row.stats),
      injury: fact
        ? { status: fact.status ?? null, bodyPart: fact.type, notes: fact.description, reportedAt: fact.reportedAt.toISOString() }
        : null,
      source: 'sports_players',
      asOf: row.lastUpdated instanceof Date ? row.lastUpdated.toISOString() : null,
    }
  })

  return { ok: players.length > 0, players, unresolved }
}
