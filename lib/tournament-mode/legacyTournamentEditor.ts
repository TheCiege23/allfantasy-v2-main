/**
 * The Specialty tab's editor for a LEGACY tournament (`LegacyTournament`, the tournament-mode
 * stack). Pure: reading the editor's value out of the row, and validating a patch. The write is in
 * app/api/leagues/[leagueId]/specialty-settings/handler.ts.
 *
 * 🛑 ONLY KEYS THE LEGACY ENGINE READS. `settings` is free-form JSON, so a wrong key saves cleanly
 * and does nothing. The engine reads:
 *   - `bubbleWeekEnabled`               TournamentStandingsService / TournamentProgressionService
 *   - `eliminationAdvancementPerLeague` /api/tournament/[id]/advance (clamped to 11 there)
 *   - `qualificationTiebreakers`        TournamentAdvancementService / TournamentStandingsService
 *   - `faabBudgetDefault`, `faabResetByRound`, `benchSpotsElimination`  TournamentAdvancementService
 *   - `draftType`                       TournamentRedraftService
 * ⚠ The older hub route (/api/tournament/[id]/settings/update) writes `bubbleEnabled` and
 * `advancementPerLeague`, which nothing in lib/tournament-mode reads. Those are NOT used here.
 *
 * Structure (`participantPoolSize`, `qualificationWeeks`, `conferenceMode`) is not editable — the
 * same keys the hub's legacy-settings route refuses once a tournament is locked.
 */
import { DEFAULT_TOURNAMENT_SETTINGS } from './constants'

export const LEGACY_TIEBREAKER_KEYS = ['wins', 'points_for', 'points_against', 'head_to_head'] as const
export const LEGACY_DRAFT_TYPES = ['snake', 'auction'] as const
/** Statuses after which the bracket is running: draft type and the bubble week are frozen. */
export const LEGACY_LIVE_STATUSES = ['elimination', 'finals', 'completed'] as const

export type LegacyTournamentEditorValue = {
  name: string
  description: string
  draftType: (typeof LEGACY_DRAFT_TYPES)[number]
  bubbleWeekEnabled: boolean
  eliminationAdvancementPerLeague: number
  qualificationTiebreakers: string[]
  faabBudgetDefault: number
  faabResetByRound: boolean
  benchSpotsElimination: number
}

type Rec = Record<string, unknown>

const int = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isInteger(v) ? v : fallback)

export function legacyTournamentEditorValue(t: { name: string; settings: unknown; hubSettings: unknown }): LegacyTournamentEditorValue {
  const s = (t.settings ?? {}) as Rec
  const hub = (t.hubSettings ?? {}) as Rec
  const d = DEFAULT_TOURNAMENT_SETTINGS as unknown as Rec
  const tiebreakers = Array.isArray(s.qualificationTiebreakers)
    ? (s.qualificationTiebreakers as unknown[]).filter((k): k is string => typeof k === 'string')
    : (d.qualificationTiebreakers as string[])
  return {
    name: t.name,
    description: typeof hub.description === 'string' ? hub.description : '',
    draftType: s.draftType === 'auction' ? 'auction' : 'snake',
    bubbleWeekEnabled: Boolean(s.bubbleWeekEnabled),
    eliminationAdvancementPerLeague: int(s.eliminationAdvancementPerLeague, int(d.eliminationAdvancementPerLeague, 6)),
    qualificationTiebreakers: tiebreakers.length ? tiebreakers : ['wins', 'points_for'],
    faabBudgetDefault: int(s.faabBudgetDefault, int(d.faabBudgetDefault, 100)),
    faabResetByRound: s.faabResetByRound === undefined ? Boolean(d.faabResetByRound) : Boolean(s.faabResetByRound),
    benchSpotsElimination: int(s.benchSpotsElimination, int(d.benchSpotsElimination, 2)),
  }
}

export type LegacyTournamentPatch = {
  name?: string
  description?: string
  /** Keys merged into `LegacyTournament.settings`. */
  settings: Partial<Omit<LegacyTournamentEditorValue, 'name' | 'description'>>
  conferenceNames?: Array<{ id: string; name: string }>
}

export function parseLegacyTournamentPatch(
  raw: Rec,
  ctx: { locked: boolean; live: boolean },
): { ok: true; patch: LegacyTournamentPatch } | { ok: false; error: string } {
  const patch: LegacyTournamentPatch = { settings: {} }
  const fail = (error: string) => ({ ok: false as const, error })

  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || !raw.name.trim()) return fail('The tournament needs a name.')
    if (raw.name.trim().length > 120) return fail('The tournament name can be at most 120 characters.')
    patch.name = raw.name.trim()
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') return fail('description must be text')
    if (raw.description.length > 1500) return fail('The description can be at most 1500 characters.')
    patch.description = raw.description
  }
  // Same rule as the hub: participants have already seen posters and announcements with the name.
  if (ctx.locked && (patch.name !== undefined || patch.description !== undefined)) {
    return fail('The tournament is locked, so its name and description cannot change.')
  }

  const ranges = {
    eliminationAdvancementPerLeague: [1, 11],
    faabBudgetDefault: [0, 10_000],
    benchSpotsElimination: [0, 20],
  } as const
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
    if (raw[key] === undefined) continue
    const [min, max] = ranges[key]
    const n = raw[key]
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
      return fail(`${key} must be a whole number from ${min} to ${max}`)
    }
    patch.settings[key] = n
  }

  if (raw.faabResetByRound !== undefined) {
    if (typeof raw.faabResetByRound !== 'boolean') return fail('faabResetByRound must be true or false')
    patch.settings.faabResetByRound = raw.faabResetByRound
  }

  if (raw.qualificationTiebreakers !== undefined) {
    const list = raw.qualificationTiebreakers
    if (
      !Array.isArray(list) ||
      list.length === 0 ||
      list.some((k) => !(LEGACY_TIEBREAKER_KEYS as readonly unknown[]).includes(k)) ||
      new Set(list).size !== list.length
    ) {
      return fail(`qualificationTiebreakers must be a non-empty list of distinct: ${LEGACY_TIEBREAKER_KEYS.join(', ')}`)
    }
    patch.settings.qualificationTiebreakers = list as string[]
  }

  // The bracket is running: these would change a round already drafted or already cut.
  if (raw.draftType !== undefined) {
    if (!(LEGACY_DRAFT_TYPES as readonly unknown[]).includes(raw.draftType)) {
      return fail(`draftType must be one of: ${LEGACY_DRAFT_TYPES.join(', ')}`)
    }
    if (ctx.live) return fail('The elimination rounds have started, so the draft type cannot change.')
    patch.settings.draftType = raw.draftType as LegacyTournamentEditorValue['draftType']
  }
  if (raw.bubbleWeekEnabled !== undefined) {
    if (typeof raw.bubbleWeekEnabled !== 'boolean') return fail('bubbleWeekEnabled must be true or false')
    if (ctx.live) return fail('The elimination rounds have started, so the bubble week cannot change.')
    patch.settings.bubbleWeekEnabled = raw.bubbleWeekEnabled
  }

  if (raw.conferenceNames !== undefined) {
    if (!Array.isArray(raw.conferenceNames)) return fail('conferenceNames must be a list')
    const names: Array<{ id: string; name: string }> = []
    for (const c of raw.conferenceNames as unknown[]) {
      const rec = (c ?? {}) as Rec
      if (typeof rec.id !== 'string' || !rec.id || typeof rec.name !== 'string' || !rec.name.trim()) {
        return fail('Each conference needs an id and a name.')
      }
      if (rec.name.trim().length > 64) return fail('A conference name can be at most 64 characters.')
      names.push({ id: rec.id, name: rec.name.trim() })
    }
    patch.conferenceNames = names
  }

  return { ok: true, patch }
}
