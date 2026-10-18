/**
 * The saved plan for a divisions & conferences tournament: name, commissioner
 * settings (TournamentFormat step 1) and identity (TournamentIdentity step 2).
 * Pure — the store persists what this accepts.
 */
import { z } from 'zod'
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
