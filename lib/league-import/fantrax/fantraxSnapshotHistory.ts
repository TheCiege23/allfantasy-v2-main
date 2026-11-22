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
import type { FantraxDraftResults, FantraxFuturePick, FantraxPlayerRef, ResolvedRoster } from './fantraxApi'
import { deriveFantraxTransactions, type PeriodRoster } from './deriveFantraxTransactions'

const FANTRAX_DRAFT_KEY = 'fantraxDraft'
const FANTRAX_DERIVED_KEY = 'fantraxDerived'
const FANTRAX_FUTURE_PICKS_KEY = 'fantraxFuturePicks'
const FANTRAX_TEAM_LOGOS_KEY = 'fantraxTeamLogos'
/** Bound on stored inferred rows, so a long-lived dynasty snapshot cannot grow without limit. */
const FANTRAX_DERIVED_CAP = 2000

type StoredFantraxDraftPick = {
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

type StoredFantraxDraft = {
  draftState: string | null
  /** Slots on the board, made or not. */
  slots: number
  /** Made picks only — an unmade slot has no player and is not draft history. */
  picks: StoredFantraxDraftPick[]
}

/**
 * One future-season pick and who holds it. Fantrax lists EVERY pick, traded or not, so this is the
 * league's whole inventory for the seasons it covers, not a list of trades.
 */
type StoredFantraxFuturePick = {
  season: number
  round: number
  /** Fantrax's own team ids. */
  originalTeamId: string
  ownerTeamId: string
  /** Team names at import time: how the fetch service maps the pick onto its team ids. */
  originalTeamName: string | null
  ownerTeamName: string | null
}

type StoredFantraxFuturePicks = {
  observedAt: string
  picks: StoredFantraxFuturePick[]
}

type StoredFantraxMove = {
  id: string
  /** The scoring period current when the change was observed, when known. */
  period: number | null
  observedAt: string
  teamId: string
  teamName: string
  adds: string[]
  drops: string[]
}

type StoredFantraxSuspectedTrade = {
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

/** The future-pick inventory as stored, each pick with the names its two teams had at import time. */
export function buildStoredFantraxFuturePicks(
  future: FantraxFuturePick[],
  teamNames: Record<string, string>,
  observedAt: string,
): StoredFantraxFuturePicks {
  const name = (id: string) => teamNames[id]?.trim() || null
  return {
    observedAt,
    picks: future.map((p) => ({
      season: p.year,
      round: p.round,
      originalTeamId: p.originalOwnerTeamId,
      ownerTeamId: p.currentOwnerTeamId,
      originalTeamName: name(p.originalOwnerTeamId),
      ownerTeamName: name(p.currentOwnerTeamId),
    })),
  }
}

/** The stored future-pick inventory, or null when none is on file. */
export function readStoredFantraxFuturePicks(json: unknown): StoredFantraxFuturePicks | null {
  const held = rec(rec(json)[FANTRAX_FUTURE_PICKS_KEY])
  if (!Array.isArray(held.picks)) return null
  const picks: StoredFantraxFuturePick[] = []
  for (const raw of held.picks) {
    const p = rec(raw)
    const season = num(p.season), round = num(p.round)
    const originalTeamId = str(p.originalTeamId), ownerTeamId = str(p.ownerTeamId)
    if (season == null || round == null || !originalTeamId || !ownerTeamId) continue
    picks.push({
      season, round, originalTeamId, ownerTeamId,
      originalTeamName: strOrNull(p.originalTeamName), ownerTeamName: strOrNull(p.ownerTeamName),
    })
  }
  return { observedAt: str(held.observedAt), picks }
}

/**
 * The stored inventory in the import payload's own team ids.
 *
 * `teamIdFor` places a team by the name stored with the pick, then by Fantrax's team id. A pick
 * whose original team or holder cannot be placed is dropped rather than handed to a guessed team.
 */
export function rekeyFantraxFuturePicks(
  stored: StoredFantraxFuturePicks,
  teamIdFor: (teamName: string | null, fantraxTeamId: string) => string | null,
): Array<{ season: number; round: number; originalTeamId: string; ownerTeamId: string }> {
  const out: Array<{ season: number; round: number; originalTeamId: string; ownerTeamId: string }> = []
  for (const pick of stored.picks) {
    const originalTeamId = teamIdFor(pick.originalTeamName, pick.originalTeamId)
    const ownerTeamId = teamIdFor(pick.ownerTeamName, pick.ownerTeamId)
    if (!originalTeamId || !ownerTeamId) continue
    out.push({ season: pick.season, round: pick.round, originalTeamId, ownerTeamId })
  }
  return out
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
    /**
     * `null` or absent means "not read this time" and keeps the inventory on file. A read that
     * succeeded REPLACES it, empty included: Fantrax lists every pick, so an empty answer is a
     * league with no future picks, not a failed read.
     */
    futurePicks?: StoredFantraxFuturePicks | null
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
  if (update.futurePicks) base[FANTRAX_FUTURE_PICKS_KEY] = update.futurePicks

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

/**
 * A team's logo as Fantrax's own image server hosts it, or null for anything else.
 *
 * Fantrax's public API has no picture field (contracts/fantrax/GAPS.md F-14); the logged-in site lists
 * one per team (F-20). The address is shown to every member of the league, so it is accepted only when
 * it is exactly an image on `fantraximg.com`: an uploaded logo under `/logos/`, or one of Fantrax's stock
 * team icons. No query, no fragment, no credentials, no other host.
 */
export function fantraxLogoUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 300) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' || url.hostname !== 'fantraximg.com' || url.port || url.username || url.password || url.search || url.hash) return null
  if (!/^\/(?:logos|assets\/images\/icons\/fantasyteams)\/[A-Za-z0-9_\-./]+\.(?:webp|png|jpe?g|gif)$/.test(url.pathname) || url.pathname.includes('..')) return null
  return url.href
}

export type StoredFantraxTeamLogo = { teamId: string; teamName: string | null; logoUrl: string }

/** The team logos on file, each already checked by `fantraxLogoUrl`. Empty when none were ever synced. */
export function readStoredFantraxTeamLogos(json: unknown): StoredFantraxTeamLogo[] {
  const held = rec(rec(json)[FANTRAX_TEAM_LOGOS_KEY])
  if (!Array.isArray(held.logos)) return []
  const out: StoredFantraxTeamLogo[] = []
  for (const raw of held.logos) {
    const logo = rec(raw)
    const teamId = str(logo.teamId)
    const logoUrl = fantraxLogoUrl(logo.logoUrl)
    if (teamId && logoUrl) out.push({ teamId, teamName: strOrNull(logo.teamName), logoUrl })
  }
  return out
}

/**
 * The snapshot's stored extras with the team logos replaced.
 *
 * Every other key is kept verbatim, and `mergeStoredFantraxHistory` keeps this one across refreshes: a
 * refresh reads rosters and standings from the public API, which has no logo to overwrite it with.
 */
export function withStoredFantraxTeamLogos(existing: unknown, logos: readonly StoredFantraxTeamLogo[], observedAt: string): Record<string, unknown> {
  const base: Rec = Array.isArray(existing) ? (existing.length > 0 ? { legacyEntries: existing } : {}) : { ...rec(existing) }
  base[FANTRAX_TEAM_LOGOS_KEY] = { observedAt, logos: logos.map((l) => ({ teamId: l.teamId, teamName: l.teamName, logoUrl: l.logoUrl })) }
  return base
}
