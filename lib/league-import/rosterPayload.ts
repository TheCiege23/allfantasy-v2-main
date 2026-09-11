/**
 * The one place import metadata is written into and read out of `Roster.playerData` —
 * Batch A.1 items 2 and 6.
 *
 * 🛑 THE RISK THIS EXISTS TO CLOSE. `Roster.playerData` is an untyped `Json` column read by
 * ~66 call sites across roster, valuation, waiver, trade and UI code. Adding a status
 * observation to it is the cheapest way to persist provenance without a migration — and also
 * the cheapest way to have some reader treat a metadata key as a player. So the metadata lives
 * under ONE reserved namespace key that cannot be mistaken for a player id, and both the write
 * and the read go through this module.
 *
 * ⚠ THE SAFETY IS STRUCTURAL, NOT CONVENTIONAL, AND THAT WAS MEASURED RATHER THAN ASSUMED.
 * Player ids live in the `players` ARRAY; a sibling key of the enclosing object is simply not
 * in that array. The canonical extractor `getRosterPlayerIds` reads `playerData.players` and
 * nothing else, so it cannot see this key. The two readers that touch the object structurally
 * were both checked: `DispersalDraftEngine.readPlayerDataRoot` spreads the record and then
 * reads `.players`; `waiver-wire/roster-utils` spreads it precisely to PRESERVE unknown
 * siblings (`{ ...playerData, lineup_sections: next }`), so a waiver edit carries the
 * observation forward rather than dropping it. No reader anywhere flattens `Object.values`.
 *
 * ⚠ AND THE EXTRACTOR IS RE-EXPORTED, NOT REIMPLEMENTED. A second copy of "how to read player
 * ids out of playerData" is exactly the two-implementations-of-one-rule bug this repo has paid
 * for before. `getRosterPlayerIds` already handles the legacy array shape and the object shape;
 * this module points at it rather than competing with it.
 */

import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import {
  buildObservation,
  isAuthoritativeStatus,
  type ResourceFetchStatus,
  type ResourceObservation,
} from '@/lib/league-import/resourceStatus'

/**
 * The reserved namespace key inside `Roster.playerData`.
 *
 * ⚠ THE `af_` PREFIX AND THE `_meta` SUFFIX ARE BOTH LOAD-BEARING. A provider player id is a
 * bare numeric or alphanumeric token (`"4046"`, `"KC"`); this cannot collide with one, and it
 * reads unmistakably as ours to a human debugging a JSON blob.
 */
export const IMPORT_META_KEY = 'af_import_meta' as const

export interface ImportRosterMeta {
  /** What actually happened on the provider read that produced this roster. */
  rosterStatus?: ResourceObservation
}

/** Re-exported canonical extractor. Never write a second one. */
export { getRosterPlayerIds }

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function readImportMeta(playerData: unknown): ImportRosterMeta {
  return asRecord(asRecord(playerData)[IMPORT_META_KEY]) as ImportRosterMeta
}

/** The stored observation, or null for a roster written before this existed. */
export function readRosterObservation(playerData: unknown): ResourceObservation | null {
  const meta = readImportMeta(playerData)
  const obs = meta.rosterStatus
  return obs && typeof obs === 'object' && typeof obs.status === 'string' ? obs : null
}

/**
 * Is this stored roster's content KNOWN?
 *
 * 🛑 ASK THIS BEFORE TREATING AN EMPTY `players` ARRAY AS "THIS MANAGER HAS NOBODY". That is the
 * whole point of the batch: an empty array is a real answer for a pre-draft league and a
 * placeholder for a league whose provider read failed, and only the observation separates them.
 *
 * ⚠ ABSENT MEANS KNOWN. A roster written before this module existed carries no observation, and
 * defaulting the other way would mark every historical roster unknown — which trains readers to
 * ignore the flag, which is how a guard stops guarding.
 */
export function isRosterContentKnown(playerData: unknown): boolean {
  const obs = readRosterObservation(playerData)
  if (!obs) return true
  return isAuthoritativeStatus(obs.status)
}

/**
 * Merge an observation into a roster payload without disturbing anything else in it.
 *
 * Returns a NEW object; the input is never mutated, because several callers hold the payload
 * they are about to write and a surprise mutation there is very hard to see.
 */
export function withRosterObservation(
  playerData: unknown,
  status: ResourceFetchStatus,
  now: Date = new Date(),
  previousLastGoodAt?: string | null,
): Record<string, unknown> {
  const base = asRecord(playerData)
  const existingMeta = readImportMeta(base)
  return {
    ...base,
    [IMPORT_META_KEY]: {
      ...existingMeta,
      rosterStatus: buildObservation(status, now, previousLastGoodAt ?? null),
    },
  }
}

/**
 * May this incoming roster replace what is stored?
 *
 * The single decision every import writer must consult — `SleeperLeagueCreationBootstrapService`,
 * `c2cMultiSourceCommit`, `LeagueImportToExistingService` and legacy `sleeper-sync` alike. Several
 * writers each deciding what an empty array means is the defect; this is the fix.
 */
export function mayReplaceStoredRoster(status: ResourceFetchStatus | null | undefined): boolean {
  return isAuthoritativeStatus(status)
}
