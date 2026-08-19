/**
 * Trade ledger for IMPORTED (non-Sleeper) leagues — Yahoo, ESPN, and any
 * provider whose historical backfill persisted transaction facts.
 *
 * Honesty contract — this is a LEDGER, not a grader. Per-player historical
 * scoring is not available from imported provider data, so outcome grades
 * would be guesses; AllFantasy lists the trades and says exactly why letters
 * are absent instead of inventing them. Every limitation ships in `notes[]`.
 *
 * Data shape (written by *HistoricalBackfillService):
 * - transactionFact rows with type 'trade', one row per player movement
 *   (direction add/drop in payload), grouped by the provider transaction id
 *   (payload.yahooTransactionId / payload.espnTransactionId).
 * - Player names resolve from imported season roster snapshots; a player who
 *   left the league before season end may only be known by provider id.
 */

import { prisma } from '@/lib/prisma'

const CACHE_PREFIX = 'trade-ledger-facts:v1:'
const TTL_MS = 6 * 60 * 60 * 1000 // facts only change on re-import

export type ImportedTradePlayer = {
  playerId: string
  /** Resolved from imported roster snapshots when possible; null when the player never appears on a season-end roster. */
  name: string | null
  position: string | null
}

export type ImportedTradeSide = {
  teamId: string
  managerName: string
  received: ImportedTradePlayer[]
}

export type ImportedTrade = {
  id: string
  season: string | null
  dateIso: string | null
  sides: ImportedTradeSide[]
}

export type ImportedTradeLedgerPayload = {
  version: 1
  fetchedAt: string
  staleAsOf: string | null
  leagueId: string
  platform: string
  graded: false
  /** Printed limitations — rendered verbatim, honesty contract. */
  notes: string[]
  seasons: string[]
  trades: ImportedTrade[]
  unresolvedPlayerNames: number
}

type SnapshotPlayerRow = {
  id?: string
  name?: string | null
  position?: string | null
  ownerName?: string
}

function providerTransactionId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const raw = p.yahooTransactionId ?? p.espnTransactionId ?? p.transactionId ?? null
  return raw == null ? null : String(raw)
}

function directionOf(payload: unknown): 'add' | 'drop' | null {
  if (!payload || typeof payload !== 'object') return null
  const d = (payload as Record<string, unknown>).direction
  return d === 'add' || d === 'drop' ? d : null
}

export async function getImportedTradeLedger(
  leagueId: string,
  platform: string,
): Promise<ImportedTradeLedgerPayload | null> {
  const cacheKey = `${CACHE_PREFIX}${leagueId}`
  const now = new Date()
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  const cachedPayload =
    cached && cached.data && typeof cached.data === 'object'
      ? (cached.data as unknown as ImportedTradeLedgerPayload)
      : null
  if (cachedPayload?.version === 1 && cached && cached.expiresAt > now) return cachedPayload

  const [rows, snapshots] = await Promise.all([
    prisma.transactionFact
      .findMany({
        where: { leagueId, type: 'trade' },
        select: {
          playerId: true,
          rosterId: true,
          season: true,
          createdAt: true,
          payload: true,
        },
        orderBy: [{ season: 'asc' }, { createdAt: 'asc' }],
      })
      .catch(() => [] as never[]),
    prisma.rosterSnapshot
      .findMany({
        where: { leagueId },
        select: { teamId: true, season: true, rosterPlayers: true },
      })
      .catch(() => [] as never[]),
  ])

  if (rows.length === 0) return null

  // Player + manager identity from every imported season-end roster snapshot.
  const playerIndex = new Map<string, { name: string | null; position: string | null }>()
  const managerNames = new Map<string, string>()
  const sortedSnaps = [...snapshots].sort((a, b) => (a.season ?? 0) - (b.season ?? 0))
  for (const snap of sortedSnaps) {
    const players = Array.isArray(snap.rosterPlayers) ? (snap.rosterPlayers as SnapshotPlayerRow[]) : []
    for (const p of players) {
      if (p?.id && p.name) playerIndex.set(String(p.id), { name: p.name, position: p.position ?? null })
      if (p?.ownerName?.trim()) managerNames.set(snap.teamId, p.ownerName.trim())
    }
  }

  // Group movement rows into trades by provider transaction id; a receiving
  // side is a team whose payload.direction === 'add'. Drop rows mirror the
  // adds on the other side, so adds alone define who got what.
  type TradeAcc = {
    season: string | null
    createdAt: Date | null
    received: Map<string, ImportedTradePlayer[]>
  }
  const tradeAcc = new Map<string, TradeAcc>()
  let unresolvedPlayerNames = 0

  for (const row of rows) {
    const txId =
      providerTransactionId(row.payload) ??
      `${row.season ?? 'unknown'}:${row.createdAt ? row.createdAt.getTime() : 'undated'}`
    const acc =
      tradeAcc.get(txId) ??
      ({ season: row.season != null ? String(row.season) : null, createdAt: row.createdAt ?? null, received: new Map() } as TradeAcc)
    tradeAcc.set(txId, acc)

    if (directionOf(row.payload) !== 'add' || !row.playerId || !row.rosterId) continue
    const known = playerIndex.get(String(row.playerId))
    if (!known?.name) unresolvedPlayerNames += 1
    const list = acc.received.get(row.rosterId) ?? []
    list.push({
      playerId: String(row.playerId),
      name: known?.name ?? null,
      position: known?.position ?? null,
    })
    acc.received.set(row.rosterId, list)
  }

  const trades: ImportedTrade[] = [...tradeAcc.entries()]
    .map(([id, acc]) => ({
      id,
      season: acc.season,
      dateIso: acc.createdAt ? acc.createdAt.toISOString() : null,
      sides: [...acc.received.entries()].map(([teamId, received]) => ({
        teamId,
        managerName: managerNames.get(teamId) ?? `Team ${teamId.split('.').pop() ?? teamId}`,
        received,
      })),
    }))
    .filter((t) => t.sides.length > 0)
    .sort((a, b) => {
      const sa = a.season ? Number(a.season) : 0
      const sb = b.season ? Number(b.season) : 0
      if (sa !== sb) return sb - sa
      return (b.dateIso ?? '').localeCompare(a.dateIso ?? '')
    })

  const seasons = [...new Set(trades.map((t) => t.season).filter((s): s is string => s != null))].sort()

  const notes = [
    `Trades listed from the imported ${platform.toUpperCase()} transaction log — counted, not graded.`,
    `Per-player historical scoring isn't available from ${platform.toUpperCase()} imports, so outcome grades would be guesses. AllFantasy doesn't fake letters.`,
    'Player names resolve from imported season-end rosters; a player who left the league before season end may show by provider id only.',
  ]
  if (unresolvedPlayerNames > 0) {
    notes.push(`${unresolvedPlayerNames} traded player${unresolvedPlayerNames === 1 ? '' : 's'} could not be matched to a name.`)
  }

  const fresh: ImportedTradeLedgerPayload = {
    version: 1,
    fetchedAt: now.toISOString(),
    staleAsOf: null,
    leagueId,
    platform,
    graded: false,
    notes,
    seasons,
    trades,
    unresolvedPlayerNames,
  }

  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey },
      update: { data: fresh as unknown as object, expiresAt: new Date(now.getTime() + TTL_MS) },
      create: { cacheKey, data: fresh as unknown as object, expiresAt: new Date(now.getTime() + TTL_MS) },
    })
    .catch(() => null)
  return fresh
}
