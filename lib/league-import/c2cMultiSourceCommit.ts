/**
 * C2C multi-source import commit. Creates a Campus-to-Canton league shell
 * via the canonical creation pipeline, then writes one placeholder Roster
 * per merged manager plus the `C2CPlayerState` rows for their combined
 * pro + college rosters. Managers claim their placeholder rosters later
 * via the league's invite/join flow.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { executeCanonicalLeagueCreation } from '@/lib/league-creation/canonical/executeCanonicalLeagueCreation'
import type { MergedC2CRoster } from './c2cMultiSourceMerge'
import type { C2CImportSource } from './types'
import { withRosterObservation } from '@/lib/league-import/rosterPayload'

function platformIdFor(provider: string, teamId: string): string {
  return `import:${provider}:${teamId}`
}

function collegeSportFor(primary: 'NFL' | 'NBA'): 'NCAAF' | 'NCAAB' {
  return primary === 'NFL' ? 'NCAAF' : 'NCAAB'
}

export interface C2CCommitInput {
  appUserId: string
  leagueName: string
  sport: 'NFL' | 'NBA'
  draftType: 'c2c_snake' | 'c2c_linear' | 'c2c_auction'
  scoringPreset: string
  merged: MergedC2CRoster[]
  proSource: C2CImportSource
  collegeSource: C2CImportSource
}

export interface C2CCommitResult {
  leagueId: string
  rostersCreated: number
  playerStatesCreated: number
  joinCode: string | null
}

export async function persistC2CMultiSource(input: C2CCommitInput): Promise<C2CCommitResult> {
  const { appUserId, leagueName, sport, draftType, scoringPreset, merged, proSource, collegeSource } = input

  if (merged.length === 0) {
    throw new Error('No merged managers to commit')
  }

  const shell = await executeCanonicalLeagueCreation({
    appUserId,
    body: {
      concept: 'c2c',
      sport,
      scoringPreset,
      teamCount: merged.length,
      draftType,
      leagueName,
      conceptSetup: {
        importSource: 'c2c-multi',
        proProvider: proSource.provider,
        collegeProvider: collegeSource.provider,
      },
    },
  })
  if (!shell.ok) {
    throw new Error(shell.response.error ?? 'League shell creation failed')
  }
  const leagueId = shell.response.league.id

  let rostersCreated = 0
  let playerStatesCreated = 0

  const collegeSport = collegeSportFor(sport)

  for (const manager of merged) {
    /*
     * 🛑 A FIRST IMPORT WITH AN UNOBSERVED SOURCE MUST NOT PUBLISH A FALSELY EMPTY ROSTER
     * — Batch A.1 item 2.
     *
     * This path CREATES the league, so there is no last-good data to preserve; the only
     * decision available is what the new row asserts. Writing the merged list unqualified
     * would state "this manager rosters exactly these players" when one of the two source
     * reads failed — the same false claim the taxonomy exists to prevent, and worse here
     * because a C2C manager legitimately has an empty college side, so nothing about the
     * shape looks wrong.
     *
     * The row is still created (the manager exists, and refusing to create it would lose the
     * league), but it carries the rolled-up observation, so every reader that asks
     * `isRosterContentKnown` sees "unknown" rather than "empty".
     */
    const c2cPlayerData = withRosterObservation(
      {
        players: [
          ...manager.proPlayers.map((p) => p.playerId),
          ...manager.collegePlayers.map((p) => p.playerId),
        ],
        import: {
          displayName: manager.displayName,
          proProvider: proSource.provider,
          proTeamId: manager.proSource.teamId,
          proTeamName: manager.proTeamName,
          collegeProvider: collegeSource.provider,
          collegeTeamId: manager.collegeSource.teamId,
          collegeTeamName: manager.collegeTeamName,
        },
      },
      manager.rosterStatus,
    )

    const roster = await prisma.roster.create({
      data: {
        leagueId,
        platformUserId: platformIdFor(proSource.provider, manager.proSource.teamId),
        playerData: c2cPlayerData as Prisma.JsonObject,
      },
    })
    rostersCreated++

    const playerStateRows = [
      ...manager.proPlayers.map((p) => ({
        leagueId,
        rosterId: roster.id,
        playerId: p.playerId,
        playerName: p.name,
        position: p.position,
        sport,
        playerSide: 'canton',
        bucketState: 'bench',
        scoringEligibility: 'display_only',
      })),
      ...manager.collegePlayers.map((p) => ({
        leagueId,
        rosterId: roster.id,
        playerId: p.playerId,
        playerName: p.name,
        position: p.position,
        sport: collegeSport,
        playerSide: 'campus',
        bucketState: 'bench',
        scoringEligibility: 'display_only',
      })),
    ]

    if (playerStateRows.length > 0) {
      const inserted = await prisma.c2CPlayerState.createMany({
        data: playerStateRows,
        skipDuplicates: true,
      })
      playerStatesCreated += inserted.count
    }
  }

  // Stamp the import snapshot onto league settings so later flows (invite
  // claim, roster sync) know where the data came from.
  const current = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true, joinCode: true },
  })
  await prisma.league.update({
    where: { id: leagueId },
    data: {
      settings: {
        ...((current?.settings as Record<string, unknown> | null) ?? {}),
        c2cImport: {
          pro: { provider: proSource.provider, sourceId: proSource.sourceId, depth: proSource.rosterDepth },
          college: {
            provider: collegeSource.provider,
            sourceId: collegeSource.sourceId,
            depth: collegeSource.rosterDepth,
          },
          committedAt: new Date().toISOString(),
        },
      } as Prisma.InputJsonValue,
    },
  })

  return {
    leagueId,
    rostersCreated,
    playerStatesCreated,
    joinCode: current?.joinCode ?? null,
  }
}
