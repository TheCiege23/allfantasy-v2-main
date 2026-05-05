import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { resolveDashboardAvatarUrl } from '@/lib/dashboard/resolve-dashboard-avatar'
import { LeagueShell } from './LeagueShell'
import type { LeagueSeasonSnapshot } from '@/lib/league/sort-teams-standings'
import { buildLeagueDashboardView } from '@/lib/league/league-dashboard-view'
import type { LeagueDashboardView } from './league-dashboard-types'
import { resolveTournamentDestinationFromLeagueSettings } from '@/lib/dashboard/league-list-destination'
import DashboardUnavailableState from '@/components/dashboard/DashboardUnavailableState'
import {
    createDashboardRuntimeIssue,
    getDashboardMissingEnvVars,
    getDashboardRuntimeIssue,
} from '@/lib/dashboard/runtime-issues'
import { isAppRouterRedirectError } from '@/lib/next/is-app-router-redirect-error'

export const dynamic = 'force-dynamic'

export default async function LeaguePage({
    params,
    searchParams,
}: {
    params: Promise<{ leagueId: string }>
    searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
    const missingEnvVars = getDashboardMissingEnvVars()
    if (missingEnvVars.length > 0) {
          const issue = createDashboardRuntimeIssue(missingEnvVars)
          return (
                  <DashboardUnavailableState
                            title={issue.title}
                            message={issue.message}
                            missing={issue.missing}
                          />
                )
    }

  const { leagueId } = await params
    const sp = searchParams ? await searchParams : {}
        const zc = sp.zombieChimmy
    const zombieChimmyPrefill = typeof zc === 'string' ? zc : Array.isArray(zc) ? zc[0] ?? null : null
    const embedRaw = sp.embed
    const embedMode =
          embedRaw === '1' ||
          embedRaw === 'true' ||
          (Array.isArray(embedRaw) && (embedRaw[0] === '1' || embedRaw[0] === 'true'))

  let session: {
        user?: { id?: string; name?: string | null; email?: string | null; image?: string | null }
  } | null
    try {
          session = (await getServerSession(authOptions as never)) as typeof session
    } catch (error) {
          console.error('[league] getServerSession failed:', error)
          return (
                  <DashboardUnavailableState
                            title="League page temporarily unavailable"
                            message="We couldn't verify your session. Please sign in again or try again in a moment."
                          />
                )
    }

  if (!session?.user?.id) {
        const leaguePath = embedMode ? `/league/${leagueId}?embed=1` : `/league/${leagueId}`
        redirect(`/login?callbackUrl=${encodeURIComponent(leaguePath)}`)
  }

  const userId = session.user.id

  const defaultLeagueDashboardView: LeagueDashboardView = {
        settingsRows: [],
        standings: { mode: 'standard' },
        scoring: null,
  }

  try {
        let league = await prisma.league
          .findFirst({
                    where: { id: leagueId },
                    include: {
                                teams: { orderBy: { externalId: 'asc' } },
                                rosters: {
                                              select: { platformUserId: true, faabRemaining: true, waiverPriority: true },
                                },
                                invites: {
                                              where: { isActive: true },
                                              orderBy: { createdAt: 'desc' },
                                              take: 1,
                                },
                    },
          })
          .catch((err) => {
                    console.error('[league page] league lookup failed', { leagueId, err })
                    return null
          })

      // My Leagues may use `SleeperLeague.id` when no unified `League` row exists yet — resolve to canonical League.
      if (!league) {
              const sleeperOnly = await prisma.sleeperLeague
                .findFirst({
                            where: { id: leagueId, userId },
                            select: { sleeperLeagueId: true },
                })
                .catch((err) => {
                            console.error('[league page] sleeperLeague lookup failed', { leagueId, err })
                            return null
                })

          if (sleeperOnly?.sleeperLeagueId) {
                    const unified = await prisma.league
                      .findFirst({
                                    where: {
                                                    platform: 'sleeper',
                                                    platformLeagueId: sleeperOnly.sleeperLeagueId,
                                                    userId,
                                    },
                                    orderBy: { season: 'desc' },
                                    select: { id: true },
                      })
                      .catch((err) => {
                                    console.error('[league page] unified league resolve failed', { leagueId, err })
                                    return null
                      })

                if (unified?.id && unified.id !== leagueId) {
                            redirect(`/league/${unified.id}`)
                }
          }

          redirect('/dashboard')
      }

      // Redirect tournament hub / feeder leagues to tournament home (same rules as My Leagues list links)
      const leagueSettings =
              league.settings && typeof league.settings === 'object'
            ? (league.settings as Record<string, unknown>)
                : {}
            const tournamentHref = resolveTournamentDestinationFromLeagueSettings(leagueSettings)
        if (tournamentHref) {
                redirect(tournamentHref)
        }

      const sleeperCommissionerId =
              league.platform === 'sleeper' && typeof leagueSettings.commissioner_id === 'string'
            ? leagueSettings.commissioner_id
                : null

      let draftDateIso: string | null = null
        const draftDateCandidate =
                leagueSettings.draftDate ??
                leagueSettings.draft_date ??
                leagueSettings.draft_at ??
                leagueSettings.draft_start_time ??
                null
        if (typeof draftDateCandidate === 'string' && draftDateCandidate.trim()) {
                const parsed = Date.parse(draftDateCandidate)
                if (Number.isFinite(parsed)) {
                          draftDateIso = new Date(parsed).toISOString()
                }
        } else if (typeof draftDateCandidate === 'number' && Number.isFinite(draftDateCandidate)) {
                const ms = draftDateCandidate > 9_999_999_999 ? draftDateCandidate : draftDateCandidate * 1000
                draftDateIso = new Date(ms).toISOString()
        }

      const isOwner = league.userId === userId
        const userTeam = league.teams.find((t) => t.claimedByUserId === userId) ?? null

      if (!isOwner && !userTeam) {
              redirect('/dashboard')
      }

      const seasonYear = league.season ?? new Date().getFullYear()

      const [role, allLeagues, dbUser, userProfile, leagueSeasonRow, leagueDashboard] =
              await Promise.all([
                        getLeagueRole(leagueId, userId).catch((err) => {
                                    console.error('[league page] getLeagueRole failed', { leagueId, userId, err })
                                    return isOwner ? 'commissioner' : 'member'
                        }),
                        prisma.league
                          .findMany({
                                        where: {
                                                        OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }],
                                        },
                                        orderBy: { updatedAt: 'desc' },
                                        take: 50,
                          })
                          .catch((err) => {
                                        console.error('[league page] allLeagues query failed', { userId, err })
                                        return []
                          }),
                        prisma.appUser
                          .findUnique({
                                        where: { id: userId },
                                        select: { avatarUrl: true },
                          })
                          .catch((err) => {
                                        console.error('[league page] appUser query failed', { userId, err })
                                        return null
                          }),
                        prisma.userProfile
                          .findUnique({
                                        where: { userId },
                                        select: { sleeperUserId: true, discordUserId: true },
                          })
                          .catch((err) => {
                                        console.error('[league page] userProfile query failed', { userId, err })
                                        return null
                          }),
                        prisma.leagueSeason
                          .findUnique({
                                        where: { leagueId_season: { leagueId, season: seasonYear } },
                                        select: { championTeamId: true, teamRecords: true, status: true },
                          })
                          .catch((err) => {
                                        console.error('[league page] leagueSeason query failed', { leagueId, seasonYear, err })
                                        return null
                          }),
                        buildLeagueDashboardView(league).catch((err) => {
                                    console.error('[league page] buildLeagueDashboardView failed', { leagueId, err })
                                    return defaultLeagueDashboardView
                        }),
                      ])

      const isCommissioner = role === 'commissioner' || role === 'co_commissioner'
        const isHeadCommissioner = role === 'commissioner'
        const userImage = resolveDashboardAvatarUrl(session.user.image, dbUser?.avatarUrl)
        const currentSleeperUserId = userProfile?.sleeperUserId ?? null
        const sleeperUsersByPlatformId: Record<string, { display_name: string; avatar: string | null }> =
        {}

              const seasonSnapshot: LeagueSeasonSnapshot | null = leagueSeasonRow
          ? {
                      championTeamId: leagueSeasonRow.championTeamId,
                      teamRecords: leagueSeasonRow.teamRecords,
                      status: leagueSeasonRow.status,
          }
                      : null

      return (
              <div className="flex min-h-0 flex-1 flex-col">
                      <LeagueShell
                                  league={league}
                                  userTeam={userTeam}
                                  isOwner={isOwner}
                                  isCommissioner={isCommissioner}
                                  isHeadCommissioner={isHeadCommissioner}
                                  allLeagues={allLeagues}
                                  userId={userId}
                                  userName={session.user.name ?? session.user.email ?? 'Manager'}
                                  userImage={userImage}
                                  draftDateIso={draftDateIso}
                                  sleeperCommissionerId={sleeperCommissionerId}
                                  sleeperUsersByPlatformId={sleeperUsersByPlatformId}
                                  currentSleeperUserId={currentSleeperUserId}
                                  discordConnected={Boolean(userProfile?.discordUserId)}
                                  zombieChimmyPrefill={zombieChimmyPrefill}
                                  dispersalDraftInProgress={null}
                                  seasonSnapshot={seasonSnapshot}
                                  leagueDashboard={leagueDashboard}
                                  embedMode={embedMode}
                                />
              </div>
            )
  } catch (error) {
        if (isAppRouterRedirectError(error)) {
                throw error
        }
    
        const issue = getDashboardRuntimeIssue(error)
              if (issue) {
                      return (
                                <DashboardUnavailableState
                                            title={issue.title}
                                            message={issue.message}
                                            missing={issue.missing}
                                          />
                              )
              }
    
        console.error('[league] data load failed:', error)
              return (
                      <DashboardUnavailableState
                                title="League page temporarily unavailable"
                                message="We couldn't load this league. Please try again in a moment."
                              />
                    )
  }
}
