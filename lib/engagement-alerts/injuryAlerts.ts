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
  const batches = new Map<string, {
    userId: string; team: string; leagueIds: string[]; lineup: boolean;
    changes: Array<{ playerName: string; status: string; key: string; receiptKey: string }>;
  }>()
  const observations: Array<{ stateKey: string; status: string }> = []
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
      const healthyStatus = /^(active|healthy|available)$/i.test(status)
      if (!occurredAt || healthyStatus) {
        const previous = await prisma.sportsDataCache.findUnique({ where: { cacheKey: stateKey } })
        const previousStatus = (previous?.data as { status?: string } | null)?.status
        const priorInjury = /^(out|ir|injured reserve|inactive|suspended|out for season|ruled out|questionable|doubtful|probable|day.to.day|injured)$/i.test(previousStatus ?? '')
        // A dated healthy snapshot can contain an ordinary game recap. Only a
        // previously observed injury-to-healthy transition is a recovery alert.
        if (!previousStatus || previousStatus === status || (healthyStatus && !priorInjury)) {
          await prisma.sportsDataCache.upsert({ where: { cacheKey: stateKey }, update: { data: { status } },
            create: { cacheKey: stateKey, data: { status }, expiresAt: new Date(now.getTime() + 30 * 86400_000) } })
          continue
        }
      }
      if (occurredAt && (occurredAt < now.getTime() - 2 * 3600_000 || occurredAt > now.getTime() + 5 * 60_000)) continue
      const date = row.date?.toISOString().slice(0, 10) ?? now.toISOString().slice(0, 10)
      const key = createHash('sha256').update(`${sport}:${identity.identityId}:${status}:${date}`).digest('hex')
      if (seen.has(key)) continue
      seen.add(key)
      const audience = await resolvePlayerNewsRecipients(identity)
      if (audience.degraded) errors++
      const team = identity.currentTeam?.trim() || row.team?.trim()
      if (!team) continue
      for (const [userId, leagueIds] of audience.byUser) {
        const starters = isUnavailableStatus(status) ? await startingLeagues(identity, userId, leagueIds) : []
        const lineup = starters.length > 0
        const scopedLeagues = [...(lineup ? starters : leagueIds)].sort()
        const receiptKey = 'injury-team-member:v1:' + key + ':' + (lineup ? 'lineup' : 'update') + ':' + userId
        const receipt = await prisma.sportsDataCache.findUnique({ where: { cacheKey: receiptKey } })
        if ((receipt?.data as { delivered?: boolean } | null)?.delivered) continue
        // Keep league override scopes separate so muted leagues cannot leak player updates.
        const batchKey = JSON.stringify([userId, sport, team.toUpperCase(), lineup, scopedLeagues])
        const batch = batches.get(batchKey) ?? { userId, team, leagueIds: scopedLeagues, lineup, changes: [] }
        batch.changes.push({ playerName: row.playerName, status, key, receiptKey })
        batches.set(batchKey, batch)
      }
      if (!audience.degraded) observations.push({ stateKey, status })
    } catch (e) { errors++; console.error('[injury-alerts]', sport, row.externalId, e) }
  }
  for (const batch of batches.values()) {
    try {
      const changes = batch.changes.sort((a, b) => a.key.localeCompare(b.key))
      const digest = createHash('sha256').update(JSON.stringify([sport, batch.team.toUpperCase(), batch.leagueIds, changes.map(c => c.key)])).digest('hex')
      const sourceKey = 'injury-team:' + digest + ':' + (batch.lineup ? 'lineup' : 'update')
      const result = await dispatchNotification({
        userIds: [batch.userId], leagueIds: batch.leagueIds,
        category: batch.lineup ? 'lineup_alerts' : 'injury_alerts',
        type: batch.lineup ? 'injured_starter' : 'injury_update',
        title: batch.team + ': ' + (batch.lineup ? 'starting lineup injury' : 'injury') + ' update',
        body: changes.map(c => c.playerName + ': ' + c.status).join('\n') +
          (batch.lineup ? '\nReview your lineup and available replacements. Locked players may not be moved.' : ''),
        actionHref: '/league/' + encodeURIComponent(batch.leagueIds[0]) + '?tab=team',
        actionLabel: batch.lineup ? 'Review lineup' : 'View team',
        severity: changes.some(c => isUnavailableStatus(c.status)) ? 'high' : 'medium',
        dedupePrefix: sourceKey, skipChannels: { sms: true },
        meta: { sport, team: batch.team, playerCount: changes.length, eventKey: digest, pushTag: sourceKey },
      })
      delivered += result.delivered
      errors += result.failed
      if (!result.failed) {
        for (const change of changes) {
          await prisma.sportsDataCache.upsert({
            where: { cacheKey: change.receiptKey }, update: { data: { delivered: true } },
            create: { cacheKey: change.receiptKey, data: { delivered: true }, expiresAt: new Date(now.getTime() + 7 * 86400_000) },
          })
        }
      }
    } catch (e) { errors++; console.error('[injury-team-alerts]', sport, batch.team, e) }
  }
  if (!errors) {
    for (const observation of observations) {
      await prisma.sportsDataCache.upsert({
        where: { cacheKey: observation.stateKey }, update: { data: { status: observation.status } },
        create: { cacheKey: observation.stateKey, data: { status: observation.status }, expiresAt: new Date(now.getTime() + 30 * 86400_000) },
      })
    }
  }
  return { delivered, errors }
}
