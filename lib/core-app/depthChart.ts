import type { LeagueSlot } from './playerFinder'
import type { PlatformLink } from './platformLinks'

/**
 * The depth chart around a searched player — who plays if he misses time, and where each of those
 * players is in YOUR leagues: yours, someone else's, free to claim, or unreadable.
 *
 * Pure, client-safe. The loader is depthChartBackups.ts.
 *
 * ⚠ THE VENDOR'S `status` FIELD IS IGNORED ON PURPOSE. Rolling Insights stamps each depth entry with
 * a game-day status (`INACT`) as of the moment the chart was fetched — measured 2026-09-28, the Lions'
 * row carried Jared Goff as INACT days after the game it described. The chart is read for ORDER only;
 * whether a player can play is the injury feed's job, and the card already shows it.
 */

/** Rolling Insights' NFL depth-chart spots that carry fantasy players. WR is split into three spots. */
export const DEPTH_FANTASY_SLOTS = ['QB', 'RB', 'WR1', 'WR2', 'WR3', 'TE'] as const

/**
 * Older than this and the chart is not shown at all. The cron runs weekly (Wednesday), so a healthy
 * row is at most ~8 days old; three weeks means the writer has stopped, and a depth chart from before
 * a trade or an injury is a confident wrong answer about who plays.
 */
export const DEPTH_CHART_MAX_AGE_DAYS = 21

/** Players besides him whose presence is read per league — each costs one roster read. */
export const BACKUP_CAP = 3

export type DepthRaw = { id: string; name: string }

export function parseDepthPlayers(value: unknown): DepthRaw[] {
  if (!Array.isArray(value)) return []
  const out: DepthRaw[] = []
  for (const p of value) {
    if (!p || typeof p !== 'object') continue
    const id = (p as Record<string, unknown>).id
    const name = (p as Record<string, unknown>).player
    if ((typeof id !== 'string' && typeof id !== 'number') || typeof name !== 'string' || !name.trim()) continue
    out.push({ id: String(id), name: name.trim() })
  }
  return out
}

/**
 * The row that places him: where he sits HIGHEST, then the fixed slot order. A receiver can be listed
 * in two WR spots; the one where he starts is the one that says who replaces him.
 */
export function pickDepthRow<T extends { position: string; players: DepthRaw[] }>(rows: readonly T[], riId: string): (T & { depth: number }) | null {
  let best: (T & { depth: number }) | null = null
  for (const r of rows) {
    const i = r.players.findIndex((p) => p.id === riId)
    if (i < 0) continue
    const depth = i + 1
    const order = DEPTH_FANTASY_SLOTS.indexOf(r.position as (typeof DEPTH_FANTASY_SLOTS)[number])
    const bestOrder = best ? DEPTH_FANTASY_SLOTS.indexOf(best.position as (typeof DEPTH_FANTASY_SLOTS)[number]) : Infinity
    if (!best || depth < best.depth || (depth === best.depth && order < bestOrder)) best = { ...r, depth }
  }
  return best
}

/** "RB" as is; the vendor's split receiver rows read as "WR spot 2" — a spot, not a rank. */
export function slotLabel(slot: string): string {
  const wr = /^WR([123])$/.exec(slot)
  return wr ? `WR spot ${wr[1]}` : slot
}

export type DepthEntry = {
  depth: number
  name: string
  /** Null when the identity map has no single Sleeper id for this vendor id. */
  sleeperId: string | null
  /** A finder ref that resolves back to this same player, or null (then the name is not a link). */
  ref: string | null
  isHim: boolean
}

export type BackupState = 'yours' | 'other' | 'free' | 'unknown'

export type BackupCell = {
  leagueId: string
  leagueName: string
  state: BackupState
  /** "starting", "bench", "IR", "taxi" when yours; the other team's name when theirs. */
  detail: string | null
  claim: PlatformLink | null
}

export type DepthChartView = {
  team: string
  slot: string
  asOfIso: string
  hisDepth: number
  entries: DepthEntry[]
  /** Per backup (by sleeperId), where he is in each of your leagues. Null when signed out or nothing to read. */
  presence: Record<string, BackupCell[]> | null
}

const YOURS: Record<string, string> = { STARTER: 'starting', BENCH: 'bench', 'IR SLOT': 'IR', TAXI: 'taxi' }

/**
 * One backup, every league in scope. The same three-way split as the league strip — a league whose
 * rosters we could not read is `unknown`, never `free`.
 */
export function presenceCells(
  leagues: ReadonlyArray<{ id: string; name: string }>,
  slots: readonly LeagueSlot[],
  unmatched: ReadonlyArray<{ leagueId: string }>,
  claimFor: (leagueId: string) => PlatformLink | null,
): BackupCell[] {
  const slotById = new Map(slots.map((s) => [s.leagueId, s]))
  const unreadable = new Set(unmatched.map((u) => u.leagueId))
  const cells: BackupCell[] = leagues.map((l) => {
    const s = slotById.get(l.id)
    if (s) {
      return s.isYours
        ? { leagueId: l.id, leagueName: l.name, state: 'yours', detail: YOURS[s.slot] ?? 'rostered', claim: null }
        : { leagueId: l.id, leagueName: l.name, state: 'other', detail: s.owner?.teamName ?? null, claim: null }
    }
    if (unreadable.has(l.id)) return { leagueId: l.id, leagueName: l.name, state: 'unknown', detail: null, claim: null }
    return { leagueId: l.id, leagueName: l.name, state: 'free', detail: null, claim: claimFor(l.id) }
  })
  return cells.sort((a, b) => a.leagueName.localeCompare(b.leagueName))
}

export function groupCells(cells: readonly BackupCell[]): Record<BackupState, BackupCell[]> {
  const g: Record<BackupState, BackupCell[]> = { yours: [], free: [], other: [], unknown: [] }
  for (const c of cells) g[c.state].push(c)
  return g
}
