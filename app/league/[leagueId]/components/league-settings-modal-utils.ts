/** Helpers for reading Sleeper-shaped data from Prisma `League.settings` JSON */

export function getSettingsRecord(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {}
  return settings as Record<string, unknown>
}

/** Merge top-level with nested Sleeper snapshot if present */
export function getSleeperLikeBundle(settings: unknown): Record<string, unknown> {
  const s = getSettingsRecord(settings)
  const nested =
    (s.sleeper as Record<string, unknown> | undefined) ??
    (s.sleeperLeague as Record<string, unknown> | undefined) ??
    (s.league as Record<string, unknown> | undefined)
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return { ...s, ...nested }
  }
  return s
}

export function getDraftIdFromSettings(settings: unknown): string | null {
  const s = getSleeperLikeBundle(settings)
  const d = s.draft_id ?? s.draftId
  if (typeof d === 'string' && d.trim()) return d.trim()
  if (typeof d === 'number' && Number.isFinite(d)) return String(d)
  return null
}

export function getScoringSettings(settings: unknown): Record<string, number> {
  const s = getSleeperLikeBundle(settings)
  const raw = s.scoring_settings
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return out
}

export function detectScoringFlavor(scoringSettings: Record<string, number>): 'PPR' | 'Half PPR' | 'Standard' | 'Custom' {
  const rec = scoringSettings.rec ?? scoringSettings.Rec ?? 0
  if (rec >= 1) return 'PPR'
  if (rec >= 0.5) return 'Half PPR'
  if (rec > 0) return 'Custom'
  return 'Standard'
}

export function formatConceptLabel(input: {
  leagueType?: string | null
  leagueVariant?: string | null
  isDynasty?: boolean | null
  guillotineMode?: boolean | null
  bestBallMode?: boolean | null
  fallbackFormat?: string | null
}): string | null {
  if (input.guillotineMode) return 'Guillotine'
  if (input.bestBallMode) return 'Best Ball'
  if (input.isDynasty) return 'Dynasty'

  const raw = input.leagueVariant ?? input.leagueType ?? input.fallbackFormat
  if (!raw?.trim()) return null
  return raw
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function formatDraftTypeLabel(draftType?: string | null): string | null {
  if (!draftType?.trim()) return null
  return draftType
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function formatScoringPresetLabel(scoring?: string | null, settings?: unknown): string | null {
  if (scoring?.trim()) return scoring.trim()
  const flavor = detectScoringFlavor(getScoringSettings(settings))
  return flavor === 'Custom' ? null : flavor
}

export function readLeagueTimezone(settings: unknown): string | null {
  const s = getSleeperLikeBundle(settings)
  const nested =
    typeof s.settings === 'object' && s.settings && !Array.isArray(s.settings)
      ? (s.settings as Record<string, unknown>)
      : null
  const raw = s.timezone ?? s.time_zone ?? nested?.timezone ?? nested?.time_zone
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

export function buildLeagueSummaryLine(input: {
  sport?: string | null
  teamCount?: number | null
  concept?: string | null
  draftType?: string | null
  scoringPreset?: string | null
  timezone?: string | null
}): string {
  return [
    input.sport?.trim(),
    Number.isFinite(input.teamCount ?? NaN) ? `${input.teamCount} teams` : null,
    input.concept,
    input.draftType,
    input.scoringPreset,
    input.timezone,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(' • ')
}

/** Human-readable label for a flat `scoring_settings` key (Sleeper-style). */
export function humanizeScoringKey(key: string): string {
  const t = key.trim()
  if (!t) return key
  return t
    .replace(/_/g, ' ')
    .split(/\s+/)
    .map((w) => (w.length ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
    .join(' ')
}

/**
 * Best-effort daily waiver / clear schedule lines from synced league JSON.
 * Shape varies by platform; may return empty when not present.
 */
export function extractWaiverScheduleLines(settings: unknown): { daily: string[]; clearWaivers?: string } {
  const b = getSleeperLikeBundle(settings)
  const daily: string[] = []

  const dw = b.daily_waivers
  if (dw && typeof dw === 'object' && !Array.isArray(dw)) {
    const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    const keys = Object.keys(dw as Record<string, unknown>)
    const sorted = [...keys].sort((a, b) => order.indexOf(a.toLowerCase()) - order.indexOf(b.toLowerCase()))
    for (const k of sorted.length ? sorted : keys) {
      const v = (dw as Record<string, unknown>)[k]
      if (v == null) continue
      const label = typeof v === 'object' ? JSON.stringify(v) : String(v)
      daily.push(`${k.charAt(0).toUpperCase()}${k.slice(1)}: ${label}`)
    }
  }

  const cw =
    b.clear_waiver_day ??
    b.clear_waivers_day ??
    b.waiver_clear_day ??
    (typeof b.settings === 'object' && b.settings && !Array.isArray(b.settings)
      ? (b.settings as Record<string, unknown>).clear_waiver_day
      : undefined)
  const clearWaivers =
    cw != null && String(cw).trim() ? `Clear waivers: ${String(cw)}` : undefined

  return { daily, clearWaivers }
}

export function waiverTypeLabel(waiverType: unknown): string {
  if (waiverType === 0 || waiverType === '0') return 'FAAB (waiver budget)'
  if (waiverType === 1 || waiverType === '1') return 'Rolling waivers'
  if (waiverType === 2 || waiverType === '2') return 'Reverse standings'
  return typeof waiverType === 'string' || typeof waiverType === 'number' ? String(waiverType) : '—'
}

/**
 * `waiverTypeLabel` in the reader's language: the same three values through the dictionary
 * (`lsPanel.waiver.*`, English byte-identical), anything else exactly as `waiverTypeLabel` prints it.
 */
export function waiverTypeText(waiverType: unknown, t: (key: string) => string): string {
  if (waiverType === 0 || waiverType === '0') return t('lsPanel.waiver.faab')
  if (waiverType === 1 || waiverType === '1') return t('lsPanel.waiver.rolling')
  if (waiverType === 2 || waiverType === '2') return t('lsPanel.waiver.reverse')
  return waiverTypeLabel(waiverType)
}

/** Best-effort division count from synced league JSON (host shapes vary). */
export function getDivisionCount(settings: unknown): number | null {
  const b = getSleeperLikeBundle(settings)
  const s = getSettingsRecord(settings)
  const nested =
    typeof b.settings === 'object' && b.settings && !Array.isArray(b.settings)
      ? (b.settings as Record<string, unknown>)
      : null
  const raw =
    b.divisions ??
    s.divisions ??
    b.num_divisions ??
    s.num_divisions ??
    nested?.divisions ??
    nested?.num_divisions
  if (Array.isArray(raw)) return raw.length
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() && !Number.isNaN(Number(raw))) return Number(raw)
  return null
}

/** Count each slot type from a Sleeper-style `roster_positions` array. */
export function groupRosterSlotCounts(rosterPositions: string[]): { slot: string; count: number }[] {
  const m = new Map<string, number>()
  for (const p of rosterPositions) {
    const k = String(p).trim()
    if (!k) continue
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  const entries = [...m.entries()]
  const order = [
    'QB',
    'RB',
    'WR',
    'TE',
    'FLEX',
    'REC_FLEX',
    'WRRB_FLEX',
    'WRT_FLEX',
    'SUPER_FLEX',
    'K',
    'DEF',
    'DL',
    'LB',
    'DB',
    'IDP_FLEX',
    'BN',
  ]
  const rank = (slot: string) => {
    const i = order.indexOf(slot)
    return i === -1 ? 500 + slot.charCodeAt(0) : i
  }
  entries.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
  return entries.map(([slot, count]) => ({ slot, count }))
}

export function sleeperAvatarUrl(avatar: string | null | undefined): string | null {
  if (!avatar?.trim()) return null
  const t = avatar.trim()
  if (t.startsWith('http://') || t.startsWith('https://')) return t
  return `https://sleepercdn.com/avatars/${t}`
}

export function leagueAvatarSrc(avatarUrl: string | null | undefined): string | null {
  return sleeperAvatarUrl(avatarUrl)
}

export function initialsFromName(name: string): string {
  const t = name.trim()
  if (!t) return 'AF'
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return t.slice(0, 2).toUpperCase()
}

export const SETTINGS_TAB_STORAGE_PREFIX = 'af-league-settings-tab-'

export type SettingsTabKey = 'user' | 'general' | 'commish' | 'ai' | 'idp'

export function readStoredTab(leagueId: string, isCommissioner: boolean): SettingsTabKey {
  if (typeof window === 'undefined') return 'general'
  try {
    const v = window.localStorage.getItem(`${SETTINGS_TAB_STORAGE_PREFIX}${leagueId}`) as SettingsTabKey | null
    if (v === 'ai' || v === 'general' || v === 'user') return v
    /** Legacy COMMISH tab merged into commissioner settings hub. */
    if (v === 'commish') return 'general'
    if (v === 'idp') return 'idp'
  } catch {
    /* ignore */
  }
  return 'general'
}

export function writeStoredTab(leagueId: string, tab: SettingsTabKey) {
  try {
    window.localStorage.setItem(`${SETTINGS_TAB_STORAGE_PREFIX}${leagueId}`, tab)
  } catch {
    /* ignore */
  }
}
