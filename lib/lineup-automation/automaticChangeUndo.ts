/**
 * UNDO AN AUTOMATIC LINEUP CHANGE (phase 12, 2026-10-29).
 *
 * Every automation that saves a lineup does it through `persistRosterLineupWithEngine` with an
 * `automationAudit` row. That save now also keeps `metadata.undo`: where every player sat BEFORE it
 * (ids and starter slots only — never the player details) and a fingerprint of the lineup it wrote.
 *
 * Undo puts the players back where they were, and only when it is safe:
 *   - the lineup is still exactly what the automation wrote (fingerprint). Anything saved since — by
 *     the owner, the commissioner or another automation — means the undo would throw that away, so it
 *     is refused and the manager sets the lineup themselves;
 *   - the same players are on the team. A lineup undo never adds or drops anyone;
 *   - the save itself still runs every lineup check, so a player whose game has started cannot move.
 *
 * Pure.
 */
import { buildPlayerDataFromSections, getNormalizedLineupSections, type RosterSectionKey } from '@/lib/roster/LineupTemplateValidation'
import { STARTER_SLOT_INDEX_KEY } from '@/lib/league/lineupSlotPositions'

export const UNDO_SECTIONS: readonly RosterSectionKey[] = ['starters', 'bench', 'ir', 'taxi', 'devy']

export type LineupLayout = {
  starters: Array<{ id: string; slot: number | null }>
  bench: string[]
  ir: string[]
  taxi: string[]
  devy: string[]
}

export type AutomaticChangeUndo = { layout: LineupLayout; afterHash: string; season: number; week: number }

/** Where each player sits, by id. */
export function lineupLayout(playerData: unknown): LineupLayout {
  const s = getNormalizedLineupSections(playerData)
  return {
    starters: s.starters.map((p) => {
      const slot = p[STARTER_SLOT_INDEX_KEY]
      return { id: String(p.id), slot: typeof slot === 'number' && Number.isInteger(slot) ? slot : null }
    }),
    bench: s.bench.map((p) => String(p.id)),
    ir: s.ir.map((p) => String(p.id)),
    taxi: s.taxi.map((p) => String(p.id)),
    devy: s.devy.map((p) => String(p.id)),
  }
}

const idsOf = (l: LineupLayout): string[] => [...l.starters.map((p) => p.id), ...l.bench, ...l.ir, ...l.taxi, ...l.devy]

/** A stored undo, or null when the row has none or it is not well formed. */
export function readAutomaticChangeUndo(metadata: unknown): AutomaticChangeUndo | null {
  const m = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : null
  const u = m?.undo && typeof m.undo === 'object' ? (m.undo as Record<string, unknown>) : null
  if (!u || typeof u.afterHash !== 'string' || typeof u.season !== 'number' || typeof u.week !== 'number') return null
  const l = u.layout && typeof u.layout === 'object' ? (u.layout as Record<string, unknown>) : null
  if (!l) return null
  const strs = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null)
  const starters = Array.isArray(l.starters)
    ? l.starters.map((p) => {
        const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : null
        return o && typeof o.id === 'string' ? { id: o.id, slot: typeof o.slot === 'number' ? o.slot : null } : null
      })
    : null
  const bench = strs(l.bench)
  const ir = strs(l.ir)
  const taxi = strs(l.taxi)
  const devy = strs(l.devy)
  if (!starters || starters.some((p) => p === null) || !bench || !ir || !taxi || !devy) return null
  return { layout: { starters: starters as LineupLayout['starters'], bench, ir, taxi, devy }, afterHash: u.afterHash, season: u.season, week: u.week }
}

export type RestoreResult = { ok: true; nextPlayerData: Record<string, unknown> } | { ok: false; reason: 'players_changed' | 'nothing_to_undo' }

/**
 * The current lineup with every player put back where `layout` had them. Player details come from the
 * CURRENT lineup (so an injury status updated since is kept); only placement is restored.
 */
export function restoreLineupLayout(currentPlayerData: unknown, layout: LineupLayout): RestoreResult {
  const current = getNormalizedLineupSections(currentPlayerData)
  const rows = new Map<string, Record<string, unknown>>()
  for (const key of UNDO_SECTIONS) for (const p of current[key]) rows.set(String(p.id), p)

  const wanted = idsOf(layout)
  if (new Set(wanted).size !== wanted.length || wanted.length !== rows.size || wanted.some((id) => !rows.has(id))) {
    return { ok: false, reason: 'players_changed' }
  }
  const bare = (id: string) => {
    const { [STARTER_SLOT_INDEX_KEY]: _drop, ...rest } = rows.get(id)!
    return rest
  }
  const sections: Record<RosterSectionKey, Array<Record<string, unknown>>> = {
    starters: layout.starters.map((p) => (p.slot === null ? bare(p.id) : { ...bare(p.id), [STARTER_SLOT_INDEX_KEY]: p.slot })),
    bench: layout.bench.map(bare),
    ir: layout.ir.map(bare),
    taxi: layout.taxi.map(bare),
    devy: layout.devy.map(bare),
  }
  const sameAsNow = JSON.stringify(lineupLayout(currentPlayerData)) === JSON.stringify(layout)
  if (sameAsNow) return { ok: false, reason: 'nothing_to_undo' }
  return { ok: true, nextPlayerData: buildPlayerDataFromSections(currentPlayerData, sections) }
}
