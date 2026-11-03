import 'server-only'

import { prisma } from '@/lib/prisma'
import { proTeamCode } from './proFantraxIdentityPlan'

type SleeperRow = { sleeperId: string | null; name: string; position: string | null; team: string | null; dob: string | null }
type RiRow = { externalId: string; name: string; position: string | null; team: string | null; dob: string | null }
type IdentityRow = { id: string; rollingInsightsId: string | null; sleeperNbaId: string | null; canonicalName: string; position: string | null; dob: string | null }

export type NbaReconciliationPlan = {
  links: Array<{ identityId: string; sleeperId: string; evidence: 'name_position_team' | 'dob_position_team' }>
  reasons: Record<string, number>
}

const key = (value: string | null | undefined) => String(value ?? '').trim().toLowerCase()
const team = (value: string | null | undefined) => proTeamCode('NBA', value) ?? null

/** A plan is computed from one consistent read. No name-only or team-only link is ever proposed. */
export function planSleeperNbaReconciliation(
  sleeperRows: readonly SleeperRow[],
  riRows: readonly RiRow[],
  identities: readonly IdentityRow[],
): NbaReconciliationPlan {
  const reasons: Record<string, number> = {}
  const count = (reason: string) => { reasons[reason] = (reasons[reason] ?? 0) + 1 }
  const byRi = new Map<string, IdentityRow[]>()
  const ownedSleeperIds = new Set<string>()
  for (const row of identities) {
    if (row.rollingInsightsId) byRi.set(row.rollingInsightsId, [...(byRi.get(row.rollingInsightsId) ?? []), row])
    if (row.sleeperNbaId) ownedSleeperIds.add(row.sleeperNbaId)
  }
  const sourceCounts = new Map<string, number>()
  for (const row of sleeperRows) if (row.sleeperId) sourceCounts.set(row.sleeperId, (sourceCounts.get(row.sleeperId) ?? 0) + 1)

  const tentative: NbaReconciliationPlan['links'] = []
  for (const sleeper of sleeperRows) {
    const sleeperId = sleeper.sleeperId?.trim()
    if (!sleeperId) { count('missing_sleeper_id'); continue }
    if ((sourceCounts.get(sleeperId) ?? 0) !== 1) { count('duplicate_source_id'); continue }
    if (ownedSleeperIds.has(sleeperId)) { count('already_linked'); continue }
    const sourceTeam = team(sleeper.team)
    if (!sourceTeam || !sleeper.position || !sleeper.name) { count('missing_match_evidence'); continue }
    const candidates = riRows.flatMap((ri) => {
      if (team(ri.team) !== sourceTeam || key(ri.position) !== key(sleeper.position)) return []
      const matches = byRi.get(ri.externalId) ?? []
      if (matches.length !== 1) return []
      const identity = matches[0]
      if (identity.sleeperNbaId || key(identity.position) !== key(ri.position) || key(identity.canonicalName) !== key(ri.name)) return []
      const exactName = key(sleeper.name) === key(ri.name)
      const sameDob = Boolean(sleeper.dob && identity.dob && ri.dob && sleeper.dob === identity.dob && sleeper.dob === ri.dob)
      return exactName || sameDob ? [{ identityId: identity.id, sleeperId, evidence: exactName ? 'name_position_team' as const : 'dob_position_team' as const }] : []
    })
    if (candidates.length === 0) { count('no_verified_candidate'); continue }
    if (candidates.length !== 1) { count('ambiguous_candidate'); continue }
    tentative.push(candidates[0])
  }

  const targetCounts = new Map<string, number>()
  for (const link of tentative) targetCounts.set(link.identityId, (targetCounts.get(link.identityId) ?? 0) + 1)
  const links = tentative.filter((link) => {
    if (targetCounts.get(link.identityId) === 1) return true
    count('duplicate_target')
    return false
  })
  reasons.proposed = links.length
  return { links, reasons }
}

/** Repeatable, bounded reconciliation after the NBA Sleeper and RI source rows have refreshed. */
export async function reconcileSleeperNbaIdentities(args: { isExhausted?: () => boolean; limit?: number } = {}) {
  const [sleeperRows, riRows, identities] = await Promise.all([
    prisma.sportsPlayer.findMany({ where: { sport: 'NBA', source: 'sleeper' }, select: { sleeperId: true, name: true, position: true, team: true, dob: true } }),
    prisma.sportsPlayer.findMany({ where: { sport: 'NBA', source: 'rolling_insights' }, select: { externalId: true, name: true, position: true, team: true, dob: true } }),
    prisma.playerIdentityMap.findMany({ where: { sport: 'NBA' }, select: { id: true, rollingInsightsId: true, sleeperNbaId: true, canonicalName: true, position: true, dob: true } }),
  ])
  const plan = planSleeperNbaReconciliation(sleeperRows, riRows, identities)
  let linked = 0
  let errors = 0
  const limit = Math.max(1, args.limit ?? 600)
  for (const proposal of plan.links.slice(0, limit)) {
    if (args.isExhausted?.()) break
    try {
      const result = await prisma.playerIdentityMap.updateMany({
        where: { id: proposal.identityId, sport: 'NBA', sleeperNbaId: null },
        data: { sleeperNbaId: proposal.sleeperId },
      })
      linked += result.count
    } catch {
      // A concurrent owner or source update wins; never force a contested identity.
      errors += 1
    }
  }
  return { scanned: sleeperRows.length, proposed: plan.links.length, linked, errors,
    remaining: Math.max(0, plan.links.length - linked), reasons: plan.reasons }
}
