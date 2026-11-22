import { fetchSGNflCatalog } from '@/lib/workers/providers/survivorSleeper'
import 'server-only'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { riFetchRows } from '@/lib/workers/providers/rollingInsightsRest'
import { syncRollingInsightsTeamsToDb } from '@/lib/sports-data/rollingInsightsTeamsPlayers'
import { backfillIdentityMapForSport } from '@/lib/sports-data/multiSportIdentityMap'
import { normalizePlayerName } from '@/lib/team-abbrev'

const text = (value: unknown): string | null => typeof value === 'string' || typeof value === 'number' ? String(value).trim() || null : null
export type SGProviderSport = 'NFL' | 'NBA'
export type SGCatalogRow = { sport: SGProviderSport; externalId: string; name: string; position: string | null; team: string | null; teamId: string | null; sleeperId: string | null; status: string | null; source: string }
export function sgCatalogRows(sport: SGProviderSport, payload: unknown, source = sport === 'NFL' ? 'sleeper' : 'rolling_insights'): SGCatalogRow[] {
  if (!payload || typeof payload !== 'object') throw Error('Provider catalog is unavailable')
  const out: SGCatalogRow[] = [], sleeper = source === 'sleeper'
  for (const [key, value] of Object.entries(payload)) {
    if (!value || typeof value !== 'object') continue
    const p = value as Record<string, unknown>, team = p.team && typeof p.team === 'object' ? p.team as Record<string, unknown> : null
    const id = sleeper ? text(p.player_id) ?? key : text(p.player_id ?? p.playerId ?? p.player_ID ?? p.id)
    const name = sleeper ? text(p.full_name) ?? text([p.first_name, p.last_name].filter(Boolean).join(' ')) : text(p.player ?? p.name ?? p.full_name)
    if (!id || !name) continue
    out.push({ sport, externalId: sleeper ? `sleeper:${id}` : id, name, position: text(p.position ?? p.pos),
      team: text(p.team_name ?? team?.team ?? team?.name) ?? (team ? null : text(p.team)), teamId: text(p.team_id ?? p.teamId ?? team?.id),
      sleeperId: sleeper ? id : null,
      status: sleeper && p.active === false ? 'Inactive' : text(p.status), source })
  }
  if (!out.length) throw Error('Provider returned an empty player catalog')
  return out
}

/** Server-only daily profile maintenance; the legacy Player table is not a native prerequisite. */
export async function syncSGProviderCatalog(sport: SGProviderSport, now = new Date(), force = false) {
  const key = `sg:provider-catalog:v2:${sport}`, previous = await prisma.sportsDataCache.findUnique({ where: { cacheKey: key } })
  if (!force && previous && previous.expiresAt > now) return { skipped: true, players: 0 }
  const teams = await syncRollingInsightsTeamsToDb({ sport, now, deadlineAt: Date.now() + 45_000 })
  if (teams.errors.length || !teams.written) throw Error('Team catalog could not be refreshed')
  let payload: unknown
  if (sport === 'NFL') {
    payload = await fetchSGNflCatalog()
  } else {
    const result = await riFetchRows('player_info', { sport, timeoutMs: 30_000 })
    if (result.error || result.notModified || result.unsupported) throw Error('NBA player catalog could not be refreshed')
    payload = result.rows
  }
  const profiles = sgCatalogRows(sport, payload)
  if (sport === 'NFL') {
    const result = await riFetchRows('player_info', { sport, timeoutMs: 30_000 })
    if (result.error || result.notModified || result.unsupported) throw Error('NFL current-player verification catalog could not be refreshed')
    profiles.push(...sgCatalogRows(sport, result.rows, 'rolling_insights'))
  }
  const expiresAt = new Date(now.getTime() + 7 * 86400_000)
  for (let index = 0; index < profiles.length; index += 500) {
    const rows = profiles.slice(index, index + 500).map(row => ({ ...row, id: randomUUID(), fetchedAt: now, expiresAt }))
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "SportsPlayer" (id,sport,"externalId",name,position,team,"teamId","sleeperId",status,source,"fetchedAt","expiresAt","createdAt","updatedAt")
      SELECT r.id,r.sport,r."externalId",r.name,r.position,r.team,r."teamId",r."sleeperId",r.status,r.source,r."fetchedAt",r."expiresAt",r."fetchedAt",r."fetchedAt"
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(id text,sport text,"externalId" text,name text,position text,team text,"teamId" text,"sleeperId" text,status text,source text,"fetchedAt" timestamptz,"expiresAt" timestamptz)
      ON CONFLICT (sport,"externalId",source) DO UPDATE SET name=EXCLUDED.name,position=EXCLUDED.position,team=EXCLUDED.team,"teamId"=EXCLUDED."teamId",
        "sleeperId"=COALESCE(EXCLUDED."sleeperId","SportsPlayer"."sleeperId"),status=EXCLUDED.status,"fetchedAt"=EXCLUDED."fetchedAt","expiresAt"=EXCLUDED."expiresAt","updatedAt"=EXCLUDED."updatedAt"`)
  }
  if (sport === 'NFL') {
    const existing = new Set((await prisma.playerIdentityMap.findMany({ where: { sport, sleeperId: { not: null } }, select: { sleeperId: true } })).map(row => row.sleeperId))
    const missing = profiles.filter(row => row.sleeperId && !existing.has(row.sleeperId))
    for (let i = 0; i < missing.length; i += 500) await prisma.playerIdentityMap.createMany({ data: missing.slice(i, i + 500).map(row => ({
      sport, sleeperId: row.sleeperId, canonicalName: row.name, normalizedName: normalizePlayerName(row.name), position: row.position, currentTeam: row.team, status: row.status, lastSyncedAt: now,
    })), skipDuplicates: true })
  } else {
    const identities = await backfillIdentityMapForSport(sport, { limit: 20_000 })
    if (identities.errors.length || identities.stoppedEarly) throw Error('NBA identity catalog is incomplete')
  }
  const data = { checkedAt: now.toISOString(), players: profiles.length, teams: teams.written }
  await prisma.sportsDataCache.upsert({ where: { cacheKey: key }, create: { cacheKey: key, data, expiresAt: new Date(now.getTime() + 86400_000) }, update: { data, expiresAt: new Date(now.getTime() + 86400_000) } })
  return { skipped: false, players: profiles.length, teams: teams.written }
}
