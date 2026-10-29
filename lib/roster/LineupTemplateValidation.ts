import type { RosterTemplateDto } from '@/lib/multi-sport/RosterTemplateService'
import { withoutSlotIndex } from '@/lib/league/lineupSlotPositions'
import { CAMPUS_SECTION, campusStartersAfterSave } from '@/lib/c2c/campusLineup'

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

/** `keepSlotIndex`: only STARTER rows keep a lineup slot position (lib/league/lineupSlotPositions.ts). */
function normalizeLineupSection(section: unknown, keepSlotIndex = false): Array<Record<string, unknown>> {
  if (!Array.isArray(section)) return []
  const out: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  for (const item of section) {
    const id = toPlayerId(item)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const row = {
      ...obj,
      id,
      position: String(obj.position ?? 'UTIL').toUpperCase(),
    }
    out.push(keepSlotIndex ? row : withoutSlotIndex(row))
  }
  return out
}

export function normalizePositionForStarterEligibility(position: string): string {
  const pos = String(position ?? '').trim().toUpperCase()
  if (!pos) return pos
  if (pos === 'GK') return 'GKP'
  if (pos === 'EDGE') return 'DE'
  if (pos === 'OLB' || pos === 'ILB' || pos === 'MLB') return 'LB'
  if (pos === 'SS' || pos === 'FS') return 'S'
  if (pos === 'NT') return 'DT'
  return pos
}

export function getNormalizedLineupSections(
  playerData: unknown
): Record<RosterSectionKey, Array<Record<string, unknown>>> {
  const data =
    playerData && typeof playerData === 'object' && !Array.isArray(playerData)
      ? (playerData as Record<string, unknown>)
      : {}
  const rawSections =
    data.lineup_sections && typeof data.lineup_sections === 'object' && !Array.isArray(data.lineup_sections)
      ? (data.lineup_sections as Record<string, unknown>)
      : {}

  return {
    starters: normalizeLineupSection(rawSections.starters, true),
    bench: normalizeLineupSection(rawSections.bench),
    ir: normalizeLineupSection(rawSections.ir),
    taxi: normalizeLineupSection(rawSections.taxi),
    devy: normalizeLineupSection(rawSections.devy),
  }
}

export function getSlotLimitsFromTemplate(
  template: RosterTemplateDto
): Record<RosterSectionKey, number> {
  return {
    starters: template.slots.reduce((sum, slot) => sum + (slot.starterCount ?? 0), 0),
    bench: template.slots.reduce((sum, slot) => sum + (slot.benchCount ?? 0), 0),
    ir: template.slots.reduce((sum, slot) => sum + (slot.reserveCount ?? 0), 0),
    taxi: template.slots.reduce((sum, slot) => sum + (slot.taxiCount ?? 0), 0),
    devy: template.slots.reduce((sum, slot) => sum + (slot.devyCount ?? 0), 0),
  }
}

function getStarterAllowedSet(template: RosterTemplateDto): Set<string> {
  return new Set(
    template.slots
      .filter((slot) => slot.starterCount > 0)
      .flatMap((slot) => slot.allowedPositions ?? [])
      .map((p) => normalizePositionForStarterEligibility(String(p)))
  )
}

/** Persist lineup_sections + legacy starters/bench fields after AutoCoach or manual edits. */
export function buildPlayerDataFromSections(
  existingPlayerData: unknown,
  sections: Record<RosterSectionKey, Array<Record<string, unknown>>>
): Record<string, unknown> {
  const base =
    existingPlayerData && typeof existingPlayerData === 'object' && !Array.isArray(existingPlayerData)
      ? (existingPlayerData as Record<string, unknown>)
      : {}
  const allIds = [
    ...sections.starters.map((p) => String(p.id)),
    ...sections.bench.map((p) => String(p.id)),
    ...sections.ir.map((p) => String(p.id)),
    ...sections.taxi.map((p) => String(p.id)),
    ...sections.devy.map((p) => String(p.id)),
  ]
  const players = [...new Set(allIds)]
  // A slot position belongs to a starter; a player moved off the lineup does not take one with him.
  const stored: Record<RosterSectionKey, Array<Record<string, unknown>>> = {
    starters: sections.starters,
    bench: sections.bench.map(withoutSlotIndex),
    ir: sections.ir.map(withoutSlotIndex),
    taxi: sections.taxi.map(withoutSlotIndex),
    devy: sections.devy.map(withoutSlotIndex),
  }
  // A C2C team's campus starters (lib/c2c/campusLineup.ts) survive an AutoCoach or manual rebuild.
  const campus = campusStartersAfterSave({ saved: base, devyIds: sections.devy.map((p) => String(p.id)) })
  return {
    ...base,
    players,
    starters: sections.starters.map((p) => p.id),
    reserve: sections.ir.map((p) => p.id),
    taxi: sections.taxi.map((p) => p.id),
    devy: sections.devy.map((p) => p.id),
    lineup_sections: campus.length ? { ...stored, [CAMPUS_SECTION]: campus } : stored,
    lineup_updated_at: new Date().toISOString(),
  }
}

export type TemplateSectionIssue = {
  code: string
  message: string
  section?: RosterSectionKey
  playerId?: string
}

/** Granular issues for roster legality UI and APIs (replaces single-string `validateRosterSectionsAgainstTemplate` internally). */
export function collectTemplateSectionIssues(
  playerData: unknown,
  template: RosterTemplateDto,
): TemplateSectionIssue[] {
  const sections = getNormalizedLineupSections(playerData)
  const slotLimits = getSlotLimitsFromTemplate(template)
  const issues: TemplateSectionIssue[] = []
  for (const section of Object.keys(sections) as RosterSectionKey[]) {
    const max = slotLimits[section]
    if (sections[section].length > max) {
      issues.push({
        code: 'SECTION_OVERFLOW',
        message: `${section.toUpperCase()} has ${sections[section].length} players, max ${max}.`,
        section,
      })
    }
  }
  const starterAllowed = getStarterAllowedSet(template)
  if (starterAllowed.size > 0 && !starterAllowed.has('*')) {
    for (const starter of sections.starters) {
      const normalizedPosition = normalizePositionForStarterEligibility(String(starter.position ?? ''))
      const id = String((starter as Record<string, unknown>).id ?? '')
      if (!normalizedPosition) continue
      if (!starterAllowed.has(normalizedPosition)) {
        issues.push({
          code: 'STARTER_POSITION_INELIGIBLE',
          message: `Starter position ${normalizedPosition} is not eligible for this league template.`,
          section: 'starters',
          playerId: id || undefined,
        })
      }
    }
  }
  const totalMax =
    slotLimits.starters + slotLimits.bench + slotLimits.ir + slotLimits.taxi + slotLimits.devy
  const totalActual =
    sections.starters.length +
    sections.bench.length +
    sections.ir.length +
    sections.taxi.length +
    sections.devy.length
  if (totalMax > 0 && totalActual > totalMax) {
    issues.push({
      code: 'ROSTER_TOTAL_OVER_LIMIT',
      message: `Roster has ${totalActual} players; maximum for this template is ${totalMax}.`,
    })
  }
  return issues
}

export function validateRosterSectionsAgainstTemplate(
  playerData: unknown,
  template: RosterTemplateDto
): string | null {
  const issues = collectTemplateSectionIssues(playerData, template)
  return issues.length ? issues.map((i) => i.message).join(' ') : null
}

export function autoCorrectPlayerDataToTemplate(
  playerData: unknown,
  template: RosterTemplateDto
): { correctedPlayerData: Record<string, unknown>; droppedPlayerIds: string[] } {
  const sections = getNormalizedLineupSections(playerData)
  const limits = getSlotLimitsFromTemplate(template)
  const starterAllowed = getStarterAllowedSet(template)
  const isStarterEligible = (player: Record<string, unknown>): boolean => {
    if (starterAllowed.size === 0 || starterAllowed.has('*')) return true
    const pos = normalizePositionForStarterEligibility(String(player.position ?? ''))
    return Boolean(pos) && starterAllowed.has(pos)
  }

  const eligibleStarters = sections.starters.filter(isStarterEligible)
  const ineligibleStarters = sections.starters.filter((p) => !isStarterEligible(p))

  const nextStarters =
    limits.starters > 0 ? eligibleStarters.slice(0, limits.starters) : []
  const overflowStarters =
    limits.starters > 0 ? eligibleStarters.slice(limits.starters) : eligibleStarters
  const benchPool = [...sections.bench, ...ineligibleStarters, ...overflowStarters]
  const nextBench = limits.bench > 0 ? benchPool.slice(0, limits.bench) : []
  const overflowBench = limits.bench > 0 ? benchPool.slice(limits.bench) : benchPool

  const nextIr = limits.ir > 0 ? sections.ir.slice(0, limits.ir) : []
  const overflowIr = limits.ir > 0 ? sections.ir.slice(limits.ir) : sections.ir
  const nextTaxi = limits.taxi > 0 ? sections.taxi.slice(0, limits.taxi) : []
  const overflowTaxi = limits.taxi > 0 ? sections.taxi.slice(limits.taxi) : sections.taxi
  const nextDevy = limits.devy > 0 ? sections.devy.slice(0, limits.devy) : []
  const overflowDevy = limits.devy > 0 ? sections.devy.slice(limits.devy) : sections.devy

  const droppedPlayerIds = [
    ...overflowBench.map((p) => String(p.id ?? '')),
    ...overflowIr.map((p) => String(p.id ?? '')),
    ...overflowTaxi.map((p) => String(p.id ?? '')),
    ...overflowDevy.map((p) => String(p.id ?? '')),
  ].filter(Boolean)

  const correctedSections: Record<RosterSectionKey, Array<Record<string, unknown>>> = {
    starters: nextStarters,
    bench: nextBench,
    ir: nextIr,
    taxi: nextTaxi,
    devy: nextDevy,
  }
  return {
    correctedPlayerData: buildPlayerDataFromSections(playerData, correctedSections),
    droppedPlayerIds: [...new Set(droppedPlayerIds)],
  }
}
