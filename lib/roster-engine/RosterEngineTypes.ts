export type SupportedRosterSport =
  | 'NFL'
  | 'NCAAF'
  | 'NBA'
  | 'NCAAB'
  | 'MLB'
  | 'NHL'
  | 'SOCCER'

export type RosterSource =
  | 'AF_DEFAULT'
  | 'PLATFORM_PRESET'
  | 'IMPORTED_EXACT'
  | 'IMPORTED_MAPPED'
  | 'CUSTOM'

export interface RosterAuditEntry {
  timestamp: string
  userId: string | null
  /** `scheduled`: AllFantasy applied a change the commissioner scheduled (lib/guillotine/rosterSchedule.ts). */
  action: 'created' | 'updated' | 'reset' | 'import' | 'scheduled'
  templateKey: string
  changedKeys?: string[]
}

export interface UnifiedRosterConfig {
  sport: SupportedRosterSport
  leagueType: string
  rosterTemplateKey: string
  rosterSource: RosterSource
  rosterConfigVersion: number
  rosterLastUpdatedAt: string | null
  rosterLastUpdatedBy: string | null
  rosterIsCustom: boolean
  rosterMatchesTemplate: boolean
  rosterWarnings: string[]
  rosterAuditLog?: RosterAuditEntry[]
  rosterConfig: {
    sections: Array<{
      key: string
      label: string
      slots: Record<string, number>
    }>
  }
}

export interface RosterSlotDefinition {
  key: string
  label: string
  shortLabel: string
  color: string
  category: string
  defaultCount: number
  minCount: number
  maxCount: number
}

export interface RosterTemplateDefinition {
  key: string
  label: string
  leagueTypes: string[]
  slots: Record<string, number>
  description: string
}

export interface RosterValidationResult {
  valid: boolean
  warnings: string[]
  errors: string[]
}

export interface RosterDiffResult {
  changedKeys: string[]
  changedCount: number
}

export interface ImportedRosterPayload {
  sourcePlatform: string
  sport: SupportedRosterSport
  importedConfig: Record<string, number>
}

export interface IRosterSportService {
  sport: SupportedRosterSport
  getConfig(leagueId: string): Promise<{
    templateKey: string
    slots: Record<string, number>
    isCustom: boolean
    lastUpdatedAt: string | null
    lastUpdatedBy: string | null
  }>
  saveConfig(
    leagueId: string,
    payload: { templateKey: string; slots: Record<string, number>; isCustom?: boolean; userId?: string },
  ): Promise<void>
  applyDefaultOnCreate(leagueId: string, leagueType: string): Promise<void>
  getSlots(): RosterSlotDefinition[]
  getTemplates(): RosterTemplateDefinition[]
  resolveDefaultTemplate(leagueType: string): RosterTemplateDefinition
}
