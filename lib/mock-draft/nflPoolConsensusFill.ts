import type { ADPEntry } from '@/lib/adp-data'
import { normalizePlayerName } from '@/lib/team-abbrev'

/**
 * Tops the NFL redraft mock pool up from the CONSENSUS board (`adp_data`, written by the ADP
 * ingestion worker) — 2026-11-16.
 *
 * 🛑 WHY. On production that day an 8-team, 15-round NFL mock got 118 players: every one of them
 * from Fantasy Football Calculator's live list (all 118 carried an `ffcPlayerId`), because the other
 * two sources `getLiveADP` merges added nothing. 118 is fewer than the 120 picks the draft needed,
 * and Bijan Robinson — 3.24 on the consensus board — was not in FFC's list at all, so he could not
 * be drafted or queued. The league mock room, which reads the consensus board, had him at #2.
 *
 * So every consensus player the list is missing is added at their consensus ADP, then the pool is
 * re-sorted and capped. A player the list already has keeps their entry untouched — this fills
 * gaps, it never re-prices. Pure: the caller loads the board (DB-first, no provider call).
 */

/** FFC's spellings, which the room's position tabs use. */
const POSITION_ALIASES: Record<string, string> = { K: 'PK', PK: 'PK', DST: 'DEF', 'D/ST': 'DEF', DEF: 'DEF' }
const OFFENSE = new Set(['QB', 'RB', 'WR', 'TE'])

export function consensusPosition(raw: string | null | undefined): string | null {
  const p = String(raw ?? '').trim().toUpperCase()
  if (OFFENSE.has(p)) return p
  return POSITION_ALIASES[p] ?? null
}

export type ConsensusRow = { name: string; adp: number; position: string | null; team: string | null }

/**
 * A mock pool entry: an `ADPEntry`, or one this fill added from the consensus board. Widened HERE rather
 * than in lib/adp-data.ts, whose live FFC fetch is a standing DB-first finding — touching that file
 * puts it in the PR-scoped boundary check.
 */
export type MockPoolEntry = Omit<ADPEntry, 'source'> & { source: ADPEntry['source'] | 'consensus' }

export function fillPoolFromConsensus(entries: readonly MockPoolEntry[], consensus: Iterable<ConsensusRow>, limit: number): MockPoolEntry[] {
  const have = new Set(entries.map((e) => normalizePlayerName(e.name)))
  const added: MockPoolEntry[] = []
  for (const row of consensus) {
    const position = consensusPosition(row.position)
    if (!position || !row.name || !Number.isFinite(row.adp) || row.adp <= 0) continue
    const key = normalizePlayerName(row.name)
    if (!key || have.has(key)) continue
    have.add(key)
    added.push({
      name: row.name,
      position,
      team: row.team || null,
      adp: row.adp,
      adpFormatted: row.adp.toFixed(1),
      adpTrend: null,
      age: null,
      value: null,
      source: 'consensus',
      ffcPlayerId: null,
      timesDrafted: null,
      adpHigh: null,
      adpLow: null,
      adpStdev: null,
      bye: null,
    })
  }
  if (added.length === 0) return entries.slice(0, limit)
  return [...entries, ...added].sort((a, b) => a.adp - b.adp).slice(0, limit)
}
