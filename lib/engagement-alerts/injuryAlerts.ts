import 'server-only'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { resolvePlayerNewsIdentity, resolvePlayerNewsRecipients, FINISHED_SEASON_STATUSES, type ResolvedPlayerIdentity } from '@/lib/notifications/playerNewsRecipients'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'

export const isUnavailableStatus = (status: string) => /^(out|ir|injured reserve|inactive|suspended|out for season|ruled out)$/i.test(status.trim())
export function importedPlayerIsStarting(data: unknown, playerId: string): boolean {
  const normalized = getNormalizedLineupSections(data).starters
  if (normalized.length) return normalized.some(p => String(p.id) === playerId)
  const list = (data as { starters?: unknown })?.starters
  return Array.isArray(list) && list.some(p => String(typeof p === 'object' && p ? p.id ?? p.playerId ?? p.player_id : p) === playerId)
}

async function startingLeagues(identity: ResolvedPlayerIdentity, userId: string, leagueIds: string[]): Promise<string[]> {
  const ids = [identity.sleeperId, identity.cfbdId, identity.fantraxId].filter((id): id is string => !!id)
  const [native, imported, profile] = await Promise.all([
    prisma.redraftRosterPlayer.findMany({ where: { sport: { equals: identity.sport, mode: 'insensitive' }, playerId: { in: ids }, droppedAt: null,
      NOT: { slotType: { in: ['bench', 'BENCH', 'Bench', 'ir', 'IR', 'taxi', 'TAXI', 'devy', 'DEVY', 'pro_bench', 'pro_ir', 'college', 'free_agent'] } },
      roster: { ownerId: userId, leagueId: { in: leagueIds }, season: { status: { notIn: [...FINISHED_SEASON_STATUSES] } } } },
      select: { roster: { select: { leagueId: true } } } }),
    prisma.roster.findMany({ where: { leagueId: { in: leagueIds } }, select: { leagueId: true, platformUserId: true, playerData: true,
      redraftRoster: { select: { ownerId: true } }, league: { select: { platform: true, teams: { select: { platformUserId: true, claimedByUserId: true } } } } } }),
    prisma.userProfile.findUnique({ where: { userId }, select: { sleeperUserId: true } }),
  ])
  const leagues = new Set(native.map(r => r.roster.leagueId))
  for (const roster of imported) {
    const owns = roster.platformUserId === userId || roster.redraftRoster?.ownerId === userId ||
      !!profile?.sleeperUserId && roster.platformUserId === profile.sleeperUserId ||
      roster.league.teams.some(t => t.platformUserId === roster.platformUserId && t.claimedByUserId === userId)
    if (!owns) continue
    const platform = roster.league.platform.toLowerCase()
    const id = platform === 'sleeper' ? identity.sleeperId : platform === 'espn' ? identity.espnId :
      platform === 'fantrax' ? identity.fantraxId : platform === 'mfl' ? identity.mflId : platform === 'fleaflicker' ? identity.fleaflickerId : null
    if (id && importedPlayerIsStarting(roster.playerData, id)) leagues.add(roster.leagueId)
  }
  return [...leagues]
}

/** Run after a successful injury sync, including unchanged rows so failed sends can retry. */
export async function notifySyncedInjuries(sport: string, now = new Date()): Promise<{ delivered: number; errors: number }> {
  const rows = await prisma.sportsInjury.findMany({ where: { sport, expiresAt: { gt: now }, fetchedAt: { gte: new Date(now.getTime() - 10 * 60_000) } }, orderBy: { fetchedAt: 'desc' } })
  // A refreshed snapshot is not a new injury. Prefer the newest provider event
  // per player and never bootstrap old reports into a notification flood.
  rows.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
  const seen = new Set<string>()
  const seenPlayers = new Set<string>()
  let delivered = 0
  let errors = 0
  for (const row of rows) {
    if (!row.status) continue
    try {
      const resolved = await resolvePlayerNewsIdentity({ sport, playerName: row.playerName, team: row.team })
      if (resolved.status !== 'resolved') continue
      const identity = resolved.identity
      if (seenPlayers.has(identity.identityId)) continue
      seenPlayers.add(identity.identityId)
      const status = row.status.trim().toLowerCase()
      const occurredAt = row.date?.getTime()
      // Undated feeds need an observed status transition, not first-snapshot fanout.
      const stateKey = `injury-observation:v1:${sport}:${identity.identityId}:${row.source}`
      if (!occurredAt) {
        const previous = await prisma.sportsDataCache.findUnique({ where: { cacheKey: stateKey } })
        const previousStatus = (previous?.data as { status?: string } | null)?.status
        if (!previousStatus || previousStatus === status) {
          await prisma.sportsDataCache.upsert({ where: { cacheKey: stateKey }, update: { data: { status } },
            create: { cacheKey: stateKey, data: { status }, expiresAt: new Date(now.getTime() + 30 * 86400_000) } })
          continue
        }
      } else if (occurredAt < now.getTime() - 2 * 3600_000 || occurredAt > now.getTime() + 5 * 60_000) continue
      const date = row.date?.toISOString().slice(0, 10) ?? now.toISOString().slice(0, 10)
      const key = createHash('sha256').update(`${sport}:${identity.identityId}:${status}:${date}`).digest('hex')
      if (seen.has(key)) continue
      seen.add(key)
      const audience = await resolvePlayerNewsRecipients(identity)
      if (audience.degraded) errors++
      let dispatchFailed = false
      for (const [userId, leagueIds] of audience.byUser) {
        const starters = isUnavailableStatus(status) ? await startingLeagues(identity, userId, leagueIds) : []
        // One actionable alert replaces the general injury alert for a starting player.
        const lineup = starters.length > 0
        const sourceKey = `injury:${key}:${lineup ? 'lineup' : 'update'}:${userId}`
        const result = await dispatchNotification({ userIds: [userId], leagueIds: lineup ? starters : leagueIds,
          category: lineup ? 'lineup_alerts' : 'injury_alerts', type: lineup ? 'injured_starter' : 'injury_update',
          title: lineup ? `${row.playerName} is ${status} but still in your starting lineup` : `${row.playerName}: ${status}`,
          body: lineup ? 'Review your lineup and available replacements. Players already locked may not be moved.' : row.description ?? `${row.playerName} (${row.team ?? sport}) — ${status}.`,
          actionHref: `/league/${encodeURIComponent((lineup ? starters : leagueIds)[0])}?tab=team`,
          actionLabel: lineup ? 'Review lineup' : 'View league', severity: isUnavailableStatus(status) ? 'high' : 'medium',
          dedupePrefix: sourceKey.slice(0, -(userId.length + 1)), skipChannels: { sms: true },
          meta: { sport, playerId: identity.identityId, playerName: row.playerName, status, source: row.source, eventKey: key, pushTag: sourceKey },
        })
        delivered += result.delivered
        errors += result.failed
        dispatchFailed ||= result.failed > 0
      }
      if (!occurredAt && !dispatchFailed && !audience.degraded) {
        await prisma.sportsDataCache.upsert({ where: { cacheKey: stateKey }, update: { data: { status } },
          create: { cacheKey: stateKey, data: { status }, expiresAt: new Date(now.getTime() + 30 * 86400_000) } })
      }
    } catch (e) { errors++; console.error('[injury-alerts]', sport, row.externalId, e) }
  }
  return { delivered, errors }
}
