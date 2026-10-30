import type { PrismaClient } from '@prisma/client'

type TeamDb = Pick<PrismaClient, 'teamProviderIdentity'>

/** Return only one-to-one ESPN school -> Rolling Insights school IDs. */
export async function bridgeNcaabCampusTeams(db: TeamDb, espnTeamIds: readonly string[]) {
  const ids = [...new Set(espnTeamIds.filter((id) => /^\d+$/.test(id)))]
  const espnRows = ids.length ? await db.teamProviderIdentity.findMany({ where: { provider: 'espn', sportKey: 'NCAAB', providerTeamId: { in: ids }, teamId: { not: null } }, select: { providerTeamId: true, teamId: true } }) : []
  const canonical = [...new Set(espnRows.map((r) => r.teamId).filter((v): v is string => Boolean(v)))]
  const riRows = canonical.length ? await db.teamProviderIdentity.findMany({ where: { provider: 'rolling_insights', sportKey: 'NCAAB', teamId: { in: canonical } }, select: { providerTeamId: true, teamId: true } }) : []
  const answers = new Map<string, Set<string>>()
  const canonicalByEspn = new Map<string, Set<string>>()
  for (const e of espnRows) if (e.teamId) { const seen = canonicalByEspn.get(e.providerTeamId) ?? new Set<string>(); seen.add(e.teamId); canonicalByEspn.set(e.providerTeamId, seen) }
  for (const e of espnRows) for (const r of riRows) if (e.teamId && e.teamId === r.teamId) {
    const targets = answers.get(e.providerTeamId) ?? new Set<string>()
    targets.add(r.providerTeamId)
    answers.set(e.providerTeamId, targets)
  }
  const resolved = new Map<string, string>()
  const unresolved: string[] = []
  for (const id of ids) {
    const candidates = [...(answers.get(id) ?? [])]
    if (candidates.length === 1 && canonicalByEspn.get(id)?.size === 1) resolved.set(id, candidates[0]!)
    else unresolved.push(id)
  }
  const owners = new Map<string, string[]>()
  for (const [espnId, riId] of resolved) owners.set(riId, [...(owners.get(riId) ?? []), espnId])
  for (const duplicates of owners.values()) if (duplicates.length > 1) for (const id of duplicates) { resolved.delete(id); unresolved.push(id) }
  return { resolved, unresolved }
}

/** Resolve schedule school IDs back to exactly one ESPN ID per canonical school. */
export async function bridgeRiNcaabTeams(db: TeamDb, riTeamIds: readonly string[]) {
  const ids = [...new Set(riTeamIds.filter(id => /^\d+$/.test(id)))]
  const riRows = ids.length ? await db.teamProviderIdentity.findMany({ where: { provider: 'rolling_insights', sportKey: 'NCAAB', providerTeamId: { in: ids }, teamId: { not: null } }, select: { providerTeamId: true, teamId: true } }) : []
  const canonical = [...new Set(riRows.map(r => r.teamId).filter((v): v is string => Boolean(v)))]
  const espnRows = canonical.length ? await db.teamProviderIdentity.findMany({ where: { provider: 'espn', sportKey: 'NCAAB', teamId: { in: canonical } }, select: { providerTeamId: true, teamId: true } }) : []
  const canonicalByRi = new Map<string, Set<string>>(), answers = new Map<string, Set<string>>()
  for (const r of riRows) if (r.teamId) { const ids = canonicalByRi.get(r.providerTeamId) ?? new Set<string>(); ids.add(r.teamId); canonicalByRi.set(r.providerTeamId, ids) }
  for (const r of riRows) for (const e of espnRows) if (r.teamId && r.teamId === e.teamId) { const ids = answers.get(r.providerTeamId) ?? new Set<string>(); ids.add(e.providerTeamId); answers.set(r.providerTeamId, ids) }
  const resolved = new Map<string, string>(), unresolved: string[] = []
  for (const id of ids) { const matches = [...(answers.get(id) ?? [])]; if (canonicalByRi.get(id)?.size === 1 && matches.length === 1) resolved.set(id, matches[0]!); else unresolved.push(id) }
  const owners = new Map<string, string[]>()
  for (const [riId, espnId] of resolved) owners.set(espnId, [...(owners.get(espnId) ?? []), riId])
  for (const duplicates of owners.values()) if (duplicates.length > 1) for (const id of duplicates) { resolved.delete(id); unresolved.push(id) }
  return { resolved, unresolved }
}
