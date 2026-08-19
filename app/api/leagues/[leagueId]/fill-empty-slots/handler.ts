import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { getRandomStrategy } from '@/lib/draft-strategies/strategyDefinitions'
import { createStrategyLog, initializeDraftStrategyTracking } from '@/lib/draft-strategies/strategyTracker'
import { getOrCreateDraftSession, buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { transitionLeagueState } from '@/server/services/leagueLifecycleService'

export const dynamic = 'force-dynamic'

/**
 * POST: Create AI rosters for all empty draft slots in a league.
 * Automatically fills any missing team slots with AI-managed rosters.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await params

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const [league, existingTeams] = await Promise.all([
      prisma.league.findUnique({
        where: { id: leagueId },
        select: { leagueSize: true },
      }),
      prisma.leagueTeam.findMany({
        where: { leagueId },
        select: { id: true },
      }),
    ])

    if (!league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 })
    }

    const teamCount = league.leagueSize ?? 12
    const emptySlotCount = teamCount - existingTeams.length

    if (emptySlotCount <= 0) {
      return NextResponse.json({
        ok: true,
        message: 'All slots are already filled',
        teamsCreated: 0,
      })
    }

    // Create rosters and teams for empty slots with assigned strategies
    const teamsCreated: Array<{ rosterId: string; strategy: ReturnType<typeof getRandomStrategy> }> = []
    const strategyAssignments: Array<{
      teamId: string
      rosterId: string
      displayName: string
      strategy: ReturnType<typeof getRandomStrategy>
    }> = []

    for (let i = 0; i < emptySlotCount; i++) {
      const slotNum = existingTeams.length + i + 1
      const aiName = `AI Team ${slotNum}`
      const orphanId = `orphan-ai-${randomUUID()}`

      // Assign a random strategy to this AI team
      const strategy = getRandomStrategy()

      // Create roster
      const roster = await prisma.roster.create({
        data: {
          leagueId,
          platformUserId: orphanId,
          playerData: { draftPicks: [] },
          settings: {
            draftStrategy: strategy.id,
            strategyName: strategy.name,
            strategicArchetype: strategy.archetypeId,
            strategyAssignedAt: new Date().toISOString(),
          } as unknown as Prisma.InputJsonValue,
        },
      })

      // Create league team linked to roster with strategy metadata
      const leagueTeam = await prisma.leagueTeam.create({
        data: {
          leagueId,
          externalId: roster.id,
          ownerName: aiName,
          teamName: aiName,
          platformUserId: orphanId,
          isCommissioner: false,
          role: 'member',
        },
      })

      teamsCreated.push({ rosterId: roster.id, strategy })
      strategyAssignments.push({
        teamId: leagueTeam.id,
        rosterId: roster.id,
        displayName: aiName,
        strategy,
      })
    }

    // Initialize strategy tracking for this draft
    initializeDraftStrategyTracking(leagueId)

    // Create strategy logs for each AI team (hidden from UI, used for post-draft analysis)
    for (const assignment of strategyAssignments) {
      createStrategyLog(
        leagueId,
        assignment.teamId,
        assignment.rosterId,
        assignment.displayName,
        assignment.strategy
      )
    }

    // Get all teams for randomization
    const allTeams = await prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { externalId: true, teamName: true, ownerName: true, id: true, avatarUrl: true },
    })

    // Shuffle and create draft order slots
    const shuffled = [...allTeams].sort(() => Math.random() - 0.5)
    const draftOrderSlots = shuffled.map((team, index) => ({
      slot: index + 1,
      ownerId: team.id,
      ownerName: team.ownerName || team.teamName || `Team ${index + 1}`,
      avatarUrl: team.avatarUrl || null,
    }))

    // Create slotOrder for draft session
    const slotOrder = shuffled.map((team, index) => ({
      slot: index + 1,
      rosterId: team.externalId,
      displayName: team.ownerName || team.teamName || `Team ${index + 1}`,
    }))

    // Create draft session if it doesn't exist
    await getOrCreateDraftSession(leagueId)

    // Update draft session
    await prisma.draftSession.update({
      where: { leagueId },
      data: {
        slotOrder: slotOrder as unknown as Prisma.InputJsonValue,
        cpuAutoPick: true,
        timerSeconds: 30,
      },
    })

    // Update league settings with draft order AND enable CPU auto-pick with shorter timer
    await prisma.leagueSettings.upsert({
      where: { leagueId },
      create: {
        leagueId,
        cpuAutoPick: true,
        pickTimerPreset: '30s',
        draftOrderSlots: draftOrderSlots as unknown as Prisma.InputJsonValue,
      },
      update: {
        cpuAutoPick: true,
        pickTimerPreset: '30s',
        draftOrderSlots: draftOrderSlots as unknown as Prisma.InputJsonValue,
      },
    })

    // Transition league to pre_draft state (don't start draft - let commissioner do that)
    try {
      await transitionLeagueState(leagueId, 'pre_draft', userId)
    } catch (e) {
      console.error('[fill-empty-slots] Failed to transition to pre_draft:', e)
      // Continue anyway - the draft may still be usable
    }

    return NextResponse.json({
      ok: true,
      teamsCreated: teamsCreated.length,
      totalTeams: allTeams.length + teamsCreated.length,
      message: `Created ${teamsCreated.length} AI teams and populated draft order`,
      draftOrderSlots,
      strategiesAssigned: strategyAssignments.map((a) => ({
        teamId: a.teamId,
        displayName: a.displayName,
        strategy: { id: a.strategy.id, name: a.strategy.name },
      })),
    })
  } catch (e) {
    console.error('[fill-empty-slots]', e)
    return NextResponse.json(
      { error: (e as Error).message ?? 'Failed to fill empty slots' },
      { status: 500 }
    )
  }
}
