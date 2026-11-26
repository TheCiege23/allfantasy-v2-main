import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { isAnyC2CLeague } from '@/lib/c2c/c2cLeagueSettings'

export const dynamic = 'force-dynamic'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'G', 'F', 'C', 'SF', 'PF', 'PG']

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ options: [] }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const draft = req.nextUrl.searchParams?.get('draft') ?? ''
  if (!leagueId) return NextResponse.json({ options: [] }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, session.user.id)
  if (!gate.ok) return NextResponse.json({ options: [] }, { status: 403 })

  if (!(await isAnyC2CLeague(leagueId))) return NextResponse.json({ type: 'command', options: [] })

  const low = draft.toLowerCase()
  const after = low.includes('@chimmy') ? draft.slice(low.indexOf('@chimmy') + '@chimmy'.length).trim() : draft
  const al = after.toLowerCase()

  if (al.includes('evaluate') || al.includes('prospect')) {
    const campus = await prisma.c2CPlayerState.findMany({
      where: { leagueId, playerSide: 'campus' },
      take: 12,
      orderBy: { playerName: 'asc' },
      select: { playerName: true },
    })
    const opts = campus.map((p) => `@chimmy evaluate prospect ${p.playerName}`)
    return NextResponse.json({ type: 'command', options: opts.length ? opts : ['@chimmy evaluate prospect '] })
  }

  if (al.includes('campus rankings')) {
    return NextResponse.json({
      type: 'command',
      options: ['@chimmy campus rankings', ...POSITIONS.map((p) => `@chimmy campus rankings ${p}`)],
    })
  }

  if (al.includes('pro rankings')) {
    return NextResponse.json({
      type: 'command',
      options: ['@chimmy pro rankings', ...POSITIONS.map((p) => `@chimmy pro rankings ${p}`)],
    })
  }

  return NextResponse.json({
    type: 'command',
    options: [
      '@chimmy c2c rules',
      '@chimmy scoring mode',
      '@chimmy taxi rules',
      '@chimmy devy rules',
      '@chimmy draft format',
      '@chimmy campus rankings',
      '@chimmy pro rankings',
      '@chimmy transition watch',
      '@chimmy evaluate prospect ',
      '@chimmy help',
    ],
  })
}

