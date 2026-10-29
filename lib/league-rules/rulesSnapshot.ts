/**
 * "Rules changed" (2026-10-29): what a manager last saw of the league's rules, and what is different
 * now. Pure and client-safe.
 *
 * ⚠ COMPARED FROM THE RULEBOOK, NOT FROM THE SAVE EVENTS. Settings are saved through a dozen routes
 * (settings patch, draft settings, roster settings, the Guilly rules page…) and the events they write
 * carry field names, never the before and after values a manager needs. The rulebook
 * (./buildLeagueRulebook.ts) is already the plain-words reading of every one of them, so comparing
 * the rulebook a manager last saw with the one now catches a change from any route, batches several
 * edits into one card, and ignores whatever does not change a rule (a renamed league, a new avatar).
 *
 * ⚠ A WORDING CHANGE IS NOT A RULE CHANGE. Rewording a template would otherwise tell every manager
 * in every league that their rules changed. `RULEBOOK_SNAPSHOT_VERSION` is stored with the snapshot;
 * bump it whenever a template's VALUE wording changes, and an older snapshot is replaced silently.
 */
import type { RulebookEntry, RulebookSection } from './buildLeagueRulebook'

export const RULEBOOK_SNAPSHOT_VERSION = 1

/** Bounds on what is stored per league: the rulebook has ~25 entries with short values. */
export const SNAPSHOT_MAX_ENTRIES = 80
export const SNAPSHOT_MAX_VALUE_CHARS = 160

export type RulesSnapshot = {
  v: number
  /** entry id -> its label and value as the manager saw them. */
  rules: Record<string, { label: string; value: string }>
}

export type RuleChange = {
  id: string
  label: string
  /** null = the rule is new to this league. */
  before: string | null
  /** null = the rule no longer applies. */
  after: string | null
  /** What the rule means now; null when it no longer applies. */
  meaning: string | null
}

/** Every entry has its value (nothing still loading) — only then can it be compared or saved. */
export function isRulebookComplete(sections: readonly RulebookSection[]): boolean {
  return sections.every((s) => s.entries.every((e) => !e.pending))
}

export function rulebookSnapshot(sections: readonly RulebookSection[]): RulesSnapshot {
  const rules: RulesSnapshot['rules'] = {}
  for (const entry of sections.flatMap((s) => s.entries)) {
    if (Object.keys(rules).length >= SNAPSHOT_MAX_ENTRIES) break
    rules[entry.id] = { label: entry.label.slice(0, SNAPSHOT_MAX_VALUE_CHARS), value: entry.value.slice(0, SNAPSHOT_MAX_VALUE_CHARS) }
  }
  return { v: RULEBOOK_SNAPSHOT_VERSION, rules }
}

/** A stored snapshot, or null when it is missing, malformed, or from an older template version. */
export function readRulesSnapshot(raw: unknown): RulesSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (obj.v !== RULEBOOK_SNAPSHOT_VERSION) return null
  const rules = obj.rules
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return null
  const out: RulesSnapshot['rules'] = {}
  for (const [id, row] of Object.entries(rules as Record<string, unknown>)) {
    if (Object.keys(out).length >= SNAPSHOT_MAX_ENTRIES) break
    if (!row || typeof row !== 'object') continue
    const { label, value } = row as Record<string, unknown>
    if (typeof label !== 'string' || typeof value !== 'string' || id.length > 64) continue
    out[id] = { label: label.slice(0, SNAPSHOT_MAX_VALUE_CHARS), value: value.slice(0, SNAPSHOT_MAX_VALUE_CHARS) }
  }
  return { v: RULEBOOK_SNAPSHOT_VERSION, rules: out }
}

/** What differs between the snapshot a manager saw and the rulebook now, in rulebook order. */
export function diffRulebook(seen: RulesSnapshot, sections: readonly RulebookSection[]): RuleChange[] {
  const entries: RulebookEntry[] = sections.flatMap((s) => s.entries)
  const now = new Set(entries.map((e) => e.id))
  const changes: RuleChange[] = []
  for (const entry of entries) {
    const before = seen.rules[entry.id]
    const value = entry.value.slice(0, SNAPSHOT_MAX_VALUE_CHARS)
    if (before && before.value === value) continue
    changes.push({ id: entry.id, label: entry.label, before: before?.value ?? null, after: entry.value, meaning: entry.meaning })
  }
  for (const [id, row] of Object.entries(seen.rules)) {
    if (!now.has(id)) changes.push({ id, label: row.label, before: row.value, after: null, meaning: null })
  }
  return changes
}
