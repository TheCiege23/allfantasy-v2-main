/**
 * POST: a commissioner's contract sheet for a salary cap league imported from another platform.
 *
 * `{ text }` previews: what matched and what could not be read, nothing saved. `{ text, confirm: true }`
 * saves the matched contracts, replacing any earlier upload (only rows this route wrote; a contract
 * created by an auction, bid or extension is never touched). See lib/salary-cap/commissionerContractImport.ts.
 *
 * Imported leagues only. A league AllFantasy hosts creates its contracts through the startup auction.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { getSalaryCapConfig, isSalaryCapLeague } from '@/lib/salary-cap/SalaryCapLeagueConfig'
import { resolveRostersForTeams } from '@/lib/leagues/rosterTeamIdentity'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { logAction } from '@/server/services/auditService'
import {
  COMMISSIONER_IMPORT_SOURCE, contractTotalsByTeam, matchContractSheet, parseContractSheet, yearSignedFor,
  type CapRosterPlayer, type CapTeam,
} from '@/lib/salary-cap/commissionerContractImport'

export const dynamic = 'force-dynamic'

const MAX_TEXT_BYTES = 400_000

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!(await canCommissionerAct(leagueId, userId, 'league'))) {
    return NextResponse.json({ error: 'Only the commissioner can add contracts.' }, { status: 403 })
  }
  if (!(await isSalaryCapLeague(leagueId))) return NextResponse.json({ error: 'Not a salary cap league' }, { status: 404 })

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, sport: true } })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (isNativePlatform(league.platform)) {
    return NextResponse.json({ error: 'Contracts in a league hosted on AllFantasy come from its startup auction, not an upload.' }, { status: 409 })
  }
  const config = await getSalaryCapConfig(leagueId)
  if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 500 })

  const body = (await req.json().catch(() => ({}))) as { text?: unknown; confirm?: unknown }
  const text = typeof body.text === 'string' ? body.text : ''
  if (!text.trim()) return NextResponse.json({ error: 'Paste your contract rows: team, player, salary, years.' }, { status: 400 })
  if (text.length > MAX_TEXT_BYTES) return NextResponse.json({ error: 'That sheet is too large to read in one go.' }, { status: 413 })

  // Teams by the names a commissioner would write, each with the ONE roster the shared rule gives it
  // (lib/leagues/rosterTeamIdentity.ts). A join on the owner key misses the importer's own team, whose
  // roster is keyed by their AllFantasy account, and can land on a dead duplicate row.
  const [allRosters, leagueTeams] = await Promise.all([
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, playerData: true } }),
    prisma.leagueTeam.findMany({ where: { leagueId }, select: { id: true, externalId: true, teamName: true, ownerName: true, platformUserId: true, claimedByUserId: true } }),
  ])
  const rosterByTeam = resolveRostersForTeams(leagueTeams, allRosters, (t) => [t.platformUserId, t.claimedByUserId, t.externalId])
  const rosters: typeof allRosters = []
  const teams: CapTeam[] = []
  for (const t of leagueTeams) {
    const r = rosterByTeam.get(t.externalId)
    if (!r) continue
    rosters.push(r)
    teams.push({ rosterId: r.id, names: [t.teamName, t.ownerName] })
  }
  const sport = String(league.sport ?? 'NFL').toUpperCase()
  const idsByRoster = rosters.map((r) => ({ rosterId: r.id, ids: getRosterPlayerIds(r.playerData) }))
  const allIds = [...new Set(idsByRoster.flatMap((r) => r.ids))]
  const records = allIds.length
    ? await prisma.sportsPlayerRecord.findMany({ where: { id: { in: allIds.map((id) => `${sport}:${id}`) } }, select: { id: true, name: true, position: true } })
    : []
  const recordById = new Map(records.map((p) => [p.id.slice(sport.length + 1), p]))
  const players: CapRosterPlayer[] = idsByRoster.flatMap((r) =>
    r.ids.flatMap((id) => {
      const rec = recordById.get(id)
      return rec ? [{ rosterId: r.rosterId, playerId: id, name: rec.name, position: rec.position ?? null }] : []
    }),
  )

  const parsed = parseContractSheet(text)
  const { matched, problems: unmatched } = matchContractSheet(parsed.rows, teams, players)
  const problems = [...parsed.problems, ...unmatched].sort((a, b) => a.line - b.line)
  const totals = contractTotalsByTeam(matched)
  const preview = {
    matched: matched.map((m) => ({ line: m.line, teamName: m.teamName, playerName: m.playerName, position: m.position, salary: m.salary, yearsTotal: m.yearsTotal, contractYear: m.contractYear })),
    problems,
    totals,
    startupCap: config.startupCap,
  }

  if (body.confirm !== true) return NextResponse.json({ saved: false, ...preview })
  if (matched.length === 0) return NextResponse.json({ error: 'No row matched a team and a player on it, so nothing was saved.', ...preview }, { status: 422 })

  const capYear = new Date().getFullYear()
  const result = await prisma.$transaction(async (tx) => {
    const removed = await tx.playerContract.deleteMany({ where: { configId: config.configId, source: COMMISSIONER_IMPORT_SOURCE } })
    const created = await tx.playerContract.createMany({
      data: matched.map((m) => ({
        leagueId,
        configId: config.configId,
        rosterId: m.rosterId,
        playerId: m.playerId,
        playerName: m.playerName,
        position: m.position,
        salary: m.salary,
        yearsTotal: m.yearsTotal,
        yearSigned: yearSignedFor(capYear, m.contractYear),
        contractYear: m.contractYear,
        status: 'active',
        source: COMMISSIONER_IMPORT_SOURCE,
      })),
    })
    return { replaced: removed.count, saved: created.count }
  })

  void logAction({
    leagueId,
    userId,
    actionType: 'salary_cap_contracts_imported',
    entityType: 'salary_cap',
    entityId: config.configId,
    afterState: { saved: result.saved, replaced: result.replaced, skipped: problems.length },
  }).catch(() => {})

  return NextResponse.json({ saved: true, savedCount: result.saved, replacedCount: result.replaced, ...preview })
}
