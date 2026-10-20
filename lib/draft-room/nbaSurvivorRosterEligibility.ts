import 'server-only'

import { prisma } from '@/lib/prisma'
import { canonicalName } from './player-canonical-identity'

const FRESHNESS_MS = 72 * 60 * 60 * 1000
const ACTIVE_RI = new Set(['ACT', 'QUES'])
const UNAVAILABLE = 'The current NBA roster could not be verified. Refresh player data before drafting.'

export type NbaRosterEvidence = {
  name: string
  source: string
  status: string | null
  team: string | null
  fetchedAt: Date
  expiresAt: Date
  id?: string
  externalId?: string
}

export type NbaRosterEligibility = {
  eligibleNames: Set<string>
  playerIdsByName: Map<string, Set<string>>
  ready: boolean
  reason: string | null
}

/**
 * Rolling Insights keeps historical NBA profiles and refreshes their fetchedAt in bulk.
 * An old player with a team string is therefore not proof of a current roster spot.
 * TheSportsDB's Active designation can rescue a rostered player whose RI injury
 * designation is INACT; an explicit Free Agent/Retired/Coaching designation wins
 * over RI's ACT/QUES when the two disagree.
 */
export function buildNbaRosterEligibility(
  rows: readonly NbaRosterEvidence[],
  requiredPlayers: number,
  now = new Date(),
): NbaRosterEligibility {
  const freshAfter = now.getTime() - FRESHNESS_MS
  const byName = new Map<string, { ri: boolean; tsdbActive: boolean; tsdbExcluded: boolean }>()
  const playerIdsByName = new Map<string, Set<string>>()
  for (const row of rows) {
    if (row.fetchedAt.getTime() < freshAfter || row.expiresAt.getTime() <= now.getTime()) continue
    const name = canonicalName(row.name)
    if (!name || !row.team?.trim()) continue
    const state = byName.get(name) ?? { ri: false, tsdbActive: false, tsdbExcluded: false }
    const ids = playerIdsByName.get(name) ?? new Set<string>()
    if (row.id) ids.add(row.id)
    if (row.externalId) ids.add(row.externalId)
    playerIdsByName.set(name, ids)
    const status = String(row.status ?? '').trim().toUpperCase()
    if (row.source === 'rolling_insights' && ACTIVE_RI.has(status)) state.ri = true
    if (row.source === 'thesportsdb') {
      if (status === 'ACTIVE') state.tsdbActive = true
      if (['FREE AGENT', 'RETIRED', 'COACHING'].includes(status)) state.tsdbExcluded = true
    }
    byName.set(name, state)
  }
  const eligibleNames = new Set<string>()
  for (const [name, state] of byName) {
    if (state.tsdbActive || (state.ri && !state.tsdbExcluded)) eligibleNames.add(name)
  }
  const ready = eligibleNames.size >= requiredPlayers
  return { eligibleNames, playerIdsByName, ready, reason: ready ? null : UNAVAILABLE }
}

export async function loadNbaSurvivorRosterEligibility(requiredPlayers: number): Promise<NbaRosterEligibility> {
  const now = new Date()
  const rows = await prisma.sportsPlayer.findMany({
    where: {
      sport: 'NBA',
      source: { in: ['rolling_insights', 'thesportsdb'] },
      fetchedAt: { gte: new Date(now.getTime() - FRESHNESS_MS) },
      expiresAt: { gt: now },
    },
    select: { id: true, externalId: true, name: true, source: true, status: true, team: true, fetchedAt: true, expiresAt: true },
  })
  return buildNbaRosterEligibility(rows, requiredPlayers, now)
}

export function nbaSurvivorPlayerIsEligible(eligibility: NbaRosterEligibility, name: string): boolean {
  return eligibility.ready && eligibility.eligibleNames.has(canonicalName(name))
}

export function nbaSurvivorPlayerIdMatches(eligibility: NbaRosterEligibility, name: string, playerId: string | null | undefined): boolean {
  const id = String(playerId ?? '').trim()
  return Boolean(id && nbaSurvivorPlayerIsEligible(eligibility, name) && eligibility.playerIdsByName.get(canonicalName(name))?.has(id))
}

/** Current-roster checks also protect ordinary NBA redraft, without removing college/dynasty pools. */
export function shouldVerifyCurrentNbaRoster(input: {
  sport: string; variant?: string | null; isDynasty: boolean; isDevy: boolean; isC2C: boolean; mergeCollegePool: boolean
}): boolean {
  return input.sport === 'NBA' && (input.variant === 'survivor' ||
    (!input.isDynasty && !input.isDevy && !input.isC2C && !input.mergeCollegePool))
}
