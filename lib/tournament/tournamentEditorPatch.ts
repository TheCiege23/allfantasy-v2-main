/**
 * The Specialty tab's Tournament editor: parse what the form sends into the `SettingsPatch` that
 * lib/tournament/updateTournamentSettings.ts applies. Pure.
 *
 * The editable set is EXACTLY what `updateTournamentSettings` accepts — that module owns the
 * reasoning for why the cut can change after creation and why the structure (conference count,
 * leagues per conference, teams per league, sport) cannot. This file only refuses wrong TYPES,
 * which the hub route silently coerces (`Number('x')` → NaN → "whole number" error, `Boolean('false')`
 * → true), so a form here gets a precise answer instead of a surprising save.
 */
import type { SettingsPatch } from './updateTournamentSettings'

export const TOURNAMENT_TIEBREAKERS = ['points_for', 'points_against_inverse'] as const

/** What the editor shows, read from `TournamentShell`. */
export type TournamentEditorValue = {
  name: string
  advancersPerLeague: number
  wildcardCount: number
  bubbleEnabled: boolean
  bubbleSize: number
  tiebreakerMode: string
}

export function parseTournamentEditorPatch(
  raw: Record<string, unknown>,
  current: TournamentEditorValue,
): { ok: true; patch: SettingsPatch } | { ok: false; error: string } {
  const patch: SettingsPatch = {}

  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || !raw.name.trim()) return { ok: false, error: 'The tournament needs a name.' }
    if (raw.name.trim().length > 120) return { ok: false, error: 'The tournament name can be at most 120 characters.' }
    patch.name = raw.name.trim()
  }

  for (const key of ['advancersPerLeague', 'wildcardCount', 'bubbleSize'] as const) {
    if (raw[key] === undefined) continue
    const n = raw[key]
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 64) {
      return { ok: false, error: `${key} must be a whole number from 0 to 64` }
    }
    patch[key] = n
  }
  // ⚠ advancersPerLeague 0 IS VALID: some tournaments make the whole cut conference-wide
  // (`advancersPerLeague: 0` plus `wildcardCount`) — see lib/tournament/standingsBoard.ts.
  // The cut that must not be empty is the SUM, judged against the saved other half.
  const perLeague = patch.advancersPerLeague ?? current.advancersPerLeague
  const perConference = patch.wildcardCount ?? current.wildcardCount
  if ((patch.advancersPerLeague !== undefined || patch.wildcardCount !== undefined) && perLeague === 0 && perConference === 0) {
    return { ok: false, error: 'Someone has to advance: set advancers per league or per conference above 0.' }
  }

  if (raw.bubbleEnabled !== undefined) {
    if (typeof raw.bubbleEnabled !== 'boolean') return { ok: false, error: 'bubbleEnabled must be true or false' }
    patch.bubbleEnabled = raw.bubbleEnabled
  }

  if (raw.tiebreakerMode !== undefined) {
    if (!(TOURNAMENT_TIEBREAKERS as readonly unknown[]).includes(raw.tiebreakerMode)) {
      return { ok: false, error: `tiebreakerMode must be one of: ${TOURNAMENT_TIEBREAKERS.join(', ')}` }
    }
    patch.tiebreakerMode = raw.tiebreakerMode as string
  }

  if (raw.conferenceNames !== undefined) {
    if (!Array.isArray(raw.conferenceNames)) return { ok: false, error: 'conferenceNames must be a list' }
    const names: Array<{ id: string; name: string }> = []
    for (const c of raw.conferenceNames as unknown[]) {
      const rec = (c ?? {}) as Record<string, unknown>
      if (typeof rec.id !== 'string' || !rec.id || typeof rec.name !== 'string' || !rec.name.trim()) {
        return { ok: false, error: 'Each conference needs an id and a name.' }
      }
      if (rec.name.trim().length > 60) return { ok: false, error: 'A conference name can be at most 60 characters.' }
      names.push({ id: rec.id, name: rec.name.trim() })
    }
    patch.conferenceNames = names
  }

  return { ok: true, patch }
}
