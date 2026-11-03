/**
 * The "forced bench" disadvantage (reward type `forced_bench`, survivorRewardModel.ts): one of a chosen
 * opponent's players may not start in the reward's week. SURVIVOR LEAGUES ONLY — every caller checks
 * `League.survivorMode` before it ever imports this module, so no other league runs a line of it.
 *
 * Enforced in three places, all keyed on the League `Roster` id (the reward ledger's id space):
 *  1. the lineup saves refuse to start the player that week (`forcedBenchSaveRefusal`, called from
 *     lib/roster-lineup-engine/lineupService.ts persistRosterLineupWithEngine and the
 *     app/api/redraft/roster PATCH) — a commissioner override is never refused;
 *  2. Chimmy's lineup setter (lib/inactive-manager/inactiveManagerService.ts) treats the player as
 *     unavailable, so it never builds a lineup the save would refuse;
 *  3. the Survivor weekly score (lib/survivor/gameStateMachine.ts sumRedraftStartersFantasy) ignores the
 *     player's points from a starting slot that week, if they slipped in anyway — Survivor's own total
 *     only, never the base league's matchup score.
 * A read error fails OPEN (the save goes through, loudly): scoring still ignores the player.
 */

import type { SurvivorRewardRecord } from './survivorRewardModel'
import { getNormalizedLineupSections, type RosterSectionKey } from '@/lib/roster/LineupTemplateValidation'

/** The players benched for `rosterId` in `week` by an applied (not reversed) forced bench. Pure. */
export function activeForcedBench(rewards: readonly Pick<SurvivorRewardRecord, 'spec' | 'status' | 'applyWeek'>[], rosterId: string, week: number): Set<string> {
  const out = new Set<string>()
  for (const r of rewards) {
    if (r.spec.type !== 'forced_bench' || r.status !== 'applied') continue
    if (r.spec.targetRosterId !== rosterId || !r.spec.playerId) continue
    if (r.applyWeek !== week) continue
    out.add(r.spec.playerId)
  }
  return out
}

/** The benched players a lineup tries to start. Pure. */
export function forcedBenchConflicts(starterIds: readonly string[], benched: ReadonlySet<string>): string[] {
  return [...new Set(starterIds.filter((id) => benched.has(id)))]
}

/** The refusal, in the league's language. Pure. */
export function forcedBenchMessage(names: readonly string[], week: number, language?: string | null): string {
  const es = String(language ?? '').toLowerCase().startsWith('es')
  const who = names.join(', ')
  return es
    ? `${who} ${names.length === 1 ? 'está' : 'están'} en la banca obligatoria por una desventaja de Survivor y no ${names.length === 1 ? 'puede' : 'pueden'} ser titular${names.length === 1 ? '' : 'es'} en la semana ${week}.`
    : `${who} ${names.length === 1 ? 'is' : 'are'} forced to the bench by a Survivor disadvantage and cannot start in week ${week}.`
}

/** A starter's points, from the score's per-player list, that a forced bench takes away. Pure. */
export function forcedBenchStarterPoints(playerPoints: ReadonlyArray<{ playerId: string; points: number; isStarter: boolean }>, benched: ReadonlySet<string>): number {
  let total = 0
  for (const p of playerPoints) if (p.isStarter && benched.has(p.playerId) && Number.isFinite(p.points)) total += p.points
  return Math.round(total * 100) / 100
}

/** The opponent's first starter (their top starting slot): who a forced bench takes when no player was named. */
export function firstStarterId(playerData: unknown): string | null {
  return lineupIds(playerData, 'starters')[0] ?? null
}

/** Every player id on a `Roster.playerData` (either the flat `starters`/`bench` arrays or `lineup_sections`). */
export function lineupIds(playerData: unknown, only?: RosterSectionKey): string[] {
  // The same reader the lineup save uses (lib/roster/LineupTemplateValidation.ts).
  const sections = getNormalizedLineupSections(playerData)
  const keys = only ? [only] : (Object.keys(sections) as RosterSectionKey[])
  const fromSections = keys.flatMap((k) => sections[k].map((row) => String(row.id ?? '').trim())).filter(Boolean)
  if (fromSections.length) return fromSections
  // Older rosters carry flat `starters` / `bench` id arrays only.
  const pd = playerData && typeof playerData === 'object' && !Array.isArray(playerData) ? (playerData as Record<string, unknown>) : {}
  const flatKeys = only ? [only] : ['starters', 'bench', 'ir', 'taxi']
  return [...new Set(flatKeys.flatMap((k) => (Array.isArray(pd[k]) ? (pd[k] as unknown[]).map((v) => String(v ?? '').trim()).filter(Boolean) : [])))]
}

/** The forced-benched players for one roster and week, from the reward ledger. */
export async function loadForcedBench(leagueId: string, rosterId: string, week: number): Promise<Set<string>> {
  const { listSurvivorRewards } = await import('./survivorRewardEngine')
  return activeForcedBench(await listSurvivorRewards(leagueId), rosterId, week)
}

/**
 * The lineup save's check: null when the lineup may be saved, else the message. `rosterId` is the
 * League Roster id; pass `redraftRosterId` instead from the redraft path and it is mapped. Fails open.
 */
export async function forcedBenchSaveRefusal(args: {
  leagueId: string
  rosterId?: string | null
  redraftRosterId?: string | null
  week: number
  starterIds: readonly string[]
  language?: string | null
  nameOf?: (playerId: string) => string | null | undefined
}): Promise<string | null> {
  try {
    const { prisma } = await import('@/lib/prisma')
    let rosterId = args.rosterId ?? null
    if (!rosterId && args.redraftRosterId) {
      rosterId = (await prisma.roster.findFirst({ where: { leagueId: args.leagueId, redraftRosterId: args.redraftRosterId }, select: { id: true } }))?.id ?? null
    }
    if (!rosterId) return null
    const benched = await loadForcedBench(args.leagueId, rosterId, args.week)
    if (!benched.size) return null
    const conflicts = forcedBenchConflicts(args.starterIds, benched)
    if (!conflicts.length) return null
    const language = args.language !== undefined ? args.language : (await prisma.league.findUnique({ where: { id: args.leagueId }, select: { language: true } }))?.language ?? null
    return forcedBenchMessage(conflicts.map((id) => args.nameOf?.(id) || id), args.week, language)
  } catch (error) {
    console.warn('[survivor-forced-bench] check failed; lineup allowed', { leagueId: args.leagueId, error: error instanceof Error ? error.message : String(error) })
    return null
  }
}
