/**
 * GET/PUT: which schools a college league drafts from (lib/college/conferenceScope.ts).
 *
 * GET is open to anyone who can view the league, so every manager can see the pool's rules; PUT is the
 * commissioner's (league setup scope), honours the settings lock, and clears the league's draft-pool
 * caches so the next board is built from the new set of schools.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { canAccessLeague } from '@/lib/draft/access'
import { settingsLockedResponse } from '@/lib/league/settingsLockGuard'
import { invalidateLeagueDraftCaches } from '@/lib/league/invalidateLeagueDraftCaches'
import { loadCollegeTeamConferences } from '@/lib/college/collegeTeamConferences'
import { isDevyLeague } from '@/lib/devy'
import { isC2CLeague } from '@/lib/merged-devy-c2c'
import {
  COLLEGE_CONFERENCE_SCOPE_KEY,
  collegeScopePresets,
  collegeScopeSportFor,
  type CollegeScopeSport,
  describeCollegeScope,
  isCollegeScopeSport,
  parseCollegeScopeInput,
  readCollegeConferenceScope,
} from '@/lib/college/conferenceScope'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ leagueId: string }> }

/**
 * The college sport this league's scope applies to: a college league's own sport, or the college side
 * of a devy / C2C league (NFL → college football, NBA → college basketball). Null for any other league.
 */
async function scopeSportOf(leagueId: string, leagueSport: string): Promise<CollegeScopeSport | null> {
  if (isCollegeScopeSport(leagueSport)) return leagueSport
  const collegeSport = collegeScopeSportFor(leagueSport)
  if (!collegeSport) return null
  const [devy, c2c] = await Promise.all([isDevyLeague(leagueId).catch(() => false), isC2CLeague(leagueId).catch(() => false)])
  return devy || c2c ? collegeSport : null
}

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const commissioner = await canCommissionerAct(leagueId, userId, 'league')
  if (!commissioner && !(await canAccessLeague(leagueId, userId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, settings: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const sport = await scopeSportOf(leagueId, String(league.sport ?? ''))
  // Pro leagues without a college side: nothing to show, said plainly rather than as an error.
  if (!sport) return NextResponse.json({ applies: false })
  const scope = readCollegeConferenceScope(league.settings, sport)
  const index = await loadCollegeTeamConferences(sport)
  return NextResponse.json({
    applies: true,
    sport,
    /** True for a devy / C2C league: the rule covers its college players only. */
    collegeSide: !isCollegeScopeSport(String(league.sport ?? '')),
    scope: scope ?? { preset: 'all', conferences: [] },
    summary: describeCollegeScope(sport, scope),
    presets: collegeScopePresets(sport),
    conferences: index.conferences,
    isCommissioner: commissioner,
  })
}

export async function PUT(req: NextRequest, { params }: Params) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  if (!(await canCommissionerAct(leagueId, userId, 'league'))) {
    return NextResponse.json({ error: 'Only the commissioner can change the player pool.' }, { status: 403 })
  }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, settings: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const sport = await scopeSportOf(leagueId, String(league.sport ?? ''))
  if (!sport) return NextResponse.json({ error: 'College, devy and C2C leagues only' }, { status: 400 })
  const locked = await settingsLockedResponse(leagueId, 'rosters')
  if (locked) return locked

  const index = await loadCollegeTeamConferences(sport)
  const parsed = parseCollegeScopeInput(sport, await req.json().catch(() => ({})), index.conferences.map((c) => c.conference))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const current = league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
    ? (league.settings as Record<string, unknown>)
    : {}
  const next: Record<string, unknown> = { ...current }
  if (parsed.scope) next[COLLEGE_CONFERENCE_SCOPE_KEY] = parsed.scope
  else delete next[COLLEGE_CONFERENCE_SCOPE_KEY]
  await prisma.league.update({ where: { id: leagueId }, data: { settings: next as never } })
  invalidateLeagueDraftCaches(leagueId)

  return NextResponse.json({
    ok: true,
    scope: parsed.scope ?? { preset: 'all', conferences: [] },
    summary: describeCollegeScope(sport, parsed.scope),
  })
}
