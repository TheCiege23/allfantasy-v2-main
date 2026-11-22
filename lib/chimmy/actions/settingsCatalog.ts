import type { ChimmySettingKey } from './types'

/**
 * The league settings a commissioner can change by asking Chimmy — stage 5 of Chimmy (2026-11-16).
 *
 * Deliberately a short list of plain `League` columns, each with the bounds the settings page itself
 * enforces. Scoring rules, roster slot layout, draft setup and league size are NOT here: they cascade
 * into rosters, lineups and the draft, and stay on the settings page. Pure — no server imports.
 */

export type SettingsSection = 'general' | 'waivers' | 'trades' | 'playoffs' | 'roster'
export type SettingValue = string | number | null

type Parsed = { ok: true; value: SettingValue } | { ok: false; reason: string }

export type SettingDef = {
  key: ChimmySettingKey
  label: string
  section: SettingsSection
  /** Read a model-supplied value. `ctx.teamCount` bounds the playoff field. */
  parse: (raw: unknown, ctx: { teamCount: number }) => Parsed
  /** How the value reads on the card. */
  show: (v: SettingValue) => string
}

const WAIVER_TYPE_LABEL: Record<string, string> = {
  faab: 'FAAB bidding',
  rolling: 'Rolling waivers',
  reverse_standings: 'Reverse standings',
}

function int(raw: unknown, min: number, max: number, what: string): Parsed {
  const n = typeof raw === 'string' ? Number(raw.replace(/[$,\s]/g, '')) : raw
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, reason: `${what} must be a whole number` }
  if (n < min || n > max) return { ok: false, reason: `${what} must be between ${min} and ${max}` }
  return { ok: true, value: n }
}

const hours = (v: SettingValue) => (v == null ? 'not set' : Number(v) === 0 ? 'no review period' : `${v} hour${Number(v) === 1 ? '' : 's'}`)
const week = (v: SettingValue) => (v == null ? 'not set' : `Week ${v}`)
const plain = (v: SettingValue) => (v == null ? 'not set' : String(v))

export const SETTINGS_CATALOG: Record<ChimmySettingKey, SettingDef> = {
  name: {
    key: 'name',
    label: 'League name',
    section: 'general',
    parse: (raw) => {
      const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : ''
      if (!s) return { ok: false, reason: 'the league name cannot be empty' }
      if (s.length > 60) return { ok: false, reason: 'the league name can be at most 60 characters' }
      return { ok: true, value: s }
    },
    show: plain,
  },
  waiverType: {
    key: 'waiverType',
    label: 'Waiver type',
    section: 'waivers',
    parse: (raw) => {
      const s = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
      const v = s === 'faab' || s === 'bidding' || s === 'faab_bidding' ? 'faab' : s === 'rolling' || s === 'rolling_waivers' ? 'rolling' : s === 'reverse_standings' || s === 'reverse_order' ? 'reverse_standings' : null
      return v ? { ok: true, value: v } : { ok: false, reason: 'waiver type must be FAAB, rolling or reverse standings' }
    },
    show: (v) => (v == null ? 'not set' : WAIVER_TYPE_LABEL[String(v)] ?? String(v)),
  },
  waiverBudget: {
    key: 'waiverBudget',
    label: 'FAAB budget',
    section: 'waivers',
    parse: (raw) => int(raw, 1, 10_000, 'the FAAB budget'),
    show: (v) => (v == null ? 'not set' : `$${v}`),
  },
  waiverMinBid: {
    key: 'waiverMinBid',
    label: 'Minimum FAAB bid',
    section: 'waivers',
    parse: (raw) => int(raw, 0, 100, 'the minimum bid'),
    show: (v) => (v == null ? 'not set' : `$${v}`),
  },
  tradeReviewHours: {
    key: 'tradeReviewHours',
    label: 'Trade review period',
    section: 'trades',
    parse: (raw) => int(raw, 0, 168, 'the trade review period (hours)'),
    show: hours,
  },
  tradeDeadlineWeek: {
    key: 'tradeDeadlineWeek',
    label: 'Trade deadline',
    section: 'trades',
    parse: (raw, _ctx) => {
      if (raw === null || raw === 0 || raw === '0' || (typeof raw === 'string' && /^(none|no deadline|off)$/i.test(raw.trim()))) return { ok: true, value: null }
      return int(raw, 1, 18, 'the trade deadline week')
    },
    show: (v) => (v == null ? 'no deadline' : `Week ${v}`),
  },
  playoffTeams: {
    key: 'playoffTeams',
    label: 'Playoff teams',
    section: 'playoffs',
    parse: (raw, ctx) => int(raw, 2, Math.max(2, ctx.teamCount), 'playoff teams'),
    show: plain,
  },
  playoffStartWeek: {
    key: 'playoffStartWeek',
    label: 'Playoffs start',
    section: 'playoffs',
    parse: (raw) => int(raw, 10, 18, 'the playoff start week'),
    show: week,
  },
  irSlots: {
    key: 'irSlots',
    label: 'IR slots',
    section: 'roster',
    parse: (raw) => int(raw, 0, 10, 'IR slots'),
    show: plain,
  },
}

export const SETTING_KEYS = Object.keys(SETTINGS_CATALOG) as ChimmySettingKey[]

export function isSettingKey(k: string): k is ChimmySettingKey {
  return (SETTING_KEYS as string[]).includes(k)
}

/** A stored value in the shape the catalog compares — numbers as numbers, blanks as null. */
export function normalizeStored(key: ChimmySettingKey, v: unknown): SettingValue {
  if (v === undefined || v === null || v === '') return null
  if (key === 'name') return String(v)
  if (key === 'waiverType') return String(v).toLowerCase()
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export const sameSetting = (a: SettingValue, b: SettingValue) => (a ?? null) === (b ?? null)
