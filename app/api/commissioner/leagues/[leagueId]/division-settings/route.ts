/**
 * GET/PUT: Commissioner division settings.
 * Stores division config in League.settings JSON (division_config key).
 * Supports standard divisions (2/4/8) and Survivor tribes.
 * Handles AI naming requests.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { notifyCommissionerChange } from '@/lib/commissioner/CommissionerChangeNotifier'

export const dynamic = 'force-dynamic'

interface DivisionConfig {
  count: number // 0, 2, 4, 8
  names: string[]
  teamAssignments: Record<string, number> // teamId -> divisionIndex (0-based)
  aiNamingEnabled: boolean
  lastUpdatedAt: string | null
  lastUpdatedBy: string | null
}

function defaultConfig(): DivisionConfig {
  return {
    count: 0,
    names: [],
    teamAssignments: {},
    aiNamingEnabled: false,
    lastUpdatedAt: null,
    lastUpdatedBy: null,
  }
}

function defaultNames(count: number, isSurvivor: boolean): string[] {
  const label = isSurvivor ? 'Tribe' : 'Division'
  return Array.from({ length: count }, (_, i) => `${label} ${i + 1}`)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  /*
   * 🛑 MEMBER GATE. This GET returned the league to ANY signed-in user. It
   * computed the commissioner flag and handed it back as a FIELD for the UI to
   * branch on, and never refused on it — so naming any leagueId returned that
   * league's settings and team list, owner names included.
   *
   * ⚠ MEMBER-LEVEL, NOT COMMISSIONER-LEVEL, AND THAT IS LOAD-BEARING.
   * `LeagueDuesTrackerPanel` and `RosterSettingsEditor` fetch this, read
   * `isCommissioner` off the response, and render READ-ONLY for ordinary
   * members. Gating at commissioner level would close the hole and break every
   * non-commissioner in the league. The write handlers keep their own stricter
   * check; this one only has to exclude non-members.
   *
   * ⚠ BEFORE THE READ, not after. `resolveLeagueMembership` is the four-path
   * canonical predicate (owner, RedraftLeagueMember, roster-backed, claimed
   * team) and returns 401/404/403 itself, so a missing league and a league that
   * is not yours stay indistinguishable to the caller.
   */
  const membership = await resolveLeagueMembership(leagueId, session.user.id)
  if (!membership.ok) {
    return NextResponse.json(
      { error: membership.status === 404 ? 'Not found' : 'Forbidden' },
      { status: membership.status },
    )
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      userId: true,
      sport: true,
      settings: true,
      leagueVariant: true,
      teams: {
        select: {
          id: true,
          teamName: true,
          ownerName: true,
          avatarUrl: true,
          wins: true,
          losses: true,
          platformUserId: true,
          isCommissioner: true,
          isCoCommissioner: true,
          isOrphan: true,
          role: true,
        },
      },
    },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const raw = settings.division_config as DivisionConfig | undefined
  const config: DivisionConfig = raw ?? defaultConfig()
  const isSurvivor = (league.leagueVariant ?? '').toLowerCase().includes('survivor')
    || (settings.league_type as string ?? '').toLowerCase().includes('survivor')
    || (settings.leagueType as string ?? '').toLowerCase().includes('survivor')

  return NextResponse.json({
    config,
    isCommissioner: league.userId === session.user.id,
    isSurvivor,
    sport: league.sport,
    leagueVariant: league.leagueVariant,
    teams: league.teams,
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, settings: true, leagueVariant: true, teams: { select: { id: true, teamName: true, ownerName: true, avatarUrl: true } } },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.userId !== session.user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const currentSettings = (league.settings as Record<string, unknown>) ?? {}
  const existing = (currentSettings.division_config as DivisionConfig | undefined) ?? defaultConfig()

  const count = typeof body.count === 'number' && [0, 2, 4, 8].includes(body.count) ? body.count : existing.count
  const names = Array.isArray(body.names) ? body.names.map((n: unknown) => String(n ?? '').slice(0, 80)) : existing.names
  const teamAssignments = (typeof body.teamAssignments === 'object' && body.teamAssignments !== null)
    ? body.teamAssignments as Record<string, number>
    : existing.teamAssignments
  const aiNamingEnabled = typeof body.aiNamingEnabled === 'boolean' ? body.aiNamingEnabled : existing.aiNamingEnabled

  // If count changed, reset names to defaults if names array doesn't match
  const isSurvivor = (league.leagueVariant ?? '').toLowerCase().includes('survivor')
    || (currentSettings.league_type as string ?? '').toLowerCase().includes('survivor')
    || (currentSettings.leagueType as string ?? '').toLowerCase().includes('survivor')

  const finalNames = names.length === count ? names : defaultNames(count, isSurvivor)

  const updatedConfig: DivisionConfig = {
    count,
    names: finalNames,
    teamAssignments: count === 0 ? {} : teamAssignments,
    aiNamingEnabled,
    lastUpdatedAt: new Date().toISOString(),
    lastUpdatedBy: session.user.id,
  }

  await prisma.league.update({
    where: { id: leagueId },
    data: {
      settings: toPrismaJsonInput({
        ...currentSettings,
        division_config: updatedConfig,
        // Also write num_divisions for backward compat
        num_divisions: count,
      }),
    },
  })

  // Notify league chat of division changes
  const changes: { field: string; oldValue: string; newValue: string }[] = []
  if (existing.count !== updatedConfig.count) {
    const label = isSurvivor ? 'Tribes' : 'Divisions'
    changes.push({ field: `Number of ${label}`, oldValue: String(existing.count || 'None'), newValue: String(updatedConfig.count || 'None') })
  }
  if (JSON.stringify(existing.names) !== JSON.stringify(updatedConfig.names) && updatedConfig.count > 0) {
    const label = isSurvivor ? 'Tribe' : 'Division'
    changes.push({ field: `${label} Names`, oldValue: existing.names.join(', ') || '(none)', newValue: updatedConfig.names.join(', ') })
  }
  if (changes.length > 0) {
    await notifyCommissionerChange(leagueId, session.user.id, isSurvivor ? 'Tribe Settings' : 'Division Settings', changes).catch(() => {})
  }

  return NextResponse.json({
    ok: true,
    config: updatedConfig,
    teams: league.teams,
    isSurvivor,
  })
}
