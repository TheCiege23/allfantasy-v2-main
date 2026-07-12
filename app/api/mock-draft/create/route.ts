import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createMockDraftSession } from '@/lib/mock-draft-engine/MockDraftSessionService'
import { prisma } from '@/lib/prisma'
import type { MockRoomMode, MockSlotConfigEntry } from '@/lib/mock-draft-engine/types'

function buildSlotConfigForMode(params: {
  roomMode: string
  numTeams: number
  ownerUserId: string
  humanTeams: number
}): MockSlotConfigEntry[] {
  const { roomMode, numTeams, ownerUserId, humanTeams } = params
  if (roomMode === 'cpu_only') {
    return Array.from({ length: numTeams }, (_, idx) => ({
      slot: idx + 1,
      type: 'cpu',
      userId: null,
      displayName: `CPU ${idx + 1}`,
    }))
  }
  if (roomMode === 'linked_public') {
    return Array.from({ length: numTeams }, (_, idx) => ({
      slot: idx + 1,
      type: 'human',
      userId: idx === 0 ? ownerUserId : null,
      displayName: idx === 0 ? 'Host' : `Open Slot ${idx + 1}`,
    }))
  }
  if (roomMode === 'mixed') {
    return Array.from({ length: numTeams }, (_, idx) => {
      const slot = idx + 1
      const isHuman = slot <= humanTeams
      if (isHuman) {
        return {
          slot,
          type: 'human',
          userId: slot === 1 ? ownerUserId : null,
          displayName: slot === 1 ? 'Host' : `Open Slot ${slot}`,
        }
      }
      return {
        slot,
        type: 'cpu',
        userId: null,
        displayName: `CPU ${slot}`,
      }
    })
  }
  return Array.from({ length: numTeams }, (_, idx) => ({
    slot: idx + 1,
    type: idx === 0 ? 'human' : 'cpu',
    userId: idx === 0 ? ownerUserId : null,
    displayName: idx === 0 ? 'Host' : `CPU ${idx + 1}`,
  }))
}

// Create mock draft. Uses mock-draft-engine when slotConfig or useSession provided (invite link, human/CPU slots).
export async function POST(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const sport = String(body?.sport || 'NFL')
    const leagueType = String(body?.leagueType || 'redraft')
    const draftType = String(body?.draftType || 'snake')
    const aiEnabled = Boolean(body?.aiEnabled)
    const leagueId = body?.leagueId ?? null
    const numTeams = Math.min(16, Math.max(8, Number(body?.numTeams) || 12))
    const rounds = Math.min(22, Math.max(12, Number(body?.rounds) || 15))
    const timerSeconds = Number(body?.timerSeconds) ?? 0
    const scoringFormat = String(body?.scoringFormat || 'default')
    const poolType = String(body?.poolType || 'all')
    const rosterSize = body?.rosterSize != null ? Number(body.rosterSize) : undefined
    const roomModeRaw = String(body?.roomMode || 'solo')
    const roomMode: MockRoomMode =
      roomModeRaw === 'mixed' || roomModeRaw === 'linked_public' || roomModeRaw === 'cpu_only'
        ? roomModeRaw
        : 'solo'
    const humanTeams = Math.min(numTeams, Math.max(1, Number(body?.humanTeams) || 1))
    const keepersEnabled = Boolean(body?.keepersEnabled)
    const keepers = Array.isArray(body?.keepers) ? body.keepers : []
    const slotConfig = Array.isArray(body?.slotConfig)
      ? body.slotConfig
      : body?.useSession
        ? buildSlotConfigForMode({
            roomMode,
            numTeams,
            ownerUserId: session.user.id,
            humanTeams,
          })
        : undefined

    if (slotConfig !== undefined || body?.useSession) {
      if (draftType === 'auction') {
        return NextResponse.json(
          { error: 'Auction mock drafts are not available in the live mock room yet.' },
          { status: 400 },
        )
      }
      const snapshot = await createMockDraftSession(session.user.id, {
        leagueId: leagueId || undefined,
        settings: {
          sport,
          leagueType,
          draftType,
          numTeams,
          rounds,
          timerSeconds,
          aiEnabled,
          scoringFormat,
          leagueId: leagueId || undefined,
          poolType,
          rosterSize,
          roomMode,
          humanTeams,
          keepersEnabled,
          keepers,
        },
        slotConfig,
      })
      return NextResponse.json({
        status: 'ok',
        draftId: snapshot.id,
        config: snapshot.settings,
        inviteToken: snapshot.inviteToken,
        inviteLink: snapshot.inviteLink,
        slotConfig: snapshot.slotConfig,
        draftStatus: snapshot.status,
      })
    }

    const metadata = {
      sport,
      leagueType,
      draftType,
      aiEnabled,
      numTeams,
      rounds,
      timerSeconds,
      scoringFormat,
      poolType,
      rosterSize,
      roomMode,
      humanTeams,
      keepersEnabled,
      keepers,
      source: body?.source || 'mock-draft-setup',
    }

    const created = await prisma.mockDraft.create({
      data: {
        leagueId: leagueId || undefined,
        userId: session.user.id,
        rounds,
        results: [],
        proposals: [],
        status: 'pre_draft',
        metadata,
      },
      select: { id: true, createdAt: true },
    })

    return NextResponse.json({
      status: 'ok',
      draftId: created.id,
      config: { sport, leagueType, draftType, aiEnabled, numTeams, rounds, timerSeconds, scoringFormat, leagueId: leagueId || undefined },
    })
  } catch (err: any) {
    console.error('[mock-draft/create] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
