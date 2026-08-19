import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { EVENT, getPlatformEvents } from '@/lib/events'
import { publishLeagueFanoutEvent } from '@/lib/league-events/publisher'
import { transitionLeagueStateInTransaction } from '@/server/services/leagueLifecycleService'

export type EnterRedraftOffseasonResult = {
  ok: true
  snapshotId: string
  alreadyInOffseason: boolean
} | {
  ok: false
  code: 'SEASON_NOT_FOUND' | 'SEASON_NOT_COMPLETE' | 'LEAGUE_NOT_COMPLETED'
}

/**
 * Creates the immutable season-summary boundary and enters offseason. The existing
 * LeagueSeason schema preserves standings, roster composition, manager/franchise
 * display values, scoring format, and completion status. Rich transaction and
 * bracket history remain in their season-scoped source tables until a wider
 * snapshot schema is migrated.
 */
export async function enterRedraftOffseason(
  seasonId: string,
  actorUserId: string,
): Promise<EnterRedraftOffseasonResult> {
  const season = await prisma.redraftSeason.findUnique({
    where: { id: seasonId },
    select: {
      id: true,
      leagueId: true,
      season: true,
      sport: true,
      status: true,
      updatedAt: true,
      rosters: {
        orderBy: [{ wins: 'desc' }, { pointsFor: 'desc' }],
        select: {
          id: true,
          ownerId: true,
          ownerName: true,
          teamName: true,
          avatarUrl: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
          pointsAgainst: true,
          playoffSeed: true,
          players: {
            where: { droppedAt: null },
            orderBy: { addedAt: 'asc' },
            select: { playerId: true, playerName: true, position: true, team: true, slotType: true },
          },
        },
      },
      playoffBracket: { select: { id: true, status: true, structure: true } },
    },
  })
  if (!season) return { ok: false, code: 'SEASON_NOT_FOUND' }
  if (season.status !== 'complete') return { ok: false, code: 'SEASON_NOT_COMPLETE' }

  const league = await prisma.league.findUnique({
    where: { id: season.leagueId },
    select: {
      lifecycleState: true,
      platformLeagueId: true,
      scoring: true,
      isDynasty: true,
      settingsSnapshotVersion: true,
      teams: {
        select: { id: true, claimedByUserId: true, platformUserId: true, teamName: true, ownerName: true },
      },
    },
  })
  if (!league || (league.lifecycleState !== 'completed' && league.lifecycleState !== 'offseason')) {
    return { ok: false, code: 'LEAGUE_NOT_COMPLETED' }
  }

  const existing = await prisma.leagueSeason.findUnique({
    where: { leagueId_season: { leagueId: season.leagueId, season: season.season } },
  })
  if (existing && league.lifecycleState === 'offseason') {
    return { ok: true, snapshotId: existing.id, alreadyInOffseason: true }
  }

  const teamByOwner = new Map<string, (typeof league.teams)[number]>()
  for (const team of league.teams) {
    if (team.claimedByUserId) teamByOwner.set(team.claimedByUserId, team)
    if (team.platformUserId) teamByOwner.set(team.platformUserId, team)
  }
  const records = season.rosters.map((roster, index) => {
    const franchise = teamByOwner.get(roster.ownerId)
    return {
      snapshotVersion: 1,
      seasonId: season.id,
      sport: season.sport,
      settingsVersion: league.settingsSnapshotVersion ?? null,
      franchiseId: franchise?.id ?? null,
      franchiseName: franchise?.teamName ?? roster.teamName ?? roster.ownerName,
      managerUserId: roster.ownerId,
      managerName: roster.ownerName,
      rosterId: roster.id,
      rank: index + 1,
      wins: roster.wins,
      losses: roster.losses,
      ties: roster.ties,
      pointsFor: roster.pointsFor,
      pointsAgainst: roster.pointsAgainst,
      playoffSeed: roster.playoffSeed,
      players: roster.players,
      playoffBracketId: season.playoffBracket?.id ?? null,
      playoffBracketStatus: season.playoffBracket?.status ?? null,
      completedAt: season.updatedAt.toISOString(),
    }
  })
  const champion = records[0]
  const runnerUp = records[1]

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    let snapshot = existing
    let created = false
    if (!snapshot) {
      snapshot = await tx.leagueSeason.create({
        data: {
          leagueId: season.leagueId,
          season: season.season,
          platformLeagueId: league.platformLeagueId,
          status: 'complete',
          championTeamId: champion?.franchiseId ?? null,
          championName: champion?.franchiseName ?? null,
          runnerUpName: runnerUp?.franchiseName ?? null,
          regularSeasonWinnerName: champion?.franchiseName ?? null,
          teamRecords: records as unknown as Prisma.InputJsonValue,
          teamCount: records.length,
          scoringFormat: league.scoring,
          isDynasty: league.isDynasty,
        },
      })
      created = true

      // Phase 0 rank fix companion: `FranchiseSeason` (the table
      // `getNativeLeagueRankRows` reads for the career-rank calc) has never
      // been written anywhere in the codebase — native leagues silently
      // scored 0 toward rank. Write it here, from the SAME `records`/
      // `champion`/`runnerUp` this function already computed for
      // `LeagueSeason.teamRecords`, so the two models never disagree about
      // who the champion was. `madePlayoffs` is derived the same way the
      // legacy rank engine (`computeAndSaveRank.ts`) already does — a real
      // playoff seed assigned. Known limitation: only newly-completed
      // seasons from this point forward get a row; already-offseason
      // seasons short-circuit above (line ~83) before reaching this
      // transaction, so a real backfill for those is a separate, disclosed
      // follow-up, not attempted here.
      for (const record of records) {
        if (!record.rosterId) continue
        await tx.franchiseSeason.upsert({
          where: { leagueId_rosterId_season: { leagueId: season.leagueId, rosterId: record.rosterId, season: season.season } },
          update: {
            userId: record.managerUserId ?? null,
            wins: record.wins,
            losses: record.losses,
            ties: record.ties,
            pointsFor: record.pointsFor,
            pointsAgainst: record.pointsAgainst,
            madePlayoffs: record.playoffSeed != null && record.playoffSeed > 0,
            wonChampionship: record.rosterId === champion?.rosterId,
            runnerUp: record.rosterId === runnerUp?.rosterId,
            finalRank: record.rank,
          },
          create: {
            leagueId: season.leagueId,
            rosterId: record.rosterId,
            userId: record.managerUserId ?? null,
            season: season.season,
            wins: record.wins,
            losses: record.losses,
            ties: record.ties,
            pointsFor: record.pointsFor,
            pointsAgainst: record.pointsAgainst,
            madePlayoffs: record.playoffSeed != null && record.playoffSeed > 0,
            wonChampionship: record.rosterId === champion?.rosterId,
            runnerUp: record.rosterId === runnerUp?.rosterId,
            finalRank: record.rank,
          },
        })
      }

      await tx.leagueAuditLog.create({
        data: {
          leagueId: season.leagueId,
          userId: actorUserId,
          actionType: 'season_snapshot_created',
          entityType: 'league_season',
          entityId: snapshot.id,
          afterState: { seasonId, season: season.season, snapshotId: snapshot.id },
          metadata: { idempotencyKey: `season-snapshot:${seasonId}`, source: 'engine:redraft-offseason' },
        },
      })
      await getPlatformEvents().emitInTx(tx, EVENT.SEASON_SNAPSHOT_CREATED, {
        leagueId: season.leagueId,
        seasonId,
        actor: { type: 'commissioner', id: actorUserId },
        idempotencyKey: `season-snapshot:${seasonId}`,
        source: 'engine:redraft-offseason',
        subjects: [{ kind: 'season_snapshot', id: snapshot.id }],
        payload: { seasonId, snapshotId: snapshot.id },
      })
    }

    if (league.lifecycleState === 'completed') {
      await transitionLeagueStateInTransaction(tx, {
        leagueId: season.leagueId,
        nextState: 'offseason',
        actorUserId,
        source: 'engine:redraft-offseason',
        idempotencyKey: `offseason-enter:${seasonId}`,
        metadata: { seasonId, snapshotId: snapshot.id },
      })
      await getPlatformEvents().emitInTx(tx, EVENT.LEAGUE_ENTERED_OFFSEASON, {
        leagueId: season.leagueId,
        seasonId,
        actor: { type: 'commissioner', id: actorUserId },
        idempotencyKey: `league-offseason:${seasonId}`,
        source: 'engine:redraft-offseason',
        subjects: [{ kind: 'season_snapshot', id: snapshot.id }],
        payload: { seasonId, snapshotId: snapshot.id },
      })
    }
    return { snapshot, created }
  })

  await publishLeagueFanoutEvent({
    leagueId: season.leagueId,
    eventType: 'league_entered_offseason',
    title: 'League entered offseason',
    message: 'The season is complete and the league has entered the offseason. Renewal and next-season planning are now available.',
    category: 'league_announcements',
    visibility: 'all_members',
    actorUserId,
    meta: { seasonId, snapshotId: result.snapshot.id },
    dedupeKey: `offseason-enter:${seasonId}`,
    actionHref: `/league/${season.leagueId}?tab=standings`,
    actionLabel: 'View season history',
  })

  return { ok: true, snapshotId: result.snapshot.id, alreadyInOffseason: !result.created }
}