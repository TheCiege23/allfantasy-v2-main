/**
 * Fantrax draft and transaction history, as kept on the league snapshot.
 *
 * 🛑 BOTH WERE READ AND THROWN AWAY. A live (league-id) import fetched the draft board and returned
 * it on the outcome "rather than stored", so `FantraxLeagueFetchService` built every payload with no
 * draft picks and `DraftFact` never saw a Fantrax pick. `deriveFantraxTransactions` existed with no
 * caller, so a league-id import carried no transaction history either.
 *
 * ⚠ NO MIGRATION: `FantraxLeague.transactions` (Json) already exists and already holds the CSV
 * export's `claims` / `drops` / `trades` / … groups. The board and the derived moves are written
 * under their OWN keys beside those groups — never replacing them — and read back by the fetch
 * service into the same payload fields the export feeds. From there the existing
 * `FantraxHistoricalBackfillService` writes `DraftFact` (replace-per-season) and `TransactionFact`
 * (deterministic ids), exactly as for every other source.
 *
 * ⚠ DERIVED MOVES ARE INFERENCES AND ARE LABELLED AS SUCH. Fantrax publishes no transactions feed
 * (see `deriveFantraxTransactions.ts`). Each refresh is compared with the roster the previous one
 * stored; anything added and dropped between two refreshes is invisible, and a two-way exchange is
 * only ever a SUSPECTED trade. The fetch service gives them `status: 'inferred'` / `'suspected'`,
 * which `transactionFinality` never treats as final.
 *
 * Pure: no database, no provider. The import decides what to pass in.
 */
import { createHash } from 'node:crypto'
import type { FantraxDraftResults, FantraxPlayerRef, ResolvedRoster } from './fantraxApi'
import { deriveFantraxTransactions, type PeriodRoster } from './deriveFantraxTransactions'

export const FANTRAX_DRAFT_KEY = 'fantraxDraft'
export const FANTRAX_DERIVED_KEY = 'fantraxDerived'
/** Bound on stored inferred rows, so a long-lived dynasty snapshot cannot grow without limit. */
export const FANTRAX_DERIVED_CAP = 2000

export type StoredFantraxDraftPick = {
  round: number
  /** OVERALL pick number (see `fantraxDraft.ts` — `pick` is overall, `pickInRound` is not). */
  pick: number
  pickInRound: number
  /** Fantrax's own team id. */
  teamId: string
  /** The team's name at import time — how the fetch service maps the pick onto its team ids. */
  teamName: string | null
  /** Fantrax player id, the same id space the snapshot roster stores. */
  playerId: string
  playerName: string | null
  position: string | null
  team: string | null
}

export type StoredFantraxDraft = {
  draftState: string | null
  /** Slots on the board, made or not. */
  slots: number
  /** Made picks only — an unmade slot has no player and is not draft history. */
  picks: StoredFantraxDraftPick[]
}

export type StoredFantraxMove = {
  id: string
  /** The scoring period current when the change was observed, when known. */
  period: number | null
  observedAt: string
  teamId: string
  teamName: string
  adds: string[]
  drops: string[]
}

export type StoredFantraxSuspectedTrade = {
  id: string
  period: number | null
  observedAt: string
  teamAId: string
  teamAName: string
  teamBId: string
  teamBName: string
  aSent: string[]
  bSent: string[]
}

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())
const strOrNull = (v: unknown): string | null => str(v) || null
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])

/** The board as stored: made picks, each with the name the player map gave it. */
export function buildStoredFantraxDraft(
  board: FantraxDraftResults,
  teamNames: Record<string, string>,
  players: Record<string, FantraxPlayerRef | undefined> | null,
): StoredFantraxDraft {
  const picks: StoredFantraxDraftPick[] = []
  for (const slot of board.picks ?? []) {
    if (!slot.playerId) continue
    const ref = players?.[slot.playerId]
    picks.push({
      round: slot.round,
      pick: slot.pick,
      pickInRound: slot.pickInRound,
      teamId: slot.teamId,
      teamName: teamNames[slot.teamId]?.trim() || null,
      playerId: slot.playerId,
      playerName: strOrNull(ref?.name),
      position: strOrNull(ref?.position),
      team: strOrNull(ref?.team),
    })
  }
  return { draftState: board.draftState ?? null, slots: board.picks?.length ?? 0, picks }
}

const hashId = (prefix: string, parts: unknown[]): string =>
  `${prefix}-${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)}`

/**
 * What changed between the roster the previous import stored and the rosters just fetched.
 *
 * ⚠ A PREVIOUS SNAPSHOT WITH NO ROSTERED PLAYERS IS PRE-DRAFT (or CSV-era), NOT A LEAGUE THAT
 * ADDED EVERYONE: nothing is derived from it. Rows without a `teamName` are CSV-era rows and are
 * not attributed to anybody. Players a team took in the draft are not that team's "adds".
 */
export function deriveFantraxMovesBetweenSnapshots(args: {
  previousRoster: unknown
  previousStandings: unknown
  current: ResolvedRoster[]
  /** Fantrax player id → Fantrax team id that drafted him. */
  draftedBy?: Map<string, string>
  period: number | null
  observedAt: string
}): { moves: StoredFantraxMove[]; suspectedTrades: StoredFantraxSuspectedTrade[] } {
  const empty = { moves: [], suspectedTrades: [] }
  const prevRows = Array.isArray(args.previousRoster) ? args.previousRoster.map(rec) : []

  /* Team name → Fantrax team id: the previous standings first (they carry the durable id), then a
     current team of the same name. A team renamed since then matches neither and is skipped. */
  const idByName = new Map<string, string>()
  for (const row of Array.isArray(args.previousStandings) ? args.previousStandings.map(rec) : []) {
    const name = str(row.team).toLowerCase()
    const id = str(row.fantraxTeamId)
    if (name && id && !idByName.has(name)) idByName.set(name, id)
  }
  for (const team of args.current) {
    const name = team.teamName.trim().toLowerCase()
    if (name && !idByName.has(name)) idByName.set(name, team.teamId)
  }

  const before: PeriodRoster = { period: 0, teams: {} }
  let previousPlayers = 0
  for (const row of prevRows) {
    const teamName = str(row.teamName)
    const playerId = str(row.fantraxId)
    const teamId = idByName.get(teamName.toLowerCase())
    if (!teamName || !playerId || !teamId) continue
    const team = (before.teams[teamId] ??= { teamName, playerIds: [] })
    team.playerIds.push(playerId)
    previousPlayers += 1
  }
  if (previousPlayers === 0) return empty

  const after: PeriodRoster = { period: 1, teams: {} }
  for (const team of args.current) {
    after.teams[team.teamId] = { teamName: team.teamName, playerIds: team.players.map((p) => p.fantraxId).filter(Boolean) }
  }

  const diff = deriveFantraxTransactions([before, after])
  const traded = new Set<string>()
  const suspectedTrades = diff.suspectedTrades.map((t) => {
    for (const p of [...t.aSent, ...t.bSent]) traded.add(`${t.teamAId}|${p}`).add(`${t.teamBId}|${p}`)
    return {
      id: hashId('st', [t.teamAId, t.teamBId, [...t.aSent].sort(), [...t.bSent].sort(), args.period, args.observedAt.slice(0, 10)]),
      period: args.period,
      observedAt: args.observedAt,
      teamAId: t.teamAId, teamAName: t.teamAName, teamBId: t.teamBId, teamBName: t.teamBName,
      aSent: t.aSent, bSent: t.bSent,
    }
  })

  const moves: StoredFantraxMove[] = []
  for (const move of diff.moves) {
    const adds = move.adds.filter((p) => !traded.has(`${move.teamId}|${p}`) && args.draftedBy?.get(p) !== move.teamId)
    const drops = move.drops.filter((p) => !traded.has(`${move.teamId}|${p}`))
    if (adds.length === 0 && drops.length === 0) continue
    moves.push({
      id: hashId('mv', [move.teamId, [...adds].sort(), [...drops].sort(), args.period, args.observedAt.slice(0, 10)]),
      period: args.period,
      observedAt: args.observedAt,
      teamId: move.teamId,
      teamName: move.teamName,
      adds,
      drops,
    })
  }
  return { moves, suspectedTrades }
}

/** The stored board, or null when none is on file. */
export function readStoredFantraxDraft(json: unknown): StoredFantraxDraft | null {
  const draft = rec(rec(json)[FANTRAX_DRAFT_KEY])
  if (!Array.isArray(draft.picks)) return null
  const picks: StoredFantraxDraftPick[] = []
  for (const raw of draft.picks) {
    const p = rec(raw)
    const round = num(p.round), pick = num(p.pick), pickInRound = num(p.pickInRound)
    const teamId = str(p.teamId), playerId = str(p.playerId)
    if (round == null || pick == null || !teamId || !playerId) continue
    picks.push({
      round, pick, pickInRound: pickInRound ?? 0, teamId, playerId,
      teamName: strOrNull(p.teamName), playerName: strOrNull(p.playerName), position: strOrNull(p.position), team: strOrNull(p.team),
    })
  }
  return { draftState: strOrNull(draft.draftState), slots: num(draft.slots) ?? picks.length, picks }
}

/** The stored inferred moves and suspected trades (empty when none). */
export function readStoredFantraxDerived(json: unknown): { moves: StoredFantraxMove[]; suspectedTrades: StoredFantraxSuspectedTrade[] } {
  const derived = rec(rec(json)[FANTRAX_DERIVED_KEY])
  const moves: StoredFantraxMove[] = []
  for (const raw of Array.isArray(derived.moves) ? derived.moves : []) {
    const m = rec(raw)
    if (!str(m.id) || !str(m.teamId)) continue
    moves.push({
      id: str(m.id), period: num(m.period), observedAt: str(m.observedAt), teamId: str(m.teamId), teamName: str(m.teamName),
      adds: ids(m.adds), drops: ids(m.drops),
    })
  }
  const suspectedTrades: StoredFantraxSuspectedTrade[] = []
  for (const raw of Array.isArray(derived.suspectedTrades) ? derived.suspectedTrades : []) {
    const t = rec(raw)
    if (!str(t.id) || !str(t.teamAId) || !str(t.teamBId)) continue
    suspectedTrades.push({
      id: str(t.id), period: num(t.period), observedAt: str(t.observedAt),
      teamAId: str(t.teamAId), teamAName: str(t.teamAName), teamBId: str(t.teamBId), teamBName: str(t.teamBName),
      aSent: ids(t.aSent), bSent: ids(t.bSent),
    })
  }
  return { moves, suspectedTrades }
}

/**
 * The snapshot's `transactions` value after this import.
 *
 * Every key already there survives (the export groups above all). `draft: null` means "not read
 * this time" and keeps the board on file — a transient failure must not erase a draft. New moves
 * are appended and de-duplicated by id, so writing the same observation twice stores it once.
 */
export function mergeFantraxSnapshotHistory(
  existing: unknown,
  update: {
    draft: StoredFantraxDraft | null
    moves: StoredFantraxMove[]
    suspectedTrades: StoredFantraxSuspectedTrade[]
    period: number | null
    observedAt: string
  },
): Record<string, unknown> {
  /* An array here is a shape nothing reads (`parseTransactions` wants the grouped object); it is
     kept verbatim rather than dropped. */
  const base: Rec = Array.isArray(existing)
    ? (existing.length > 0 ? { legacyEntries: existing } : {})
    : { ...rec(existing) }
  if (update.draft) base[FANTRAX_DRAFT_KEY] = update.draft

  const held = readStoredFantraxDerived(base)
  const appendUnique = <T extends { id: string }>(current: T[], extra: T[]) => {
    const seen = new Set(current.map((x) => x.id))
    const out = [...current]
    for (const x of extra) if (!seen.has(x.id)) { seen.add(x.id); out.push(x) }
    return out.slice(-FANTRAX_DERIVED_CAP)
  }
  base[FANTRAX_DERIVED_KEY] = {
    rosterPeriod: update.period,
    observedAt: update.observedAt,
    moves: appendUnique(held.moves, update.moves),
    suspectedTrades: appendUnique(held.suspectedTrades, update.suspectedTrades),
  }
  return base
}
