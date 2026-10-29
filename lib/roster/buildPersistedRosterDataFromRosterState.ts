/**
 * Shared lineup payload builder for `/api/leagues/roster/save` and AI apply-lineup.
 *
 * A STARTER row may carry `slotIndex` — the expanded starter slot he holds (QB, RB1, …, FLEX), so a
 * lineup saved with an empty slot reloads with the hole where it was. Kept only when it is a
 * non-negative integer, and only on starters. See lib/league/lineupSlotPositions.ts.
 */
import { starterSlotIndexOf } from '@/lib/league/lineupSlotPositions'

export type RosterSectionKey = 'starters' | 'bench' | 'ir' | 'taxi' | 'devy'

function toPlayerId(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim() || null
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const id = obj.id ?? obj.player_id
    if (typeof id === 'string' && id.trim()) return id.trim()
  }
  return null
}

function normalizeLineupSection(section: unknown, keepSlotIndex = false): Array<Record<string, unknown>> {
  if (!Array.isArray(section)) return []
  const out: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  for (const item of section) {
    const id = toPlayerId(item)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    out.push({
      id,
      name: String(obj.name ?? obj.full_name ?? id),
      team: String(obj.team ?? obj.team_abbreviation ?? '—'),
      position: String(obj.position ?? 'UTIL').toUpperCase(),
      opponent: String(obj.opponent ?? '—'),
      gameTime: String(obj.gameTime ?? obj.game_time ?? '—'),
      projection: Number(obj.projection ?? 0) || 0,
      actual: obj.actual == null ? null : Number(obj.actual),
      status: String(obj.status ?? obj.injury_status ?? 'healthy').toLowerCase(),
    })
    const slotIndex = keepSlotIndex ? starterSlotIndexOf(obj) : null
    if (slotIndex != null) out[out.length - 1].slotIndex = slotIndex
  }
  return out
}

export function buildPersistedRosterDataFromRosterState(
  rosterState: unknown,
  existingPlayerData: unknown,
): Record<string, unknown> {
  const base =
    existingPlayerData && typeof existingPlayerData === 'object' && !Array.isArray(existingPlayerData)
      ? (existingPlayerData as Record<string, unknown>)
      : {}
  const rawObj =
    rosterState && typeof rosterState === 'object' && !Array.isArray(rosterState)
      ? (rosterState as Record<string, unknown>)
      : {}

  const lineupSections: Record<RosterSectionKey, Array<Record<string, unknown>>> = {
    starters: normalizeLineupSection(rawObj.starters, true),
    bench: normalizeLineupSection(rawObj.bench),
    ir: normalizeLineupSection(rawObj.ir),
    taxi: normalizeLineupSection(rawObj.taxi),
    devy: normalizeLineupSection(rawObj.devy),
  }
  const allIds = [
    ...lineupSections.starters.map((p) => String(p.id)),
    ...lineupSections.bench.map((p) => String(p.id)),
    ...lineupSections.ir.map((p) => String(p.id)),
    ...lineupSections.taxi.map((p) => String(p.id)),
    ...lineupSections.devy.map((p) => String(p.id)),
  ]
  const players = [...new Set(allIds)]

  return {
    ...base,
    players,
    starters: lineupSections.starters.map((p) => p.id),
    reserve: lineupSections.ir.map((p) => p.id),
    taxi: lineupSections.taxi.map((p) => p.id),
    devy: lineupSections.devy.map((p) => p.id),
    lineup_sections: lineupSections,
    lineup_updated_at: new Date().toISOString(),
  }
}

export function weekFromLeagueSettingsForLineup(settings: unknown): number {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 1
  const o = settings as Record<string, unknown>
  const w = o.currentWeek ?? o.current_week ?? o.week
  if (typeof w === 'number' && Number.isFinite(w)) return Math.max(1, w)
  if (typeof w === 'string') {
    const n = parseInt(w, 10)
    return Number.isFinite(n) ? Math.max(1, n) : 1
  }
  return 1
}
