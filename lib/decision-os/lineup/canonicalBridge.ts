/**
 * Decision OS — Canonical World → `manager.lineup.set` input bridge (Slice 1, shadow-only).
 *
 * When the redraft-native loader (./loader) can't resolve usable lineup inputs — e.g. an IMPORTED
 * league that was never AF-drafted, so it has no RedraftRoster gameplay projection — this bridge falls
 * back to the origin-blind Canonical World substrate (lib/decision-os/world) and projects the viewer's
 * roster facts into the SAME RunLineupSetInput shape. READ-ONLY: the projector is pure and the resolver
 * only reads through `resolveCanonicalWorld` (port = prisma find* only). It NEVER writes, never repairs
 * ownership, and never fabricates player metadata.
 *
 * HONESTY CONTRACT: the substrate carries raw player ids + slot membership only. The pure projector
 * leaves name / position / injury / bye / projection blank and flags `scanIncomplete` with a null
 * projection confidence + a `player_metadata_missing` warning. The read-only resolver then enriches those
 * ids through the Canonical World player-metadata seam (SportsPlayer cache): real name / position / team /
 * injury status fill in when available, and `scanIncomplete` clears ONLY when EVERY player resolves the
 * required metadata. Bye week and projections remain null (no provider-id-keyed source carries them) —
 * never fabricated — so projectionConfidence stays null and the decision still degrades honestly.
 *
 * ORIGIN-BLINDNESS: the returned `source` tag (redraft_native / canonical_world / canonical_world_-
 * unavailable) is PROVENANCE/DEBUG metadata only. It is recorded in telemetry but must never change a
 * decision rule — only completeness/uncertainty does.
 */
import type { CanonicalWorld, PlayerMetadataResult } from '@/lib/decision-os/world'
import { resolveCanonicalWorld, resolvePlayerMetadata } from '@/lib/decision-os/world'
import type { RedraftLineupPlayer } from '@/lib/redraft/lineupValidation'
import type { RunLineupSetInput } from './index'

/** Where a resolved lineup input came from — PROVENANCE/DEBUG ONLY (never a decision input). */
export type LineupInputSource = 'redraft_native' | 'canonical_world' | 'canonical_world_unavailable'

export interface ResolvedLineupInputs {
  input: RunLineupSetInput | null
  source: LineupInputSource
  /** Honest degradation notes (provenance/debug only — never consumed by decision rules). */
  warnings: string[]
}

/**
 * Map a canonical roster's slot facts onto the lineup player's `slotType`. The substrate knows STARTER
 * vs BENCH vs IR(reserve) vs TAXI membership, but NOT which specific starter slot (QB/RB/FLEX/…) — so a
 * starter is honestly marked `STARTER`, never an invented position slot.
 */
function slotTypeFor(id: string, roster: CanonicalWorld['rosters'][number]): string {
  if (roster.starterIds.includes(id)) return 'STARTER'
  if (roster.reserveIds.includes(id)) return 'IR'
  if (roster.taxiIds.includes(id)) return 'TAXI'
  return 'BENCH'
}

/**
 * Pure projection: turn a Canonical World + viewer id into a RunLineupSetInput (or null + reason).
 *
 * Resolves the viewer's roster via the origin-blind join managerUserId → teamId → roster (NO write,
 * NO owner repair). Returns:
 *   - input + source 'canonical_world'              when a roster with players is found
 *   - null  + source 'canonical_world_unavailable'  when the viewer's roster can't be resolved or is empty
 *
 * Player metadata is never fabricated: name/position are blank, injury/bye null, and the input is
 * flagged `scanIncomplete` with null projection confidence + a `player_metadata_missing` warning.
 */
export function projectCanonicalLineupInput(
  world: CanonicalWorld,
  userId: string,
  leagueId: string,
): ResolvedLineupInputs {
  // World-level completeness warnings travel with the projection (current_week / faab / unmatched / …).
  const warnings = [...world.completeness.warnings]

  // Viewer → team → roster (origin-blind; managerUserId = claimedByUserId ?? platformUserId).
  const team = world.teams.find((t) => t.managerUserId != null && t.managerUserId === userId) ?? null
  const roster = team ? world.rosters.find((r) => r.teamId === team.teamId) ?? null : null
  if (!team || !roster) {
    return { input: null, source: 'canonical_world_unavailable', warnings: [...warnings, 'roster_not_resolved'] }
  }
  if (roster.playerCount === 0) {
    return {
      input: null,
      source: 'canonical_world_unavailable',
      warnings: [...warnings, 'inputs_unavailable', 'roster_empty'],
    }
  }

  // Substrate never enriches player metadata — degrade honestly (no fake position/injury/projection).
  const metadataMissing = !roster.playerMetadataEnriched
  if (metadataMissing) warnings.push('player_metadata_missing')

  const players: RedraftLineupPlayer[] = roster.playerIds.map((id) => ({
    playerId: id,
    playerName: '', // honestly blank — substrate has no player name
    position: '', // honestly blank — substrate has no position
    sport: world.league.sport,
    slotType: slotTypeFor(id, roster),
    injuryStatus: null, // never fabricated
    byeWeek: null, // never fabricated
  }))

  // Current week from canonical data when derivable, else a safe default (flagged via world warnings).
  const week = Math.max(1, Number(world.league.currentWeek ?? 1) || 1)

  const input: RunLineupSetInput = {
    sport: world.league.sport,
    leagueSettings: world.league.scoringSettings ?? null, // same raw league.settings blob the native path passes
    leagueWeek: week,
    editingWeek: week,
    userId,
    leagueId,
    rosterId: roster.rosterId,
    players,
    // Honest degradation hooks: projections/metadata unavailable in the substrate today.
    projectionConfidence: null,
    scanIncomplete: metadataMissing,
  }

  return { input, source: 'canonical_world', warnings }
}

/**
 * Pure: fold resolved player metadata into a projected lineup input.
 *
 * REQUIRED metadata = name + position (what downstream lineup legality consumes). `scanIncomplete` clears
 * ONLY when EVERY player resolved both — partial resolution stays incomplete. Bye week and projections are
 * honest gaps in the source: they remain null and NEVER clear `scanIncomplete` on their own, and
 * projectionConfidence stays null (no projection source — never fabricated). Provider ids stay the player
 * key / provenance; the business fields are overwritten from metadata only when present (never blanked).
 * A null/absent metadata result is a no-op, preserving the projector's honest-degradation output.
 */
export function enrichLineupInputWithMetadata(
  resolved: ResolvedLineupInputs,
  metadata: PlayerMetadataResult,
): ResolvedLineupInputs {
  const input = resolved.input
  if (!input) return resolved

  const players: RedraftLineupPlayer[] = input.players.map((p) => {
    const m = metadata.byId.get(p.playerId)
    if (!m) return p
    return {
      ...p,
      playerName: m.name ?? p.playerName,
      position: m.position ?? p.position,
      team: m.team ?? p.team,
      injuryStatus: m.injuryStatus ?? p.injuryStatus ?? null,
      byeWeek: m.byeWeek ?? p.byeWeek ?? null,
    }
  })

  const metadataComplete = metadata.complete
  // Drop the projector's blanket `player_metadata_missing` once enrichment completed; otherwise keep the
  // honest warnings from BOTH the projection and the metadata resolution (merged + de-duped).
  const warnings = Array.from(
    new Set([
      ...resolved.warnings.filter((w) => (metadataComplete ? w !== 'player_metadata_missing' : true)),
      ...metadata.warnings,
    ]),
  )

  return {
    ...resolved,
    input: {
      ...input,
      players,
      projectionConfidence: null, // projections unavailable → confidence stays null (never fabricated)
      scanIncomplete: !metadataComplete, // clears ONLY when required metadata is complete for all players
    },
    warnings,
  }
}

export interface CanonicalLineupFallbackDeps {
  /** Read-only canonical world resolver (default: resolveCanonicalWorld → prisma find* only). */
  resolveWorld: (leagueId: string) => Promise<CanonicalWorld | null>
  /**
   * Read-only player-metadata resolver (default: SportsPlayer cache via resolvePlayerMetadata). Invoked
   * with the projected roster's player ids + sport to enrich name / position / team / injury. Never
   * throws (degrades to an incomplete result). Injected so tests never touch prisma. When absent, the
   * resolver skips enrichment and returns the projector's honest-degradation output unchanged.
   */
  resolveMetadata?: (sport: string, ids: string[]) => Promise<PlayerMetadataResult>
}

export const defaultCanonicalLineupFallbackDeps: CanonicalLineupFallbackDeps = {
  resolveWorld: (leagueId) => resolveCanonicalWorld(leagueId),
  resolveMetadata: (sport, ids) => resolvePlayerMetadata(sport, ids),
}

/**
 * Resolve lineup inputs from the Canonical World substrate ONLY (the native path is tried first by the
 * shadow runner). Read-only and NEVER throws — any failure degrades to `canonical_world_unavailable`.
 * Returns `null` world → `canonical_world_unavailable`; otherwise projects the roster facts, then enriches
 * the player ids through the read-only metadata seam so the lineup input carries real name / position /
 * injury when available (still honestly incomplete when metadata is missing).
 */
export async function resolveCanonicalLineupInputs(
  userId: string,
  leagueId: string,
  deps: CanonicalLineupFallbackDeps = defaultCanonicalLineupFallbackDeps,
): Promise<ResolvedLineupInputs> {
  try {
    const world = await deps.resolveWorld(leagueId)
    if (!world) {
      return { input: null, source: 'canonical_world_unavailable', warnings: ['canonical_world_unavailable'] }
    }
    const projected = projectCanonicalLineupInput(world, userId, leagueId)
    if (!projected.input) return projected

    const resolveMetadata = deps.resolveMetadata ?? defaultCanonicalLineupFallbackDeps.resolveMetadata
    if (!resolveMetadata) return projected

    const ids = projected.input.players.map((p) => p.playerId)
    const metadata = await resolveMetadata(projected.input.sport, ids)
    return enrichLineupInputWithMetadata(projected, metadata)
  } catch {
    return { input: null, source: 'canonical_world_unavailable', warnings: ['canonical_world_error'] }
  }
}
