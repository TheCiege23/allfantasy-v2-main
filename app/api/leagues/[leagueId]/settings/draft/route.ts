/**
 * GET / PATCH /api/leagues/[leagueId]/settings/draft
 *
 * Post-create draft-settings surface for commissioners. Exposes the
 * broader menu that the create-league form intentionally hides:
 *   - draftType  (snake, linear, auction — format-specific variants honored)
 *   - executionMode (live | auto | offline)
 *   - thirdRoundReversal flag (snake-only)
 *   - rookiePickOrderMethod (linear | weighted_lottery | …)
 *
 * Commissioner-only. Validates against format-level allowlist, then
 * persists to League + LeagueSettings + Dynasty rookie-order config.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import {
  getSettingsTabDraftTypesForFormat,
  getSettingsTabExecutionModes,
  getRookiePickOrderMethods,
  isDraftTypeAllowedOnSettingsTab,
  isRookiePickOrderMethod,
  mapCanonicalDraftTypeToEngineCore,
  type DraftExecutionMode,
  type RookiePickOrderMethod,
} from '@/lib/draft-types/draftTypeRegistry'

export const dynamic = 'force-dynamic'

function isExecutionMode(x: unknown): x is DraftExecutionMode {
  return typeof x === 'string' && (['live', 'auto', 'offline'] as const).includes(x as DraftExecutionMode)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params

  /*
   * 🛑 THIS GET RETURNED THE LEAGUE TO ANY SIGNED-IN USER. It computed
   * `isCommissioner: league.userId === userId` and returned it as a FIELD for
   * the UI to branch on; the refusal on that comparison lives in the PATCH
   * below, not here. Naming any leagueId returned its draft settings.
   *
   * ⚠ MEMBER-LEVEL, NOT COMMISSIONER-LEVEL. The response carries
   * `isCommissioner` precisely so ordinary members can load this read-only,
   * so gating at commissioner level would close the hole and break them. The
   * PATCH keeps its own stricter check.
   */
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) {
    return NextResponse.json(
      { error: membership.status === 404 ? 'Not found' : 'Forbidden' },
      { status: membership.status },
    )
  }


  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      userId: true,
      leagueType: true,
      isDynasty: true,
      settings: true,
    },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const [leagueSettings, draftSession, dynastyConfig] = await Promise.all([
    prisma.leagueSettings.findUnique({
      where: { leagueId },
      select: { draftType: true, cpuAutoPick: true, aiAutoPick: true },
    }),
    prisma.draftSession.findUnique({
      where: { leagueId },
      select: { thirdRoundReversal: true, status: true, draftType: true },
    }),
    league.isDynasty
      ? prisma.dynastyLeagueConfig.findUnique({
          where: { leagueId },
          select: { rookiePickOrderMethod: true },
        })
      : Promise.resolve(null),
  ])

  const rookieMethodRaw = dynastyConfig?.rookiePickOrderMethod
  const rookieMethod: RookiePickOrderMethod = isRookiePickOrderMethod(rookieMethodRaw)
    ? rookieMethodRaw
    : 'linear'
  const settings = (league.settings as Record<string, unknown> | null) ?? {}

  const executionMode: DraftExecutionMode = leagueSettings?.aiAutoPick
    ? 'auto'
    : settings.draft_execution_offline === true
      ? 'offline'
      : 'live'

  return NextResponse.json({
    leagueId,
    leagueType: league.leagueType,
    isCommissioner: league.userId === userId,
    current: {
      draftType: leagueSettings?.draftType ?? 'snake',
      executionMode,
      thirdRoundReversal: Boolean(draftSession?.thirdRoundReversal),
      rookiePickOrderMethod: rookieMethod,
    },
    options: {
      draftTypes: getSettingsTabDraftTypesForFormat(league.leagueType),
      executionModes: getSettingsTabExecutionModes(),
      rookiePickOrderMethods: getRookiePickOrderMethods(),
    },
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, userId: true, leagueType: true, isDynasty: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (league.userId !== userId) {
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  }

  const body = (await req.json().catch(() => null)) as {
    draftType?: string
    executionMode?: string
    thirdRoundReversal?: boolean
    rookiePickOrderMethod?: string
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const draftUpdates: Record<string, unknown> = {}
  const sessionUpdates: Record<string, unknown> = {}
  const settingsPatch: Record<string, unknown> = {}

  if (typeof body.draftType === 'string' && body.draftType.trim().length > 0) {
    const next = body.draftType.trim().toLowerCase()
    if (!isDraftTypeAllowedOnSettingsTab(league.leagueType, next)) {
      return NextResponse.json(
        {
          error: `Draft type "${next}" is not available for ${league.leagueType} leagues.`,
          allowed: getSettingsTabDraftTypesForFormat(league.leagueType),
        },
        { status: 400 },
      )
    }
    draftUpdates.draftType = mapCanonicalDraftTypeToEngineCore(next)
    settingsPatch.requested_draft_type = next
  }

  if (body.executionMode !== undefined) {
    if (!isExecutionMode(body.executionMode)) {
      return NextResponse.json({ error: 'Invalid executionMode' }, { status: 400 })
    }
    draftUpdates.cpuAutoPick = body.executionMode === 'auto'
    draftUpdates.aiAutoPick = body.executionMode === 'auto'
    settingsPatch.draft_execution_offline = body.executionMode === 'offline'
    settingsPatch.draft_execution_mode = body.executionMode
  }

  if (typeof body.thirdRoundReversal === 'boolean') {
    // 3RR is a DraftSession-level flag (engine reads from the session at
    // pick time). Only allow toggling while the session is pre-draft.
    sessionUpdates.thirdRoundReversal = body.thirdRoundReversal
  }

  let rookieMethodToPersist: RookiePickOrderMethod | null = null
  if (body.rookiePickOrderMethod !== undefined) {
    if (!isRookiePickOrderMethod(body.rookiePickOrderMethod)) {
      return NextResponse.json({ error: 'Invalid rookiePickOrderMethod' }, { status: 400 })
    }
    if (!league.isDynasty) {
      return NextResponse.json(
        { error: 'Rookie pick-order method applies to dynasty leagues only.' },
        { status: 400 },
      )
    }
    rookieMethodToPersist = body.rookiePickOrderMethod
  }

  if (
    Object.keys(draftUpdates).length === 0 &&
    Object.keys(sessionUpdates).length === 0 &&
    Object.keys(settingsPatch).length === 0 &&
    !rookieMethodToPersist
  ) {
    return NextResponse.json({ error: 'No updatable fields in body' }, { status: 400 })
  }

  if (Object.keys(draftUpdates).length > 0) {
    await prisma.leagueSettings.update({
      where: { leagueId },
      data: draftUpdates,
    })
    // Mirror a draftType change onto an existing pre-draft DraftSession so
    // the engine picks it up without requiring a session reset.
    if ('draftType' in draftUpdates) {
      const existing = await prisma.draftSession.findUnique({
        where: { leagueId },
        select: { status: true },
      })
      if (existing && existing.status === 'pre_draft') {
        await prisma.draftSession.update({
          where: { leagueId },
          data: { draftType: draftUpdates.draftType as string },
        })
      }
    }
  }

  if (rookieMethodToPersist) {
    // Dynasty rookie pick-order lives on DynastyLeagueConfig; the draft
    // engine reads from there (resolve-draft-context.ts). Upsert so
    // leagues created before the config existed still flip cleanly.
    await prisma.dynastyLeagueConfig.upsert({
      where: { leagueId },
      create: {
        leagueId,
        rookiePickOrderMethod: rookieMethodToPersist,
      },
      update: {
        rookiePickOrderMethod: rookieMethodToPersist,
      },
    })
  }

  if (Object.keys(sessionUpdates).length > 0) {
    const session = await prisma.draftSession.findUnique({
      where: { leagueId },
      select: { status: true },
    })
    if (!session) {
      return NextResponse.json(
        { error: 'No draft session to update. Session must exist before toggling 3RR.' },
        { status: 400 },
      )
    }
    // 3RR can be toggled at any session status. The engine reads
    // `thirdRoundReversal` per-pick via DraftOrderService, so a flip only
    // affects upcoming picks — picks already made keep their recorded
    // slot assignments. Commissioner is on the hook for explaining a
    // mid-draft flip to the league.
    await prisma.draftSession.update({
      where: { leagueId },
      data: { ...sessionUpdates, version: { increment: 1 }, updatedAt: new Date() },
    })
  }

  if (Object.keys(settingsPatch).length > 0) {
    const merged = {
      ...((league.settings as Record<string, unknown> | null) ?? {}),
      ...settingsPatch,
    }
    await prisma.league.update({
      where: { id: leagueId },
      data: { settings: merged as never },
    })
  }

  return NextResponse.json({ ok: true })
}
