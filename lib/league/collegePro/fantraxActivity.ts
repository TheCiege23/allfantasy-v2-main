import 'server-only'
import { prisma } from '@/lib/prisma'
import { readStoredFantraxDerived } from '@/lib/league-import/fantrax/fantraxSnapshotHistory'
import type { LeagueMove, LeagueMovePlayer } from '@/lib/league-chat/leagueMoves'

/**
 * A Fantrax league's moves as Activity cards, from what is already stored — never the provider.
 *
 * Fantrax publishes no transactions endpoint, so a Fantrax league has no rows in the activity table
 * the ingest cron writes, and its Activity tab read "No moves" for a league with 27 that month (Road
 * To Glory NBA, measured 2026-11-22). The refresh already diffs each roster snapshot against the last
 * one and stores the result on the snapshot (`fantraxDerived`); this reads that back.
 *
 * Every card it makes is `inferred`: a roster diff sees a player change hands, never why.
 */

type RosterRow = { fantraxId?: unknown; name?: unknown; position?: unknown; primaryPosition?: unknown; team?: unknown }

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Player names: the snapshot's own roster first, then the identity map's Fantrax ids for anyone dropped since. */
async function playerNames(roster: unknown, ids: string[], sport: string | null): Promise<Map<string, Omit<LeagueMovePlayer, 'to'>>> {
  const out = new Map<string, Omit<LeagueMovePlayer, 'to'>>()
  for (const raw of Array.isArray(roster) ? (roster as RosterRow[]) : []) {
    const id = text(raw?.fantraxId)
    const name = text(raw?.name)
    if (!id || !name || out.has(id)) continue
    out.set(id, { id, name, position: text(raw.primaryPosition) ?? text(raw.position), team: text(raw.team), imageUrl: null })
  }
  const missing = ids.filter((id) => !out.has(id))
  if (missing.length > 0) {
    const rows = await prisma.playerIdentityMap
      .findMany({
        where: { fantraxId: { in: missing }, ...(sport ? { sport } : {}) },
        select: { fantraxId: true, canonicalName: true, position: true, currentTeam: true },
      })
      .catch(() => [])
    for (const r of rows) {
      if (r.fantraxId && !out.has(r.fantraxId)) {
        out.set(r.fantraxId, { id: r.fantraxId, name: r.canonicalName, position: r.position, team: r.currentTeam, imageUrl: null })
      }
    }
  }
  return out
}

/** Our sport code for the identity map, from a Fantrax snapshot's own (`CFB`, `CBB`, `NBA`, …). */
function identitySport(sport: string | null): string | null {
  const s = String(sport ?? '').trim().toUpperCase()
  if (s === 'CFB' || s === 'NCAAF') return 'NCAAF'
  if (s === 'CBB' || s === 'NCAAB') return 'NCAAB'
  return s || null
}

export async function fantraxLeagueMoves(snapshotId: string, opts: { since: number }): Promise<LeagueMove[]> {
  const snap = await prisma.fantraxLeague
    .findUnique({ where: { id: snapshotId }, select: { id: true, sport: true, roster: true, transactions: true } })
    .catch(() => null)
  if (!snap) return []
  const { moves, suspectedTrades } = readStoredFantraxDerived(snap.transactions)
  const when = (iso: string) => (Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : NaN)
  const recentMoves = moves.filter((m) => when(m.observedAt) >= opts.since)
  const recentTrades = suspectedTrades.filter((t) => when(t.observedAt) >= opts.since)
  if (recentMoves.length === 0 && recentTrades.length === 0) return []

  const ids = [
    ...recentMoves.flatMap((m) => [...m.adds, ...m.drops]),
    ...recentTrades.flatMap((t) => [...t.aSent, ...t.bSent]),
  ]
  const names = await playerNames(snap.roster, [...new Set(ids)], identitySport(snap.sport))
  // An id we cannot name stays printable rather than vanishing (the LeagueMovePlayer contract).
  const player = (id: string, to: string | null): LeagueMovePlayer => ({
    ...(names.get(id) ?? { id, name: `player ${id}`, position: null, team: null, imageUrl: null }),
    to,
  })

  const cards: LeagueMove[] = []
  for (const m of recentMoves) {
    cards.push({
      id: `fantrax:${snap.id}:${m.id}`,
      kind: 'roster_move',
      occurredAt: new Date(when(m.observedAt)).toISOString(),
      teamName: m.teamName || null,
      managerName: null,
      avatarUrl: null,
      involvedTeams: m.teamName ? [m.teamName] : [],
      adds: m.adds.map((id) => player(id, m.teamName || null)),
      drops: m.drops.map((id) => player(id, null)),
      bid: null,
      picks: [],
      inferred: true,
    })
  }
  for (const t of recentTrades) {
    cards.push({
      id: `fantrax:${snap.id}:${t.id}`,
      kind: 'trade',
      occurredAt: new Date(when(t.observedAt)).toISOString(),
      teamName: t.teamAName || null,
      managerName: null,
      avatarUrl: null,
      involvedTeams: [t.teamAName, t.teamBName].filter(Boolean),
      adds: [...t.aSent.map((id) => player(id, t.teamBName || null)), ...t.bSent.map((id) => player(id, t.teamAName || null))],
      drops: [],
      bid: null,
      picks: [],
      inferred: true,
    })
  }
  return cards
}
