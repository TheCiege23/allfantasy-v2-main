import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getScoringEligibility } from '@/lib/devy/scoringEligibilityEngine'
import { collectPlayers } from '@/lib/devy/identityMatchingEngine'
import { mergeablePlayer } from '@/lib/devy/importMergeRules'

export type MergeResult = {
  ok: boolean
  playersWritten: number
  seasonsWritten: number
  picksWritten: number
  errors: string[]
}

export type ImportAuditSummary = {
  playersImported: number
  unmatchedPlayers: { id: string; name: string }[]
  conflictsResolved: number
  conflictsPending: number
  managersMatched: number
  managersUnmatched: { id: string; label: string }[]
  historySeasonsImported: number
  picksImported: number
  missingImages: string[]
  missingSchoolLogos: string[]
  dataConfidenceScore: 'high' | 'medium' | 'low'
  notes: string[]
}

export async function executeMerge(sessionId: string, commissionerId: string): Promise<MergeResult> {
  const errors: string[] = []
  const session = await prisma.devyImportSession.findFirst({
    where: { id: sessionId, commissionerId },
    include: { mergeConflicts: true },
  })
  if (!session) {
    return { ok: false, playersWritten: 0, seasonsWritten: 0, picksWritten: 0, errors: ['Session not found'] }
  }

  const pending = session.mergeConflicts.filter(c => c.resolution === 'pending')
  if (pending.length > 0) {
    errors.push(`${pending.length} conflicts still pending`)
    return { ok: false, playersWritten: 0, seasonsWritten: 0, picksWritten: 0, errors }
  }

  const mgrUnmatched = await prisma.devyManagerMapping.count({
    where: { sessionId, requiresReview: true, internalUserId: null },
  })
  if (mgrUnmatched > 0) {
    errors.push('Unmatched managers require review')
    return { ok: false, playersWritten: 0, seasonsWritten: 0, picksWritten: 0, errors }
  }

  const devyCfg = await prisma.devyLeague.findUnique({ where: { leagueId: session.leagueId } })
  if (!devyCfg) {
    errors.push('DevyLeague row missing — create devy config before merge')
    return { ok: false, playersWritten: 0, seasonsWritten: 0, picksWritten: 0, errors }
  }

  const redraftSeason = await prisma.redraftSeason.findFirst({
    where: { leagueId: session.leagueId },
    orderBy: { season: 'desc' },
  })
  if (!redraftSeason) {
    errors.push('No RedraftSeason for league — create a season before merge')
    return { ok: false, playersWritten: 0, seasonsWritten: 0, picksWritten: 0, errors }
  }

  const externalRows = await collectPlayers(sessionId)
  const extKey = new Map<string, (typeof externalRows)[0]>()
  for (const r of externalRows) {
    extKey.set(`${r.externalId}|${r.sourcePlatform}`, r)
  }

  const mappings = await prisma.devyPlayerMapping.findMany({ where: { sessionId } })
  let playersWritten = 0
  const picksWritten = 0

  for (const m of mappings) {
    if (!m.internalPlayerId || !mergeablePlayer(m.isConfirmedByCommissioner, m.matchConfidence, m.requiresReview)) {
      continue
    }

    const row = extKey.get(`${m.externalId}|${m.externalPlatform}`)
    const mgrExternal = row?.managerExternalUserId
    let ownerId: string | null = null
    if (mgrExternal) {
      const mm = await prisma.devyManagerMapping.findFirst({
        where: {
          sessionId,
          OR: [{ externalUsername: mgrExternal }, { externalDisplayName: mgrExternal }],
        },
      })
      ownerId = mm?.internalUserId ?? null
    }
    if (!ownerId) {
      errors.push(`No manager mapping for ${m.externalName} (external roster owner ${mgrExternal ?? 'unknown'})`)
      continue
    }

    const roster = await prisma.redraftRoster.findFirst({
      where: { seasonId: redraftSeason.id, ownerId },
    })
    if (!roster) {
      errors.push(`No redraft roster for owner ${ownerId}`)
      continue
    }

    const p = await prisma.player.findUnique({ where: { id: m.internalPlayerId } })
    if (!p) continue

    const isDevy = m.playerType === 'devy' || p.devyEligible

    if (isDevy) {
      await prisma.$transaction(async tx => {
        await tx.devyDevySlot.upsert({
          where: {
            leagueId_rosterId_playerId: {
              leagueId: session.leagueId,
              rosterId: roster.id,
              playerId: m.internalPlayerId!,
            },
          },
          create: {
            leagueId: session.leagueId,
            rosterId: roster.id,
            playerId: m.internalPlayerId!,
            playerName: p.name,
            position: p.position,
            school: m.externalSchool,
            projectedDeclarationYear: p.projectedDraftRound ?? undefined,
          },
          update: {
            playerName: p.name,
            position: p.position,
            school: m.externalSchool ?? undefined,
          },
        })

        await tx.devyPlayerState.upsert({
          where: {
            leagueId_rosterId_playerId: {
              leagueId: session.leagueId,
              rosterId: roster.id,
              playerId: m.internalPlayerId!,
            },
          },
          create: {
            leagueId: session.leagueId,
            rosterId: roster.id,
            playerId: m.internalPlayerId!,
            playerName: p.name,
            position: p.position,
            playerType: 'devy',
            bucketState: 'devy',
            scoringEligibility: getScoringEligibility('devy', 'devy'),
            school: m.externalSchool,
            isDevyEligible: true,
          },
          update: {
            playerName: p.name,
            bucketState: 'devy',
            scoringEligibility: getScoringEligibility('devy', 'devy'),
          },
        })
      })
      playersWritten++
    } else {
      const existing = await prisma.redraftRosterPlayer.findFirst({
        where: { rosterId: roster.id, playerId: m.internalPlayerId, droppedAt: null },
      })
      if (!existing) {
        await prisma.redraftRosterPlayer.create({
          data: {
            rosterId: roster.id,
            playerId: m.internalPlayerId!,
            playerName: p.name,
            position: p.position,
            team: p.team,
            sport: p.sport,
            slotType: 'bench',
          },
        })
      }

      await prisma.devyPlayerState.upsert({
        where: {
          leagueId_rosterId_playerId: {
            leagueId: session.leagueId,
            rosterId: roster.id,
            playerId: m.internalPlayerId!,
          },
        },
        create: {
          leagueId: session.leagueId,
          rosterId: roster.id,
          playerId: m.internalPlayerId!,
          playerName: p.name,
          position: p.position,
          playerType: 'nfl_veteran',
          bucketState: 'active_bench',
          scoringEligibility: getScoringEligibility('active_bench', 'nfl_veteran'),
        },
        update: {
          playerName: p.name,
          bucketState: 'active_bench',
          scoringEligibility: getScoringEligibility('active_bench', 'nfl_veteran'),
        },
      })
      playersWritten++
    }
  }

  const historyRows = await buildHistoryCreateRows(sessionId, session.leagueId)
  let seasonsWritten = 0
  for (const data of historyRows) {
    await prisma.devyImportedSeason.create({ data })
    seasonsWritten++
  }

  await prisma.devyImportSession.update({
    where: { id: sessionId },
    data: {
      status: 'merged',
      mergedAt: new Date(),
      summary: {
        playersWritten,
        seasonsWritten,
        picksWritten,
        errors,
      } as object,
    },
  })

  return { ok: errors.length === 0, playersWritten, seasonsWritten, picksWritten, errors }
}

async function buildHistoryCreateRows(
  sessionId: string,
  leagueId: string,
): Promise<
  Array<{
    leagueId: string
    sessionId: string
    season: number
    sourceLabel: string
    sourcePlatform: string | null
    standings: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue
    scoringRecords: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue
    titleWinner: string | null
    notes: string | null
    importConfidence: string
  }>
> {
  const sources = await prisma.devyImportSource.findMany({ where: { sessionId } })
  const out: Array<{
    leagueId: string
    sessionId: string
    season: number
    sourceLabel: string
    sourcePlatform: string | null
    standings: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue
    scoringRecords: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue
    titleWinner: string | null
    notes: string | null
    importConfidence: string
  }> = []

  for (const s of sources) {
    const raw = s.rawData as Record<string, unknown> | null
    if (!raw?.league) continue
    const league = raw.league as { season?: string | number }
    const season = typeof league.season === 'number' ? league.season : parseInt(String(league.season ?? ''), 10)
    if (!Number.isFinite(season)) continue
    out.push({
      leagueId,
      sessionId,
      season,
      sourceLabel: `Imported from ${s.sourcePlatform ?? 'source'} (${season})`,
      sourcePlatform: s.sourcePlatform,
      standings: Prisma.JsonNull,
      scoringRecords: Prisma.JsonNull,
      titleWinner: null,
      notes: null,
      importConfidence: 'medium',
    })
  }
  return out
}

export async function generateImportAudit(sessionId: string): Promise<ImportAuditSummary> {
  const mappings = await prisma.devyPlayerMapping.findMany({ where: { sessionId } })
  const managers = await prisma.devyManagerMapping.findMany({ where: { sessionId } })
  const conflicts = await prisma.devyMergeConflict.findMany({ where: { sessionId } })
  const sess = await prisma.devyImportSession.findUnique({ where: { id: sessionId } })

  const unmatchedPlayers = mappings
    .filter(m => !m.internalPlayerId)
    .map(m => ({ id: m.id, name: m.externalName }))

  const managersUnmatched = managers
    .filter(m => !m.internalUserId)
    .map(m => ({ id: m.id, label: m.externalDisplayName }))

  const seasons = await prisma.devyImportedSeason.count({ where: { sessionId } })
  const picks = sess
    ? await prisma.devyDraftPick.count({ where: { leagueId: sess.leagueId } })
    : 0

  const notes: string[] = []
  let dataConfidenceScore: ImportAuditSummary['dataConfidenceScore'] = 'high'
  if (unmatchedPlayers.length > 0) {
    dataConfidenceScore = 'medium'
    notes.push('Some players could not be matched automatically.')
  }
  if (managersUnmatched.length > 0) {
    dataConfidenceScore = 'low'
    notes.push('Some managers need manual linking.')
  }

  return {
    playersImported: mappings.filter(m => Boolean(m.internalPlayerId)).length,
    unmatchedPlayers,
    conflictsResolved: conflicts.filter(c => c.resolution !== 'pending').length,
    conflictsPending: conflicts.filter(c => c.resolution === 'pending').length,
    managersMatched: managers.filter(m => Boolean(m.internalUserId)).length,
    managersUnmatched,
    historySeasonsImported: seasons,
    picksImported: picks,
    missingImages: [],
    missingSchoolLogos: [],
    dataConfidenceScore,
    notes,
  }
}
