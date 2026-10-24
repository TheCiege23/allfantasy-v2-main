import 'server-only'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { resolvePlayerNewsIdentity, resolvePlayerNewsRecipients, FINISHED_SEASON_STATUSES, type ResolvedPlayerIdentity } from '@/lib/notifications/playerNewsRecipients'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { planPlayerNews, markPlayerNewsTold, type PlayerNewsSubject } from '@/lib/notifications/playerNewsGate'
import { statusBucket, isMeaningfulStatusChange } from '@/lib/notifications/playerNewsStatus'
import { readOptimizationEnabled } from '@/lib/perf/readOptimizations'

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

/** "🚨 Bijan Robinson is OUT — still in your starting lineup", or a count when several starters are out. */
export function lineupAlertTitle(changes: Array<{ playerName: string; status: string }>): string {
  const label = (status: string) => /ir|injured reserve/i.test(status) ? 'on IR' : /suspend/i.test(status) ? 'SUSPENDED' : /inactive/i.test(status) ? 'INACTIVE' : 'OUT'
  if (changes.length === 1) return `🚨 ${changes[0]!.playerName} is ${label(changes[0]!.status)} — still in your starting lineup`
  return `🚨 ${changes.length} of your starters are out — fix your lineup`
}

/** Run after a successful injury sync, including unchanged rows so failed sends can retry. */
export async function notifySyncedInjuries(sport: string, now = new Date()): Promise<{ delivered: number; errors: number }> {
  const optimized = readOptimizationEnabled('injury-alerts')
  const where = { sport, expiresAt: { gt: now }, fetchedAt: { gte: new Date(now.getTime() - 10 * 60_000) } }
  /*
   * ⚠ THIS RUNS FOR EVERY SPORT EVERY 2 MINUTES, AND THE WINDOW MATCHES NEARLY EVERY ROW, because
   * the importers stamp `fetchedAt` on every row they rewrite. So the read is selected down to the
   * columns used below (no `raw` provider JSON), and the per-row "previous observation" reads are
   * one batched read (see `previousObservations`). `AF_READ_OPTIMIZATIONS_OFF=injury-alerts`
   * restores the full-row read and the per-row lookups.
   */
  const rows = optimized
    ? await prisma.sportsInjury.findMany({ where, orderBy: { fetchedAt: 'desc' },
        select: { externalId: true, playerName: true, team: true, status: true, date: true, source: true } })
    : await prisma.sportsInjury.findMany({ where, orderBy: { fetchedAt: 'desc' } })
  // A refreshed snapshot is not a new injury. Prefer the newest provider event
  // per player and never bootstrap old reports into a notification flood.
  rows.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
  const seen = new Set<string>()
  const seenPlayers = new Set<string>()
  const batches = new Map<string, {
    userId: string; team: string; leagueIds: string[]; lineup: boolean; starter: boolean; route: 'instant' | 'digest';
    changes: Array<{ playerName: string; status: string; key: string; receiptKey: string; subject: PlayerNewsSubject }>;
  }>()
  const observations: Array<{ stateKey: string; status: string }> = []
  let delivered = 0
  let errors = 0
  /*
   * Identities are resolved in the same order and with the same calls as before; doing it first
   * lets every first-seen player's previous observation come back in ONE read instead of one per
   * row. Each state key occurs at most once per run (it embeds the identity, and a repeated
   * identity is skipped), so nothing written later in this run could have changed what that read
   * returns. If the batched read fails, every row falls back to its own lookup, as before.
   */
  const identities = new Map<(typeof rows)[number], Awaited<ReturnType<typeof resolvePlayerNewsIdentity>> | { thrown: unknown }>()
  let previousObservations: Map<string, unknown> | null = null
  if (optimized) {
    const stateKeys: string[] = []
    const firstSeen = new Set<string>()
    for (const row of rows) {
      if (!row.status) continue
      try {
        const resolved = await resolvePlayerNewsIdentity({ sport, playerName: row.playerName, team: row.team })
        identities.set(row, resolved)
        if (resolved.status === 'resolved' && !firstSeen.has(resolved.identity.identityId)) {
          firstSeen.add(resolved.identity.identityId)
          stateKeys.push(`injury-observation:v1:${sport}:${resolved.identity.identityId}:${row.source}`)
        }
      } catch (e) {
        identities.set(row, { thrown: e })
      }
    }
    if (stateKeys.length) {
      previousObservations = await prisma.sportsDataCache
        .findMany({ where: { cacheKey: { in: stateKeys } }, select: { cacheKey: true, data: true } })
        .then((found) => new Map(found.map((r) => [r.cacheKey, r.data] as const)))
        .catch(() => null)
    }
  }
  for (const row of rows) {
    if (!row.status) continue
    try {
      const pre = identities.get(row)
      if (pre && 'thrown' in pre) throw pre.thrown
      const resolved = pre ?? await resolvePlayerNewsIdentity({ sport, playerName: row.playerName, team: row.team })
      if (resolved.status !== 'resolved') continue
      const identity = resolved.identity
      if (seenPlayers.has(identity.identityId)) continue
      seenPlayers.add(identity.identityId)
      const status = row.status.trim().toLowerCase()
      const occurredAt = row.date?.getTime()
      // Undated feeds need an observed status transition, not first-snapshot fanout.
      const stateKey = `injury-observation:v1:${sport}:${identity.identityId}:${row.source}`
      const healthyStatus = /^(active|healthy|available)$/i.test(status)
      const previousData = previousObservations
        ? previousObservations.get(stateKey) ?? null
        : (await prisma.sportsDataCache.findUnique({ where: { cacheKey: stateKey } }))?.data
      const previousStatus = (previousData as { status?: string } | null)?.status
      /*
       * Owner's rule (2026-10-22): only a change that matters. The same status again, a practice
       * report, or anything about a player already on IR other than his return is recorded and not sent.
       */
      if (!isMeaningfulStatusChange(previousStatus ? statusBucket(previousStatus) : null, statusBucket(status))) {
        if (previousStatus !== status) {
          await prisma.sportsDataCache.upsert({ where: { cacheKey: stateKey }, update: { data: { status } },
            create: { cacheKey: stateKey, data: { status }, expiresAt: new Date(now.getTime() + 30 * 86400_000) } })
        }
        continue
      }
      if (!occurredAt || healthyStatus) {
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
      const team = identity.currentTeam?.trim() || row.team?.trim()
      // Without a team nothing below can send (and no observation is recorded), so resolving the
      // audience first only spent the most expensive query in this file for nothing. Its one other
      // effect was that a degraded lookup for such a row counted as a run error.
      if (optimized && !team) continue
      const audience = await resolvePlayerNewsRecipients(identity)
      if (audience.degraded) errors++
      if (!team) continue
      const subject: PlayerNewsSubject = { playerKey: identity.identityId, bucket: statusBucket(status) }
      for (const [userId, leagueIds] of audience.byUser) {
        // Starter for ANY status now, not only OUT: it decides push-now versus the daily digest.
        const starters = await startingLeagues(identity, userId, leagueIds)
        const starter = starters.length > 0
        const lineup = starter && isUnavailableStatus(status)
        const scopedLeagues = [...(starter ? starters : leagueIds)].sort()
        const receiptKey = 'injury-team-member:v1:' + key + ':' + (lineup ? 'lineup' : 'update') + ':' + userId
        const receipt = await prisma.sportsDataCache.findUnique({ where: { cacheKey: receiptKey } })
        if ((receipt?.data as { delivered?: boolean } | null)?.delivered) continue
        // The player-news gate: the person's level, and one alert per player and status a day across senders.
        const plan = await planPlayerNews([userId], subject, () => (starter ? 'starter' : 'rostered'))
        const route = plan.instant.length ? 'instant' : plan.digest.length ? 'digest' : null
        if (!route) continue
        // Keep league override scopes separate so muted leagues cannot leak player updates.
        const batchKey = JSON.stringify([userId, sport, team.toUpperCase(), lineup, starter, route, scopedLeagues])
        const batch = batches.get(batchKey) ?? { userId, team, leagueIds: scopedLeagues, lineup, starter, route, changes: [] }
        batch.changes.push({ playerName: row.playerName, status, key, receiptKey, subject })
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
        title: batch.lineup ? lineupAlertTitle(changes) : batch.team + ': injury update',
        body: changes.map(c => c.playerName + ': ' + c.status).join('\n') +
          (batch.lineup ? '\nStill in your starting lineup' + (batch.leagueIds.length > 1 ? ` in ${batch.leagueIds.length} leagues` : '') +
            '. Swap in a replacement before the game locks.' : ''),
        actionHref: '/league/' + encodeURIComponent(batch.leagueIds[0]) + '?tab=team',
        actionLabel: batch.lineup ? 'Review lineup' : 'View team',
        severity: changes.some(c => isUnavailableStatus(c.status)) ? 'high' : 'medium',
        dedupePrefix: sourceKey,
        // Instant is push + bell; digest is the bell only. Never an email — the daily digest carries it.
        skipChannels: batch.route === 'instant' ? { sms: true, email: true } : { sms: true, email: true, push: true },
        meta: { sport, team: batch.team, playerCount: changes.length, eventKey: digest, pushTag: sourceKey,
          playerNews: { playerName: changes.map(c => c.playerName).join(', '), team: batch.team, status: changes.map(c => c.status).join(', '), starter: batch.starter, delivery: batch.route } },
      })
      delivered += result.delivered
      errors += result.failed
      if (!result.failed) {
        for (const change of changes) await markPlayerNewsTold([batch.userId], change.subject, now)
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
