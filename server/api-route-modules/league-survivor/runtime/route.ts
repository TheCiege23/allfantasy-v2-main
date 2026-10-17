/**
 * GET/POST: Survivor engine v2 runtime state (confessionals, clue chains) — persisted on SurvivorGameState.engineRuntimeV2.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league-access'
import { resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'
import { survivorHostGuard } from '@/lib/survivor/survivorHostGuard'
import { isSurvivorLeague } from '@/lib/survivor/SurvivorLeagueConfig'
import {
  advanceClueChain,
  appendConfessional,
  getSurvivorEngineRuntimeState,
  loadSurvivorEngineSpecForLeague,
} from '@/lib/survivor/runtime/survivor-engine-runtime-state'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const PostBodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('confessional'),
    week: z.number().int().min(1),
    media: z.enum(['text', 'audio', 'video']),
    content: z.string().min(1).max(12000),
    visibility: z.enum(['host_only', 'league_after_episode']).default('host_only'),
  }),
  z.object({
    action: z.literal('clue_advance'),
    chainId: z.string().min(1),
    idolTemplateKey: z.string().min(1),
  }),
])

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertLeagueMember(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!(await isSurvivorLeague(leagueId))) {
    return NextResponse.json({ error: 'Not a survivor league' }, { status: 404 })
  }

  const spec = await loadSurvivorEngineSpecForLeague(leagueId)
  const runtime = await getSurvivorEngineRuntimeState(leagueId)
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (!access?.isLeagueMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const confessionals =
    access.decisions.canSeeHiddenIdolAssignments
      ? runtime.confessionals
      : runtime.confessionals.filter((c) => c.userId === userId)

  return NextResponse.json({
    ok: true,
    engineSpecV2: spec,
    runtime: { version: runtime.version, confessionals, clueChains: access.decisions.canSeeHiddenIdolAssignments ? runtime.clueChains : [], storyBeats: access.decisions.canSeeHiddenIdolAssignments ? runtime.storyBeats : [] },
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertLeagueMember(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!(await isSurvivorLeague(leagueId))) {
    return NextResponse.json({ error: 'Not a survivor league' }, { status: 404 })
  }

  const spec = await loadSurvivorEngineSpecForLeague(leagueId)
  if (!spec) {
    return NextResponse.json({ error: 'Survivor config missing' }, { status: 404 })
  }

  let body: z.infer<typeof PostBodySchema>
  try {
    body = PostBodySchema.parse(await req.json())
  } catch (e) {
    return NextResponse.json(
      { error: 'Invalid body', details: e instanceof z.ZodError ? e.flatten() : undefined },
      { status: 400 }
    )
  }

  if (body.action === 'confessional') {
    const roster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: userId },
      select: { id: true },
    })
    if (!roster) {
      return NextResponse.json({ error: 'No roster in this league' }, { status: 400 })
    }
    const result = await appendConfessional(leagueId, spec, {
      rosterId: roster.id,
      userId,
      week: body.week,
      media: body.media,
      content: body.content,
      visibility: body.visibility,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true, entry: result.entry })
  }

  const denied = await survivorHostGuard(leagueId, userId)
  if (denied) return denied

  const adv = await advanceClueChain(leagueId, spec, body.chainId, body.idolTemplateKey)
  if (!adv.ok) return NextResponse.json({ error: adv.error }, { status: 400 })
  return NextResponse.json({ ok: true, progress: adv.progress })
}
