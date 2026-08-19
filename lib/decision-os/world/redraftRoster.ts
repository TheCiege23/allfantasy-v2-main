/**
 * Decision OS — Phase 2 Canonical World Assembly: PURE native-redraft roster projection.
 *
 * Native AllFantasy redraft leagues persist roster ownership in `RedraftRoster` / `RedraftRosterPlayer`
 * rows, NOT in the canonical `Roster.playerData` blob the substrate historically read. These pure
 * transforms project those rows into the SAME origin-blind {@link RawRosterRow} shape the existing
 * assembler consumes — so a redraft-sourced world is structurally indistinguishable from an imported one
 * (origin survives only in `provenance.sourceModels`, never in the facts).
 *
 * No IO, no prisma, no writes here — the read lives in `port.ts`; this file is the deterministic mapping.
 *
 * ADR: lib/decision-os/ADR_CANONICAL_WORLD_REDRAFT_COVERAGE.md (Option A — read-only, additive).
 *
 * GUARDRAIL: only player IDS are projected. `RedraftRosterPlayer` also carries position / injuryStatus /
 * byeWeek / team, but folding those into roster facts would break origin-blindness (imported leagues lack
 * them inline). Player metadata stays a downstream enrichment-seam concern (`world/playerMetadata.ts`).
 */
import type { RawRosterRow } from './facts'

/** Decoupled-from-prisma view of a `RedraftRosterPlayer` row (only the fields the substrate reads). */
export interface RawRedraftRosterPlayerRow {
  playerId: string
  slotType: string | null
}

/** Decoupled-from-prisma view of a `RedraftRoster` row (+ its non-dropped players). */
export interface RawRedraftRosterRow {
  id: string
  ownerId: string | null
  faabBalance: number | null
  waiverPriority: number | null
  players: RawRedraftRosterPlayerRow[]
}

// Slot vocabulary shared with `lib/redraft/*` (rosterConfigResolver / lineupValidation). Case-insensitive.
const RESERVE_SLOTS = new Set(['IR', 'RESERVE'])
const TAXI_SLOTS = new Set(['TAXI', 'DEVY'])
const BENCH_SLOTS = new Set(['BENCH', 'BN'])

/**
 * Project `RedraftRosterPlayer` rows into the canonical `playerData` blob shape
 * (`{ players, starters, reserve, taxi }`) that {@link projectRosterSlots} consumes. Bench is NOT
 * emitted here — it is derived downstream as `players − (starters ∪ reserve ∪ taxi)`, exactly as for an
 * imported league. A `slotType` that is BENCH/BN falls into neither starters/reserve/taxi, so the player
 * still appears in `players` and is correctly derived to bench. Any other token (a position like QB/RB or
 * the literal `starter`/`starters`) is a starter.
 */
export function projectRedraftRosterPlayerData(players: RawRedraftRosterPlayerRow[]): {
  players: string[]
  starters: string[]
  reserve: string[]
  taxi: string[]
} {
  const all: string[] = []
  const starters: string[] = []
  const reserve: string[] = []
  const taxi: string[] = []

  for (const p of players) {
    const id = typeof p?.playerId === 'string' ? p.playerId.trim() : ''
    if (!id) continue
    all.push(id)
    const slot = (p.slotType ?? '').trim().toUpperCase()
    if (RESERVE_SLOTS.has(slot)) reserve.push(id)
    else if (TAXI_SLOTS.has(slot)) taxi.push(id)
    else if (BENCH_SLOTS.has(slot)) continue // bench is derived downstream — present in `players` only
    else starters.push(id) // position token or starter/starters → starter
  }

  return { players: all, starters, reserve, taxi }
}

/**
 * Honest carry of the per-team waiver order for a redraft roster. `RedraftRoster.waiverPriority` is a
 * non-null `Int @default(0)`, where `0` means "unset" (FAAB leagues, or never assigned). Surface only a
 * real priority (`> 0`); map the `0` default to `null` rather than inventing a "priority 0".
 */
export function normalizeRedraftWaiverPriority(value: number | null): number | null {
  return typeof value === 'number' && value > 0 ? value : null
}

/**
 * Map a `RedraftRoster` (+ players) row into the origin-blind {@link RawRosterRow}. The owner id becomes
 * `platformUserId` so the existing write-free `matchTeamIdForRoster` native join (platformUserId →
 * LeagueTeam.platformUserId / claimedByUserId) resolves it. `settings` is honestly null (no equivalent
 * blob). Tagged `sourceModel: 'RedraftRoster'` for provenance only.
 */
export function mapRedraftRosterRowToRawRoster(row: RawRedraftRosterRow): RawRosterRow {
  return {
    id: row.id,
    platformUserId: row.ownerId ?? '',
    playerData: projectRedraftRosterPlayerData(row.players ?? []),
    faabRemaining: row.faabBalance ?? null,
    waiverPriority: normalizeRedraftWaiverPriority(row.waiverPriority),
    settings: null,
    sourceModel: 'RedraftRoster',
  }
}

/**
 * Union canonical `Roster` rows with redraft-projected rows, deduped by owner identity (`platformUserId`).
 * Canonical `Roster` WINS: a redraft roster whose owner already has a canonical roster is dropped, so a
 * league that has migrated into `Roster.playerData` is never double-counted. Redraft rosters fill ONLY the
 * coverage gap (owners with no canonical roster). Empty-string owner ids are never used as a dedupe key
 * (they would wrongly collapse distinct rosters), so such rows are always kept.
 */
export function unionRosterRows(canonical: RawRosterRow[], redraft: RawRosterRow[]): RawRosterRow[] {
  const coveredOwners = new Set(
    canonical.map((r) => r.platformUserId).filter((id) => typeof id === 'string' && id.length > 0),
  )
  const gapFilling = redraft.filter(
    (r) => !(typeof r.platformUserId === 'string' && r.platformUserId.length > 0 && coveredOwners.has(r.platformUserId)),
  )
  return [...canonical, ...gapFilling]
}
