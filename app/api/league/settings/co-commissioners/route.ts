import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCommissionerOnly, requireCommissionerRole } from '@/lib/league/permissions'
import {
  CO_COMMISSIONER_SCOPES,
  MAX_CO_COMMISSIONERS,
  hasConfiguredScopes,
  parseScopeList,
  readCoCommissionerScopes,
  withCoCommissionerScopes,
  type CoCommissionerScope,
} from '@/lib/league/coCommissionerScopes'

export const dynamic = 'force-dynamic'

/**
 * Co-commissioners (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §2.1): who they are, and what each may do.
 *
 *   GET   ?leagueId=…   { max, allScopes, scopes: { [teamId]: { scopes, configured } } } — any commissioner
 *   PATCH { leagueId, memberId, isCoCommissioner?, scopes? }                             — head commissioner only
 *
 * Adding a third co-commissioner is refused; leagues that already had more keep them (nobody is
 * demoted by the cap). Removing one clears their saved permissions, so a re-add starts at full rights.
 */

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(req: NextRequest) {
  try {
    const userId = await sessionUserId()
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    const leagueId = req.nextUrl.searchParams.get('leagueId')?.trim() ?? ''
    if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

    await requireCommissionerRole(leagueId, userId)

    const [league, coTeams] = await Promise.all([
      prisma.league.findFirst({ where: { id: leagueId }, select: { settings: true } }),
      prisma.leagueTeam.findMany({ where: { leagueId, isCoCommissioner: true, isCommissioner: false }, select: { id: true } }),
    ])
    const scopes: Record<string, { scopes: CoCommissionerScope[]; configured: boolean }> = {}
    for (const t of coTeams) {
      scopes[t.id] = { scopes: readCoCommissionerScopes(league?.settings, t.id), configured: hasConfiguredScopes(league?.settings, t.id) }
    }
    return NextResponse.json({ max: MAX_CO_COMMISSIONERS, allScopes: CO_COMMISSIONER_SCOPES, scopes })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[co-commissioners GET]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

/** Read-modify-write of League.settings under a row lock, so two saves cannot drop each other. */
async function writeScopes(leagueId: string, teamId: string, scopes: CoCommissionerScope[] | null) {
  await prisma.$transaction(async (t: Prisma.TransactionClient) => {
    await t.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const row = await t.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    const next = withCoCommissionerScopes(row?.settings, teamId, scopes)
    await t.league.update({ where: { id: leagueId }, data: { settings: next as object } })
  })
}

export async function PATCH(req: NextRequest) {
  try {
    const userId = await sessionUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = (await req.json()) as {
      leagueId?: string
      memberId?: string
      isCoCommissioner?: boolean
      scopes?: unknown
    }

    const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
    const memberId = typeof body.memberId === 'string' ? body.memberId.trim() : ''
    if (!leagueId || !memberId) {
      return NextResponse.json({ error: 'leagueId and memberId required' }, { status: 400 })
    }
    const scopes = body.scopes === undefined ? undefined : parseScopeList(body.scopes)
    if (scopes === null) {
      return NextResponse.json({ error: `scopes must be a list of: ${CO_COMMISSIONER_SCOPES.join(', ')}` }, { status: 400 })
    }
    if (body.isCoCommissioner === undefined && scopes === undefined) {
      return NextResponse.json({ error: 'isCoCommissioner or scopes required' }, { status: 400 })
    }

    await requireCommissionerOnly(leagueId, userId)

    const team = await prisma.leagueTeam.findFirst({
      where: { id: memberId, leagueId },
    })
    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }
    if (team.isCommissioner) {
      return NextResponse.json({ error: 'Cannot change co-commissioner status for the commissioner' }, { status: 400 })
    }

    const makeCo = body.isCoCommissioner === undefined ? team.isCoCommissioner : Boolean(body.isCoCommissioner)
    if (!makeCo && scopes !== undefined) {
      return NextResponse.json({ error: 'Only a co-commissioner has permissions to set' }, { status: 400 })
    }

    if (makeCo && !team.isCoCommissioner) {
      const others = await prisma.leagueTeam.count({
        where: { leagueId, isCoCommissioner: true, isCommissioner: false, NOT: { id: memberId } },
      })
      if (others >= MAX_CO_COMMISSIONERS) {
        return NextResponse.json(
          { error: `A league can have up to ${MAX_CO_COMMISSIONERS} co-commissioners. Remove one first.` },
          { status: 409 },
        )
      }
    }

    if (makeCo !== team.isCoCommissioner) {
      await prisma.leagueTeam.update({
        where: { id: memberId },
        data: { isCoCommissioner: makeCo },
      })
    }
    // Removed: forget their permissions. Added or edited with a list: save exactly that list.
    if (!makeCo) await writeScopes(leagueId, memberId, null)
    else if (scopes !== undefined) await writeScopes(leagueId, memberId, scopes)

    return NextResponse.json({ success: true, isCoCommissioner: makeCo, ...(scopes !== undefined ? { scopes } : {}) })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[co-commissioners PATCH]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
