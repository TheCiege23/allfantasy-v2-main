import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { getCachedSleeperUserId, setCachedSleeperUserId } from '@/lib/league/sleeper-user-cache'
import { expandStarterSlots } from '@/lib/league/lineup-expand-template'
import { evaluateLineupLock } from '@/lib/league/lineup-lock'
import { resolveFullLineupLockContext } from '@/lib/roster-lineup-engine/lineupLockService'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'

const SLEEPER = 'https://api.sleeper.app/v1' // db-first-exception: base URL constant, fetch calls use template literals
const CACHE = { next: { revalidate: 300 } } as const

type SleeperUser = {
  user_id?: string
  display_name?: string
  avatar?: string
  metadata?: { team_name?: string } | null
}

type SleeperRoster = {
  roster_id?: number
  owner_id?: string
  players?: string[]
  starters?: string[]
  reserve?: string[]
  taxi?: string[]
  picks?: unknown[]
  settings?: {
    wins?: number
    losses?: number
    ties?: number
    fpts?: number
    fpts_decimal?: number
    waiver_budget_used?: number
    waiver_position?: number
  }
}

function weekFromLeagueSettings(settings: unknown): number {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 1
  const o = settings as Record<string, unknown>
  const w = o.currentWeek ?? o.current_week ?? o.week
  if (typeof w === 'number' && Number.isFinite(w)) return Math.max(1, w)
  if (typeof w === 'string') {
    const n = parseInt(w, 10)
    return Number.isFinite(n) ? Math.max(1, n) : 1
  }
  return 1
}

function teamNameFromMetadata(metadata: SleeperUser['metadata']): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const tn = (metadata as { team_name?: string }).team_name
  return typeof tn === 'string' ? tn : null
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string; name?: string | null; email?: string | null }
  } | null
  const sessionUser = session?.user
  if (!sessionUser?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sessionUserId = sessionUser.id
  const { searchParams } = new URL(req.url)
  const leagueId = searchParams?.get('leagueId')
  const requestedUserId = searchParams?.get('userId')

  if (!leagueId) {
    return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  }

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      id: true,
      userId: true,
      platform: true,
      platformLeagueId: true,
      settings: true,
      sport: true,
      leagueVariant: true,
      season: true,
      lifecycleState: true,
      lockAllMoves: true,
    },
  })

  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  let targetUserId = sessionUserId
  if (
    requestedUserId &&
    (requestedUserId === sessionUserId || league.userId === sessionUserId)
  ) {
    targetUserId = requestedUserId
  }

  if (league.platform !== 'sleeper') {
    // Self-heal: if the league's draft is completed but post-draft
    // finalization artifacts haven't been written to `Roster.playerData`
    // yet (e.g. the route that normally fires this — `/draft/events` or
    // `/draft/session` — was never hit before the user navigated to the
    // dashboard), run the throttled finalization here. The throttle (60s
    // success window) means dashboard reloads within the window skip the
    // re-run; the first read after a completed draft pays the heal cost
    // once, then the dashboard renders the materialized roster. Failures
    // are swallowed by the throttled wrapper and `Roster.playerData.draftPicks`
    // already provides a read-side fallback inside
    // `buildLineupListsFromPlayerData`, so a heal failure does NOT leave
    // the dashboard empty.
    try {
      const { syncPostDraftArtifactsIfCompletedThrottled } = await import(
        '@/lib/live-draft-engine/postDraftFinalizeArtifacts'
      )
      await syncPostDraftArtifactsIfCompletedThrottled(leagueId)
    } catch {
      // Non-fatal: the helper already swallows + logs; this catch is
      // belt-and-suspenders if the dynamic import itself fails.
    }

    const roster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: targetUserId },
    })

    if (!roster) {
      return NextResponse.json({ error: 'Roster not found' }, { status: 404 })
    }

    const leagueSport = (league.sport as string) || 'NFL'
    const leagueVariant = (league.leagueVariant as string | null) ?? null
    const formatType = getFormatTypeForVariant(leagueSport, leagueVariant ?? undefined)

    let slotLimits: Record<'starters' | 'bench' | 'ir' | 'taxi' | 'devy', number> | null = null
    let starterAllowedPositions: string[] = []
    let rosterTemplateId: string | null = null
    let starterSlots: ReturnType<typeof expandStarterSlots> = []
    try {
      const template = await getRosterTemplateForLeague(
        leagueSport as never,
        formatType,
        leagueId,
      )
      rosterTemplateId = template.templateId
      starterSlots = expandStarterSlots(template)
      slotLimits = {
        starters: template.slots.reduce((sum, slot) => sum + (slot.starterCount ?? 0), 0),
        bench: template.slots.reduce((sum, slot) => sum + (slot.benchCount ?? 0), 0),
        ir: template.slots.reduce((sum, slot) => sum + (slot.reserveCount ?? 0), 0),
        taxi: template.slots.reduce((sum, slot) => sum + (slot.taxiCount ?? 0), 0),
        devy: template.slots.reduce((sum, slot) => sum + (slot.devyCount ?? 0), 0),
      }
      starterAllowedPositions = [
        ...new Set(
          template.slots
            .filter((slot) => slot.starterCount > 0)
            .flatMap((slot) => slot.allowedPositions ?? []),
        ),
      ]
    } catch {
      // Template hydration failure should not block base roster rendering.
    }

    const leagueWeek = weekFromLeagueSettings(league.settings)
    const lockCtx = await resolveFullLineupLockContext({
      leagueId,
      rosterId: roster.id,
      sport: leagueSport,
      leagueVariant,
      settings: league.settings,
      leagueWeek,
      editingWeek: leagueWeek,
      season: league.season ?? new Date().getFullYear(),
      now: new Date(),
      playerData: roster.playerData,
      lockAllMoves: league.lockAllMoves,
      lifecycleState: league.lifecycleState,
    })

    let unifiedRoster: UnifiedPlayerWireDto[] = []
    try {
      const { getNormalizedPlayerData } = await import('@/lib/player-data/getNormalizedPlayerData')
      const { serializeUnifiedPlayerForApi } = await import('@/lib/player-data/serializeUnifiedPlayerForApi')
      const { soccerLeagueHintFromLeagueSettings } = await import('@/lib/player-data/leagueSoccerLeagueHint')
      const { resolveIncludePlayerDataDiagnostics, logPrefixForSurface } = await import(
        '@/lib/player-data/providerFallbackDiagnostics'
      )
      const diag = resolveIncludePlayerDataDiagnostics(req.nextUrl.searchParams)
      const rows = await getNormalizedPlayerData({
        surface: 'roster',
        leagueId,
        userId: targetUserId,
        limit: 200,
        soccerLeague: soccerLeagueHintFromLeagueSettings(league.settings) ?? undefined,
        includeProviderFallbackDiagnostics: diag,
      })
      unifiedRoster = rows.map(serializeUnifiedPlayerForApi)
      if (diag && process.env.NODE_ENV === 'development') {
        for (const row of rows.slice(0, 5)) {
          const d = row.providerFallbackDiagnostics
          if (d) console.info(logPrefixForSurface('roster', d))
        }
      }
    } catch {
      unifiedRoster = []
    }

    return NextResponse.json({
      source: 'db' as const,
      rosterId: roster.id,
      roster: roster.playerData,
      unifiedRoster,
      faabRemaining: roster.faabRemaining,
      waiverPriority: roster.waiverPriority ?? null,
      sport: leagueSport,
      leagueVariant,
      formatType: formatType ?? null,
      slotLimits,
      starterAllowedPositions,
      rosterTemplateId,
      leagueWeek,
      maxWeek: 18,
      starterSlots,
      lineupLock: {
        locked: lockCtx.locked,
        reason: lockCtx.reason,
        policy: lockCtx.policy,
        lockedPlayerIds: lockCtx.lockedPlayerIds,
        perPlayerReasons: lockCtx.perPlayerReasons,
      },
      canEditLineup: !lockCtx.locked,
      lineupLockHelp: lockCtx.reason,
    })
  }

  const platformLeagueId = league.platformLeagueId
  if (!platformLeagueId) {
    return NextResponse.json({ error: 'League missing platform id' }, { status: 400 })
  }

  const [rostersRes, usersRes, leagueRes] = await Promise.all([
    fetch(`${SLEEPER}/league/${encodeURIComponent(platformLeagueId)}/rosters`, CACHE),
    fetch(`${SLEEPER}/league/${encodeURIComponent(platformLeagueId)}/users`, CACHE),
    fetch(`${SLEEPER}/league/${encodeURIComponent(platformLeagueId)}`, CACHE),
  ])

  if (!rostersRes.ok || !usersRes.ok) {
    return NextResponse.json(
      { error: 'Failed to load Sleeper league data' },
      { status: 502 },
    )
  }

  const rosters = (await rostersRes.json()) as SleeperRoster[]
  const sleeperLeagueUsers = (await usersRes.json()) as SleeperUser[]
  const sleeperLeagueMeta =
    leagueRes.ok && leagueRes.headers.get('content-type')?.includes('json')
      ? ((await leagueRes.json()) as Record<string, unknown>)
      : null

  const settingsJson = (league.settings as Record<string, unknown> | null) ?? {}
  const rosterPositionsFromDb = settingsJson.roster_positions
  const rosterPositionsFromSleeper = sleeperLeagueMeta?.roster_positions
  const rosterPositions = Array.isArray(rosterPositionsFromSleeper)
    ? (rosterPositionsFromSleeper as string[])
    : Array.isArray(rosterPositionsFromDb)
      ? (rosterPositionsFromDb as string[])
      : []

  const [profile, appUser, leagueTeam] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId: targetUserId },
      select: { sleeperUserId: true, sleeperUsername: true },
    }),
    prisma.appUser.findUnique({
      where: { id: targetUserId },
      select: { username: true, displayName: true },
    }),
    prisma.leagueTeam.findFirst({
      where: { leagueId, claimedByUserId: targetUserId },
      select: { platformUserId: true },
    }),
  ])

  let sleeperOwnerId: string | null = profile?.sleeperUserId?.trim() || null
  if (!sleeperOwnerId) {
    sleeperOwnerId = getCachedSleeperUserId(targetUserId) ?? null
  }
  if (!sleeperOwnerId && leagueTeam?.platformUserId) {
    sleeperOwnerId = leagueTeam.platformUserId
  }
  if (!sleeperOwnerId) {
    const username =
      profile?.sleeperUsername?.trim() || appUser?.username?.trim() || null
    if (username) {
      const ures = await fetch(
        `${SLEEPER}/user/${encodeURIComponent(username)}`,
        CACHE,
      )
      if (ures.ok) {
        const u = (await ures.json()) as { user_id?: string }
        if (u?.user_id) {
          sleeperOwnerId = String(u.user_id)
          setCachedSleeperUserId(targetUserId, sleeperOwnerId)
        }
      }
    }
  }

  if (!sleeperOwnerId && Array.isArray(sleeperLeagueUsers)) {
    const fromDisplay = (appUser?.displayName ?? sessionUser.name ?? '').trim().toLowerCase()
    if (fromDisplay) {
      const match = sleeperLeagueUsers.find(
        (su) => String(su.display_name ?? '').trim().toLowerCase() === fromDisplay,
      )
      if (match?.user_id) sleeperOwnerId = String(match.user_id)
    }
  }

  if (!sleeperOwnerId && Array.isArray(sleeperLeagueUsers) && sessionUser.email) {
    const emailLocal = sessionUser.email.split('@')[0]?.toLowerCase() ?? ''
    const emailLower = sessionUser.email.toLowerCase()
    if (emailLocal) {
      const match = sleeperLeagueUsers.find((su) => {
        const dn = String(su.display_name ?? '').trim().toLowerCase()
        return dn === emailLocal || dn === emailLower
      })
      if (match?.user_id) sleeperOwnerId = String(match.user_id)
    }
  }

  const rosterList = Array.isArray(rosters) ? rosters : []
  const matched =
    sleeperOwnerId != null
      ? rosterList.find((r) => String(r.owner_id) === String(sleeperOwnerId))
      : undefined

  const users: Record<
    string,
    { display_name: string; avatar: string | null; team_name: string | null }
  > = {}
  if (Array.isArray(sleeperLeagueUsers)) {
    for (const u of sleeperLeagueUsers) {
      const oid = u.user_id != null ? String(u.user_id) : null
      if (!oid) continue
      users[oid] = {
        display_name: String(u.display_name ?? ''),
        avatar: u.avatar != null ? String(u.avatar) : null,
        team_name: teamNameFromMetadata(u.metadata),
      }
    }
  }

  const leagueWeekEarly = weekFromLeagueSettings(league.settings)
  const lockEarly = evaluateLineupLock({
    sport: String(league.sport ?? 'NFL'),
    now: new Date(),
    leagueWeek: leagueWeekEarly,
    editingWeek: leagueWeekEarly,
  })

  if (!matched) {
    return NextResponse.json({
      source: 'sleeper' as const,
      roster: null,
      ownerId: sleeperOwnerId,
      users,
      rosterPositions,
      allRosters: rosterList,
      leagueWeek: leagueWeekEarly,
      maxWeek: 18,
      lineupLock: lockEarly,
      canEditLineup: false,
      lineupLockHelp:
        'Lineups for Sleeper leagues are managed in the Sleeper app. This view is read-only in AllFantasy.',
    })
  }

  const leagueWeek = leagueWeekEarly
  const lock = lockEarly

  const s = matched.settings ?? {}
  const rosterPayload = {
    roster_id: matched.roster_id ?? 0,
    starters: (matched.starters ?? []).map(String),
    players: (matched.players ?? []).map(String),
    reserve: (matched.reserve ?? []).map(String),
    taxi: (matched.taxi ?? []).map(String),
    picks: matched.picks ?? [],
    settings: {
      wins: Number(s.wins ?? 0),
      losses: Number(s.losses ?? 0),
      ties: Number(s.ties ?? 0),
      fpts: Number(s.fpts ?? 0),
      fpts_decimal: Number(s.fpts_decimal ?? 0),
      waiver_budget_used: Number(s.waiver_budget_used ?? 0),
      waiver_position: Number(s.waiver_position ?? 0),
    },
  }

  return NextResponse.json({
    source: 'sleeper' as const,
    roster: rosterPayload,
    ownerId: String(matched.owner_id ?? sleeperOwnerId ?? ''),
    users,
    rosterPositions,
    leagueWeek,
    maxWeek: 18,
    lineupLock: lock,
    canEditLineup: false,
    lineupLockHelp:
      'Lineups for Sleeper leagues are managed in the Sleeper app. This view is read-only in AllFantasy.',
  })
}

