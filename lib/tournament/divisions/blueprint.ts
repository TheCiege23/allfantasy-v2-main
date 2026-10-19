/**
 * The saved plan for a divisions & conferences tournament: name, commissioner
 * settings (TournamentFormat step 1) and identity (TournamentIdentity step 2).
 * Pure — the store persists what this accepts.
 */
import { z } from 'zod'
import { LABEL_DEFAULTS, type RosterLabelId, type ScoringLabelId } from '@/lib/league-labels/catalog'
import { divisionsCalendar, validateFormatSettings, type FormatSettings } from './engine'
import { parseIdentity, type DivisionIdentity } from './identity'

export const formatSettingsSchema = z.object({
  sport: z.enum(['NFL', 'NBA']),
  conferencesPerDivision: z.number().int(),
  teamsPerConference: z.number().int(),
  autoBids: z.number().int(),
  wildcardSpots: z.number().int(),
  regions: z.literal(4),
  seasonLength: z.number().int().min(8).max(30),
})

export type DivisionsBlueprint = { version: 1; name: string; settings: FormatSettings; identity: DivisionIdentity }

/**
 * The scoring and roster labels a divisions tournament plays under.
 *
 * ⚠ The saved plan has no `scoringId` / `rosterId` yet (the handoff's storage shape), so every
 * divisions tournament uses its sport's defaults: NFL Half PPR + Standard, NBA Points + Standard.
 * The planner, hub and invite page all read them from here; when the plan gains the fields,
 * read them from the saved config instead and unlock the planner's picker.
 */
export function divisionsRulesLabels(sport: FormatSettings['sport']): { scoringId: ScoringLabelId; rosterId: RosterLabelId } {
  const d = LABEL_DEFAULTS[sport]
  return { scoringId: d.scoring, rosterId: d.roster }
}

export class DivisionsBlueprintError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join(' '))
    this.name = 'DivisionsBlueprintError'
  }
}

export function buildDivisionsBlueprint(input: unknown) {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const issues: string[] = []
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (name.length < 3 || name.length > 120) issues.push('Give the tournament a name of 3 to 120 characters.')
  const settings = formatSettingsSchema.safeParse(raw.settings)
  if (!settings.success) issues.push('Check the format settings.')
  const report = settings.success ? validateFormatSettings(settings.data) : null
  if (report) issues.push(...report.errors)
  const identity = parseIdentity(raw.identity)
  if (!identity.ok) issues.push(...identity.issues)
  if (settings.success && identity.ok && identity.identity.conferences.length !== settings.data.conferencesPerDivision) {
    issues.push(`Name ${settings.data.conferencesPerDivision} conferences to match the format settings.`)
  }
  if (issues.length || !settings.success || !identity.ok || !report) throw new DivisionsBlueprintError([...new Set(issues)])
  const config: DivisionsBlueprint = { version: 1, name, settings: settings.data, identity: identity.identity }
  return { config, report, calendar: divisionsCalendar(settings.data) }
}
