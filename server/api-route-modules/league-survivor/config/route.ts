import { prisma } from '@/lib/prisma'
/**
 * GET/PUT: Survivor league config. PROMPT 349 QA — commissioner or league member can read; only commissioner can write.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { isSurvivorLeague, getSurvivorConfig, upsertSurvivorConfig } from '@/lib/survivor/SurvivorLeagueConfig'
import { SURVIVOR_IDOL_CATALOG, type SurvivorIdolPowerType } from '@/lib/survivor/survivorIdolSeedingEngine'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isSurvivor = await isSurvivorLeague(leagueId)
  if (!isSurvivor) return NextResponse.json({ error: 'Not a survivor league' }, { status: 404 })

  const config = await getSurvivorConfig(leagueId)
  if (!config) return NextResponse.json({ config: null })

  return NextResponse.json({
    config: {
      mode: config.mode,
      tribeCount: config.tribeCount,
      tribeSize: config.tribeSize,
      tribeFormation: config.tribeFormation,
      mergeTrigger: config.mergeTrigger,
      mergeWeek: config.mergeWeek,
      mergePlayerCount: config.mergePlayerCount,
      juryStartAfterMerge: config.juryStartAfterMerge,
      exileReturnEnabled: config.exileReturnEnabled,
      exileReturnTokens: config.exileReturnTokens,
      idolCount: config.idolCount,
      idolPowerPool: config.idolPowerPool,
      tribeShuffleEnabled: config.tribeShuffleEnabled,
      tribeShuffleConsecutiveLosses: config.tribeShuffleConsecutiveLosses,
      tribeShuffleImbalanceThreshold: config.tribeShuffleImbalanceThreshold,
      voteDeadlineDayOfWeek: config.voteDeadlineDayOfWeek,
      voteDeadlineTimeUtc: config.voteDeadlineTimeUtc,
      selfVoteDisallowed: config.selfVoteDisallowed,
      tribalCouncilDayOfWeek: config.tribalCouncilDayOfWeek,
      tribalCouncilTimeUtc: config.tribalCouncilTimeUtc,
      minigameFrequency: config.minigameFrequency,
      seasonThemeLabel: config.seasonThemeLabel,
      challengesSystemRun: config.challengesSystemRun,
      regularSeasonEndWeek: config.regularSeasonEndWeek,
      faqSeededAt: config.faqSeededAt,
    },
  })
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const commissioner = await isCommissioner(leagueId, userId)
  if (!commissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const isSurvivor = await isSurvivorLeague(leagueId)
  if (!isSurvivor) return NextResponse.json({ error: 'Not a survivor league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (body.idolCount != null) return NextResponse.json({ error: 'Set idol count in Survivor Idols settings before the draft.' }, { status: 400 })
  const mutableAfterDraft = new Set(['voteDeadlineDayOfWeek', 'voteDeadlineTimeUtc'])
  const changingLockedRule = Object.keys(body).some(key => !mutableAfterDraft.has(key))
  if (changingLockedRule && await prisma.draftSession.findFirst({ where: { leagueId, status: { in: ['in_progress', 'paused', 'completed'] } }, select: { id: true } })) {
    return NextResponse.json({ error: 'Season rules lock when the draft starts. Only the vote deadline can change during the season.' }, { status: 409 })
  }
  if (body.idolPowerPool != null) {
    if (!Array.isArray(body.idolPowerPool) || body.idolPowerPool.length === 0 ||
      body.idolPowerPool.some((power: unknown) => typeof power !== 'string' || SURVIVOR_IDOL_CATALOG[power as SurvivorIdolPowerType]?.resolution !== 'phase2')) {
      return NextResponse.json({ error: 'The idol pool may contain only implemented powers.' }, { status: 422 })
    }
  }
  if (body.tribeCount != null || body.tribeSize != null) {
    const current = await prisma.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { tribeCount: true, tribeSize: true } })
    if ((body.tribeCount != null && Number(body.tribeCount) !== current?.tribeCount) || (body.tribeSize != null && Number(body.tribeSize) !== current?.tribeSize)) return NextResponse.json({ error: 'Use Tribe identities and capacities to save tribe structure together.' }, { status: 409 })
  }
  const updated = await upsertSurvivorConfig(leagueId, {
    ...(body.mode != null && { mode: String(body.mode) }),
    ...(body.tribeCount != null && { tribeCount: Number(body.tribeCount) }),
    ...(body.tribeSize != null && { tribeSize: Number(body.tribeSize) }),
    ...(body.tribeFormation != null && { tribeFormation: String(body.tribeFormation) }),
    ...(body.mergeTrigger != null && { mergeTrigger: String(body.mergeTrigger) }),
    ...(body.mergeWeek != null && { mergeWeek: Number(body.mergeWeek) }),
    ...(body.mergePlayerCount != null && { mergePlayerCount: Number(body.mergePlayerCount) }),
    ...(body.juryStartAfterMerge != null && { juryStartAfterMerge: Number(body.juryStartAfterMerge) }),
    ...(body.exileReturnEnabled != null && { exileReturnEnabled: Boolean(body.exileReturnEnabled) }),
    ...(body.exileReturnTokens != null && { exileReturnTokens: Number(body.exileReturnTokens) }),
    ...(body.idolPowerPool != null && { idolPowerPool: Array.isArray(body.idolPowerPool) ? body.idolPowerPool.map(String) : undefined }),
    ...(body.tribeShuffleEnabled != null && { tribeShuffleEnabled: Boolean(body.tribeShuffleEnabled) }),
    ...(body.tribeShuffleConsecutiveLosses != null && { tribeShuffleConsecutiveLosses: Number(body.tribeShuffleConsecutiveLosses) }),
    ...(body.tribeShuffleImbalanceThreshold != null && { tribeShuffleImbalanceThreshold: Number(body.tribeShuffleImbalanceThreshold) }),
    ...(body.voteDeadlineDayOfWeek != null && { voteDeadlineDayOfWeek: Number(body.voteDeadlineDayOfWeek) }),
    ...(body.voteDeadlineTimeUtc != null && { voteDeadlineTimeUtc: String(body.voteDeadlineTimeUtc) }),
    ...(body.selfVoteDisallowed != null && { selfVoteDisallowed: Boolean(body.selfVoteDisallowed) }),
    ...(body.tribalCouncilDayOfWeek != null && { tribalCouncilDayOfWeek: Number(body.tribalCouncilDayOfWeek) }),
    ...(body.tribalCouncilTimeUtc != null && { tribalCouncilTimeUtc: String(body.tribalCouncilTimeUtc) }),
    ...(body.minigameFrequency != null && { minigameFrequency: String(body.minigameFrequency) }),
    ...(body.seasonThemeLabel !== undefined && {
      seasonThemeLabel: body.seasonThemeLabel === null || body.seasonThemeLabel === '' ? null : String(body.seasonThemeLabel),
    }),
    ...(body.challengesSystemRun != null && { challengesSystemRun: Boolean(body.challengesSystemRun) }),
    ...(body.regularSeasonEndWeek !== undefined && {
      regularSeasonEndWeek:
        body.regularSeasonEndWeek === null ? null : Math.min(52, Math.max(1, Number(body.regularSeasonEndWeek))),
    }),
  })
  if (!updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  return NextResponse.json({ ok: true, config: updated })
}
