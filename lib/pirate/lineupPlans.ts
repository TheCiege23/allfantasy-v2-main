import { cannotStart, normalizeToken } from '@/lib/redraft/lineupValidation'
import type { ResolvedRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { evaluatePirateLineup, pirateActivationSection, type PirateLineupPlan, type PirateLineupPlayer } from './lineupLegality'

/** Small, bounded search. Exhaustion means incomplete evidence, never "no replacement". */
export async function searchPirateLineupPlan(input: {
  sport: string; week: number; eventAt: string; rosterConfig: ResolvedRosterConfig
  roster: PirateLineupPlayer[]; waivers: PirateLineupPlayer[]; activeCount: number; activeLimit: number
  certify: (plan: PirateLineupPlan) => Promise<boolean>; now: () => Date
}): Promise<PirateLineupPlan | null> {
  const active = (p: PirateLineupPlayer) => !cannotStart(p) && p.byeWeek !== input.week && p.hasGameOnScoringDay !== false
  const promotions = input.roster.filter((p) => pirateActivationSection(p.slotType) &&
    p.activationBeforeLock && !p.lockedAtSnapshot && active(p)).slice(0, 8)
  const pool = input.waivers.filter((p) => p.addableBeforeLock && active(p)).slice(0, 24)
  type State = { steps: PirateLineupPlan['steps']; added: PirateLineupPlayer[]; removed: string[]; promoted: string[]; count: number }
  const queue: State[] = [{ steps: [], added: [], removed: [], promoted: [], count: input.activeCount }]
  const seen = new Set<string>()
  let visited = 0, checked = 0
  while (queue.length && ++visited <= 128) {
    const state = queue.pop()!
    const stateKey = JSON.stringify([state.added.map((p) => p.playerId).sort(), [...state.removed].sort(), [...state.promoted].sort()])
    if (seen.has(stateKey)) continue
    seen.add(stateKey)
    const roster = input.roster.filter((p) => !state.removed.includes(p.playerId)).map((p) =>
      state.promoted.includes(p.playerId) ? { ...p, slotType: 'BENCH', addableBeforeLock: true } : p)
    const finding = evaluatePirateLineup({ sport: input.sport, week: input.week, rosterConfig: input.rosterConfig,
      roster: [...roster, ...state.added.map((p) => ({ ...p, slotType: 'BENCH' }))], waivers: [],
      lineupAtLockCertified: true, availabilityAtLockCertified: true, waiverPoolCertified: false })
    if (state.steps.length && finding.assignment) {
      const plan = { eventAt: input.eventAt, checkedAt: input.now().toISOString(), steps: state.steps, assignment: finding.assignment }
      if (++checked > 12) break
      if (await input.certify(plan)) return { ...plan, checkedAt: input.now().toISOString() }
    }
    if (state.steps.length >= 3) continue
    for (const p of promotions) {
      if (state.promoted.includes(p.playerId) || state.count >= input.activeLimit) continue
      queue.push({ ...state, count: state.count + 1, promoted: [...state.promoted, p.playerId],
        steps: [...state.steps, { kind: 'activate', playerId: p.playerId, fromSlot: p.slotType }] })
    }
    for (const p of pool) {
      // Immediate pickups precede the single final lineup save that activates reserves.
      if (state.promoted.length) break
      if (state.added.some((a) => a.playerId === p.playerId)) continue
      const drops: Array<string | null> = state.count < input.activeLimit ? [null] : roster.filter((r) =>
        normalizeToken(r.slotType) === 'BENCH' && !r.lockedAtSnapshot && r.addableBeforeLock &&
        !state.promoted.includes(r.playerId)).map((r) => r.playerId)
      for (const dropPlayerId of drops) {
        queue.push({ ...state, count: state.count + (dropPlayerId ? 0 : 1), added: [...state.added, p],
          removed: dropPlayerId ? [...state.removed, dropPlayerId] : state.removed,
          steps: [...state.steps, { kind: 'pickup', playerId: p.playerId, dropPlayerId }] })
        // Bound memory as well as work; unsearched paths stay for commissioner review.
        if (queue.length >= 128) break
      }
      if (queue.length >= 128) break
    }
  }
  return null
}

/** Build a hypothetical bulk lineup save, retaining all untouched reserve players and metadata. */
export function piratePlanPlayerData(original: unknown, players: PirateLineupPlayer[], plan: PirateLineupPlan,
  slotTokens: string[]): Record<string, unknown> | null {
  const source = original && typeof original === 'object' && !Array.isArray(original) ? original as Record<string, unknown> : {}
  const sections = getNormalizedLineupSections(original)
  const rows = new Map(Object.values(sections).flat().map((p) => [String(p.id), p]))
  const dropped = new Set(plan.steps.flatMap((s) => s.dropPlayerId ? [s.dropPlayerId] : []))
  const promoted = new Set(plan.steps.filter((s) => s.kind === 'activate').map((s) => s.playerId))
  const starters = new Map(plan.assignment.map((p) => [p.playerId, p]))
  const next: Record<string, Array<Record<string, unknown>>> = { starters: [], bench: [], ir: [], taxi: [], devy: [] }
  const usedIndices = new Set<number>()
  for (const p of players) {
    if (dropped.has(p.playerId)) continue
    const { slotIndex: _oldIndex, ...row } = rows.get(p.playerId) ?? {}
    const data = { ...row, id: p.playerId, name: p.playerName, position: p.position }
    const starter = starters.get(p.playerId)
    if (starter) {
      // Evidence matching groups equivalent slots. Map them to the actual screen's layout.
      const index = p.lockedAtSnapshot && p.starterSlotIndex != null ? p.starterSlotIndex
        : slotTokens.findIndex((s, i) => s === starter.slotType && !usedIndices.has(i))
      if (index < 0 || usedIndices.has(index) || slotTokens[index] !== starter.slotType) return null
      usedIndices.add(index)
      next.starters.push({ ...data, slotIndex: index })
    } else {
      const token = normalizeToken(p.slotType)
      const section = !promoted.has(p.playerId) && pirateActivationSection(token) === 'IR' ? 'ir'
        : !promoted.has(p.playerId) && token === 'TAXI' ? 'taxi' : token === 'DEVY' ? 'devy' : 'bench'
      next[section].push(data)
    }
  }
  if (next.starters.length !== plan.assignment.length) return null
  next.starters.sort((a, b) => Number(a.slotIndex) - Number(b.slotIndex))
  return { ...source, players: Object.values(next).flat().map((p) => p.id), starters: next.starters.map((p) => p.id),
    bench: next.bench.map((p) => p.id), ir: next.ir.map((p) => p.id), taxi: next.taxi.map((p) => p.id),
    lineup_sections: next }
}
