export interface SlotDef {
  key: string
  label: string
  shortLabel: string
  color: string
  category: string
  defaultCount: number
  minCount: number
  maxCount: number
}

export interface RosterConfig {
  templateKey: string
  slots: Record<string, number>
  isCustom: boolean
  rosterSize?: { starters: number; bench: number; total: number }
}

export interface UnifiedRosterSection {
  key: string
  label: string
  slots: Record<string, number>
}

