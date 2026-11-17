import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { isAcceptedCoOwnerForRedraftRoster } from '@/lib/team-coowners/access'
import {
  assignDraftSalary,
  getTeamCapSummary,
  processExtension,
  processFranchiseTag,
  processPlayerCut,
} from '@/lib/idp/capEngine'

export const dynamic = 'force-dynamic'

/**
 * 🛑 A CAP WRITE IS FOR YOUR OWN TEAM, OR A COMMISSIONER WITH ROSTERS. Both writes took `rosterId` from the body and
 * checked only that the caller was in the league, so any manager could cut, extend, tag or assign salary on any team
 * (2026-11-16). The cap screens send the viewer's own redraft roster; anyone else needs the rosters permission.
 */
async function capWriteRefusal(leagueId: string, rosterId: string, userId: string): Promise<NextResponse | null> {
  const roster = await prisma.redraftRoster.findFirst({ where: { id: rosterId, leagueId }, select: { ownerId: true } })
  if (!roster) return NextResponse.json({ error: 'Team not found in this league' }, { status: 404 })
  if (roster.ownerId === userId) return null
  if (await isAcceptedCoOwnerForRedraftRoster(leagueId, rosterId, userId).catch(() => false)) return null
  return commissionerAccessResponse(leagueId, userId, 'rosters')
}

function parseSeason(p: string | null, fallback: number): number {
  if (!p) return fallback
  const n = Number(p)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = req.nextUrl
  const leagueId = url.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const cfg = await prisma.iDPCapConfig.findUnique({ where: { leagueId } })
  const defaultSeason = cfg?.season ?? new Date().getFullYear()

  const type = url.searchParams?.get('type')?.trim()

  if (type === 'league_cap_overview') {
    const rosters = await prisma.redraftRoster.findMany({
      where: { leagueId },
      select: { id: true, teamName: true, ownerName: true },
    })
    const summaries = await Promise.all(
      rosters.map(async (r) => {
        try {
          const s = await getTeamCapSummary(leagueId, r.id, defaultSeason)
          return {
            rosterId: r.id,
            teamName: r.teamName,
            ownerName: r.ownerName,
            ...s,
          }
        } catch {
          return {
            rosterId: r.id,
            teamName: r.teamName,
            ownerName: r.ownerName,
            error: 'No cap config',
          }
        }
      }),
    )
    summaries.sort((a, b) => {
      const av = 'availableCap' in a ? a.availableCap : 0
      const bv = 'availableCap' in b ? b.availableCap : 0
      return bv - av
    })
    return NextResponse.json({ season: defaultSeason, teams: summaries })
  }

  const rosterId = url.searchParams?.get('rosterId')?.trim()
  if (!rosterId) return NextResponse.json({ error: 'rosterId required' }, { status: 400 })

  const season = parseSeason(url.searchParams?.get('season'), defaultSeason)

  if (!type || type === 'summary') {
    try {
      const summary = await getTeamCapSummary(leagueId, rosterId, season)
      return NextResponse.json({ season, ...summary })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Cap unavailable'
      return NextResponse.json({ error: msg }, { status: 404 })
    }
  }

  if (type === 'contracts') {
    const rows = await prisma.iDPSalaryRecord.findMany({
      where: { leagueId, rosterId },
      orderBy: { updatedAt: 'desc' },
    })
    return NextResponse.json({ contracts: rows })
  }

  if (type === 'dead_money') {
    const rows = await prisma.iDPDeadMoney.findMany({
      where: { leagueId, rosterId },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ deadMoney: rows })
  }

  if (type === 'projections') {
    const rows = await prisma.iDPCapProjection.findMany({
      where: { leagueId, rosterId },
      orderBy: { projectionYear: 'asc' },
    })
    return NextResponse.json({ projections: rows })
  }

  return NextResponse.json({ error: 'Unknown type' }, { status: 400 })
}

export async function PATCH(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    leagueId?: string
    rosterId?: string
    playerId?: string
    salaryRecordId?: string
    action?: string
    reason?: string
    additionalYears?: number
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const leagueId = body.leagueId?.trim()
  const rosterId = body.rosterId?.trim()
  if (!leagueId || !rosterId || !body.action) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  const refused = await capWriteRefusal(leagueId, rosterId, userId)
  if (refused) return refused

  try {
    if (body.action === 'cut') {
      const salaryRecordId = body.salaryRecordId?.trim()
      const playerId = body.playerId?.trim()
      const rec = salaryRecordId
        ? await prisma.iDPSalaryRecord.findFirst({ where: { id: salaryRecordId, leagueId, rosterId } })
        : playerId
          ? await prisma.iDPSalaryRecord.findFirst({ where: { leagueId, rosterId, playerId } })
          : null
      if (!rec) return NextResponse.json({ error: 'Salary record not found' }, { status: 404 })
      const dead = await processPlayerCut(leagueId, rosterId, rec.id, body.reason)
      return NextResponse.json({ ok: true, deadMoney: dead })
    }

    if (body.action === 'extend') {
      const salaryRecordId = body.salaryRecordId?.trim()
      const additionalYears = body.additionalYears
      if (!salaryRecordId || additionalYears == null || additionalYears < 1) {
        return NextResponse.json({ error: 'salaryRecordId and additionalYears required' }, { status: 400 })
      }
      const updated = await processExtension(leagueId, rosterId, salaryRecordId, additionalYears)
      return NextResponse.json({ ok: true, record: updated })
    }

    if (body.action === 'franchise_tag') {
      const playerId = body.playerId?.trim()
      if (!playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 })
      const rp = await prisma.redraftRosterPlayer.findFirst({
        where: { rosterId, playerId, droppedAt: null },
      })
      if (!rp) return NextResponse.json({ error: 'Player not on roster' }, { status: 404 })
      const record = await processFranchiseTag(
        leagueId,
        rosterId,
        playerId,
        rp.playerName,
        rp.position,
        ['DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S', 'IDP'].includes(rp.position?.toUpperCase() ?? ''),
      )
      return NextResponse.json({ ok: true, record })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    leagueId?: string
    rosterId?: string
    playerId?: string
    playerName?: string
    position?: string
    isDefensive?: boolean
    salary?: number
    contractYears?: number
    acquisitionMethod?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const leagueId = body.leagueId?.trim()
  const rosterId = body.rosterId?.trim()
  const playerId = body.playerId?.trim()
  const playerName = body.playerName?.trim() ?? 'Player'
  const position = body.position?.trim() ?? 'FLEX'
  const salary = body.salary
  const contractYears = body.contractYears ?? 1
  const acquisitionMethod = body.acquisitionMethod?.trim() ?? 'commissioner'

  if (!leagueId || !rosterId || !playerId || salary == null || !Number.isFinite(salary)) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  // Setting a salary is the commissioner's (it defaults to acquisitionMethod 'commissioner'); a manager setting their
  // own players' salaries would set them to $1.
  const refused = await commissionerAccessResponse(leagueId, userId, 'rosters')
  if (refused) return refused

  try {
    const record = await assignDraftSalary(
      leagueId,
      rosterId,
      playerId,
      playerName,
      position,
      Boolean(body.isDefensive),
      'manual',
      salary,
      contractYears,
      acquisitionMethod,
    )
    return NextResponse.json({ ok: true, record })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

