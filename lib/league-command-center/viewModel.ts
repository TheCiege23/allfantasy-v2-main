import 'server-only'

/**
 * League Command Center — server-side view-model loader.
 *
 * Single entry point for the route. Everything the shell renders is resolved
 * here, on the server, so that:
 *
 *  - Entitlement is decided server-side (`canAccessForUser`) and never
 *    re-derived on the client. A locked panel must be locked because the server
 *    said so, not because a client hook happened to agree.
 *  - Role comes from the real `getLeagueRole` gate, not from a prop.
 *  - Season phase is a fact read from `RedraftSeason`, not a UI toggle. The
 *    prototype exposes phase as a designer switch; in production it is derived.
 *
 * Failures degrade honestly: a loader that cannot answer contributes a string
 * to `warnings` and leaves its field null, rather than substituting a plausible
 * default that would read as real data.
 */
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { canAccessForUser } from '@/lib/access/canAccessForUser'
import { resolveSeasonLabel, resolveSource } from './capability'
import { availablePreviewRoles } from './adminPreview'
import { resolveAdminRolePreview } from './adminPreviewServer'
import type {
  CommandCenterEntitlement,
  CommandCenterLeagueIdentity,
  CommandCenterRole,
  CommandCenterViewer,
  CommandCenterViewModel,
  SeasonPhase,
} from './types'
import { hasCommissionerAuthority } from './types'

/** Feature keys, resolved once so call sites never hardcode a string. */
export const COMMAND_CENTER_FEATURES = {
  /** Ranked intelligence, projections, comparisons, premium panels. Requires AF Pro. */
  intelligence: 'league_ai_coaching',
  /** Commissioner automation quick actions. Requires the Commissioner plan. */
  commissionerAutomation: 'commissioner_automation',
} as const

// ── Access result ─────────────────────────────────────────────────────────────

export type CommandCenterLoadResult =
  | { status: 'ok'; viewModel: CommandCenterViewModel }
  | { status: 'not_found' }
  | { status: 'not_member' }
  | { status: 'error'; message: string }

// ── Season phase ──────────────────────────────────────────────────────────────

/**
 * Derives the real season phase.
 *
 * `RedraftSeason.status` is the lifecycle column (`setup` → `active` →
 * `complete`); `currentWeek` crossing `playoffStartWeek` is what actually makes
 * a league "in playoffs". Returns `offseason` when no redraft season row exists
 * at all, which is the honest reading — there is no active competition.
 */
export function deriveSeasonPhase(season: {
  status: string | null
  currentWeek: number
  playoffStartWeek: number
} | null): SeasonPhase {
  if (!season) return 'offseason'

  const status = (season.status ?? '').trim().toLowerCase()
  if (status === 'complete') return 'offseason'
  if (status === 'setup' || status === 'draft' || status === 'drafting') return 'preseason'

  if (season.currentWeek <= 0) return 'preseason'
  if (season.playoffStartWeek > 0 && season.currentWeek >= season.playoffStartWeek) {
    return 'playoffs'
  }
  return 'in_season'
}

// ── Role ──────────────────────────────────────────────────────────────────────

/**
 * Narrows the app-wide `LeagueRole` to the Command Center's render role.
 *
 * `viewer` collapses to `manager`: a viewer sees the same layers a manager
 * does, and every write control is separately gated on real capability anyway,
 * so collapsing here cannot grant an action.
 */
function toCommandCenterRole(role: Awaited<ReturnType<typeof getLeagueRole>>): CommandCenterRole | null {
  switch (role) {
    case 'commissioner':
      return 'commissioner'
    case 'co_commissioner':
      return 'co_commissioner'
    case 'member':
    case 'viewer':
      return 'manager'
    default:
      return null
  }
}

// ── Scoring label ─────────────────────────────────────────────────────────────

function resolveScoringLabel(input: {
  scoring: string | null
  isDynasty: boolean
}): string {
  const scoring = input.scoring?.trim()
  const prefix = input.isDynasty ? 'Dynasty' : null

  if (!scoring) {
    // Never invent a format. "Full PPR" on a league that is actually standard
    // would silently misinform every downstream valuation the user reads.
    return prefix ? `${prefix} · Scoring unavailable` : 'Scoring unavailable'
  }
  return prefix ? `${prefix} · ${scoring}` : scoring
}

// ── Loader ────────────────────────────────────────────────────────────────────

export interface LoadCommandCenterInput {
  leagueId: string
  userId: string
  email?: string | null
  /**
   * Raw `?viewAs=` value. Honoured only for a server-verified site admin, and
   * only to NARROW the role — see `adminPreview.ts`.
   */
  requestedViewAs?: string | null
  now?: Date
}

export async function loadCommandCenterViewModel(
  input: LoadCommandCenterInput,
): Promise<CommandCenterLoadResult> {
  const { leagueId, userId } = input
  const now = input.now ?? new Date()
  const warnings: string[] = []

  const league = await prisma.league
    .findFirst({
      where: { id: leagueId },
      select: {
        id: true,
        userId: true,
        name: true,
        sport: true,
        season: true,
        platform: true,
        platformLeagueId: true,
        scoring: true,
        rosterSize: true,
        logoUrl: true,
        avatarUrl: true,
        settings: true,
        lastSyncedAt: true,
        tradeDeadlineWeek: true,
        playoffTeams: true,
        teams: {
          select: {
            id: true,
            teamName: true,
            ownerName: true,
            wins: true,
            losses: true,
            ties: true,
            currentRank: true,
            claimedByUserId: true,
            isCommissioner: true,
            isCoCommissioner: true,
          },
          orderBy: { externalId: 'asc' },
        },
      },
    })
    .catch((error) => {
      console.error('[command-center] league lookup failed', { leagueId, error })
      return null
    })

  if (!league) return { status: 'not_found' }

  const isOwner = league.userId === userId
  const userTeam = league.teams.find((t) => t.claimedByUserId === userId) ?? null
  if (!isOwner && !userTeam) return { status: 'not_member' }

  const [rawRole, redraftSeason, leagueSeasonRow] = await Promise.all([
    getLeagueRole(leagueId, userId).catch((error) => {
      console.error('[command-center] getLeagueRole failed', { leagueId, userId, error })
      return null
    }),
    prisma.redraftSeason
      .findFirst({
        where: { leagueId },
        orderBy: { season: 'desc' },
        select: { status: true, currentWeek: true, playoffStartWeek: true, totalWeeks: true },
      })
      .catch((error) => {
        console.error('[command-center] redraftSeason lookup failed', { leagueId, error })
        return null
      }),
    prisma.leagueSeason
      .findFirst({
        where: { leagueId },
        orderBy: { season: 'desc' },
        select: { isDynasty: true, scoringFormat: true },
      })
      .catch(() => null),
  ])

  // Owner-without-role is a real state (league created but no team claimed yet).
  // Fall back to commissioner only when the viewer genuinely owns the row.
  const realRole = toCommandCenterRole(rawRole) ?? (isOwner ? 'commissioner' : null)
  if (!realRole) return { status: 'not_member' }

  if (!rawRole && isOwner) {
    warnings.push('Your commissioner role was inferred from league ownership — no claimed team was found.')
  }

  // Admin preview is downgrade-only and gated on a server-verified site admin.
  // `role` below is the EFFECTIVE role; every layer/entitlement decision keys off
  // it, and it can never exceed `realRole`.
  const preview = await resolveAdminRolePreview({
    realRole,
    requestedRole: input.requestedViewAs ?? null,
  })
  const role = preview.effectiveRole

  if (preview.deniedElevation) {
    warnings.push(
      `Preview as ${preview.deniedElevation.replace('_', '-')} was not applied — a preview can only ` +
        'show a narrower role than you actually hold in this league.',
    )
  }

  const returnTo = `/league/${leagueId}/command-center`
  const [intelligence, commandCenterTab] = await Promise.all([
    canAccessForUser(COMMAND_CENTER_FEATURES.intelligence, {
      userId,
      email: input.email ?? null,
      returnTo,
    }),
    canAccessForUser(COMMAND_CENTER_FEATURES.intelligence, {
      userId,
      email: input.email ?? null,
      returnTo,
    }),
  ])

  const entitlement: CommandCenterEntitlement = { intelligence, commandCenterTab }

  const settings =
    league.settings && typeof league.settings === 'object'
      ? (league.settings as Record<string, unknown>)
      : null

  const source = resolveSource({
    provider: league.platform,
    isCommissioner: hasCommissionerAuthority(role),
    settings,
    lastSyncedAt: league.lastSyncedAt,
    now,
  })

  const seasonPhase = deriveSeasonPhase(redraftSeason)
  if (!redraftSeason) {
    warnings.push('No active season was found for this league — week-scoped panels are unavailable.')
  }

  const commissionerTeam =
    league.teams.find((t) => t.isCommissioner) ??
    league.teams.find((t) => t.isCoCommissioner) ??
    null

  const seasonLabel = resolveSeasonLabel(league.season)

  const identity: CommandCenterLeagueIdentity = {
    leagueId: league.id,
    name: league.name?.trim() || 'Untitled league',
    sport: String(league.sport),
    seasonLabel: seasonLabel ?? 'Season unavailable',
    logoUrl: league.logoUrl?.trim() || league.avatarUrl?.trim() || null,
    managerCount: league.teams.length,
    commissionerName: commissionerTeam?.ownerName?.trim() || null,
    currentWeek:
      redraftSeason && redraftSeason.currentWeek > 0 ? redraftSeason.currentWeek : null,
    scoringFormatLabel: resolveScoringLabel({
      scoring: league.scoring ?? leagueSeasonRow?.scoringFormat ?? null,
      isDynasty: leagueSeasonRow?.isDynasty ?? false,
    }),
    rosterSize: league.rosterSize ?? null,
    playoffFormatLabel: (() => {
      const weeks =
        redraftSeason && redraftSeason.playoffStartWeek > 0 && redraftSeason.totalWeeks > 0
          ? `Weeks ${redraftSeason.playoffStartWeek}-${redraftSeason.totalWeeks}`
          : null
      const teams =
        typeof league.playoffTeams === 'number' && league.playoffTeams > 0
          ? `Top ${league.playoffTeams}`
          : null
      if (teams && weeks) return `${teams} · ${weeks}`
      return teams ?? weeks
    })(),
    // Real column. Null renders as "—" rather than a fabricated deadline,
    // which managers would plan trades around.
    tradeDeadlineLabel:
      typeof league.tradeDeadlineWeek === 'number' && league.tradeDeadlineWeek > 0
        ? `Week ${league.tradeDeadlineWeek}`
        : null,
  }

  const viewer: CommandCenterViewer = {
    userId,
    role,
    isCommissioner: hasCommissionerAuthority(role),
    teamId: userTeam?.id ?? null,
    teamName: userTeam?.teamName?.trim() || null,
    record: userTeam
      ? { wins: userTeam.wins, losses: userTeam.losses, ties: userTeam.ties }
      : null,
    standingsPosition: userTeam?.currentRank ?? null,
  }

  if (!userTeam && isOwner) {
    warnings.push('You have not claimed a team in this league, so personal panels are limited.')
  }

  return {
    status: 'ok',
    viewModel: {
      league: identity,
      source,
      viewer,
      adminPreview: {
        isAdmin: preview.isAdmin,
        realRole: preview.realRole,
        previewActive: preview.previewActive,
        availableRoles: preview.isAdmin ? availablePreviewRoles(preview.realRole) : [],
        deniedElevation: preview.deniedElevation,
      },
      seasonPhase,
      entitlement,
      warnings,
      generatedAt: now.toISOString(),
    },
  }
}
