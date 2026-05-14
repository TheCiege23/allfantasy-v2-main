import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { resolveDashboardAvatarUrl } from '@/lib/dashboard/resolve-dashboard-avatar'
import type { LeagueSeasonSnapshot } from '@/lib/league/sort-teams-standings'
import { buildLeagueDashboardView } from '@/lib/league/league-dashboard-view'
import type { LeagueDashboardView } from './league-dashboard-types'
import { resolveTournamentDestinationFromLeagueSettings } from '@/lib/dashboard/league-list-destination'
import { normalizeOpenChatQueryParam } from '@/lib/dashboard/open-chat-query'
import { isPostCreateLeagueShellHandoff } from '@/lib/league/post-create-navigation'
import DashboardUnavailableState from '@/components/dashboard/DashboardUnavailableState'
import {
    createDashboardRuntimeIssue,
    getDashboardMissingEnvVars,
    getDashboardRuntimeIssue,
} from '@/lib/dashboard/runtime-issues'
import { isAppRouterRedirectError } from '@/lib/next/is-app-router-redirect-error'
import { LeagueShellClient } from './LeagueShellClient'

export const dynamic = 'force-dynamic'

// LeagueShellClient is imported directly — it owns the dynamic() call inside a client component.
// This keeps next/dynamic with ssr:false inside a proper 'use client' boundary.
const _unused = {
  ssr: false,  // reminder: ssr:false is applied inside LeagueShellClient.tsx
}

function firstSearchParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0] ?? null
  return null
}

function isTruthySearchParam(value: string | string[] | undefined): boolean {
  const normalized = firstSearchParam(value)?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

function logLeaguePageFailure(details: {
  marker: string
  leagueId: string
  userId?: string | null
  selectedView: string | null
  selectedTab: string | null
  step: string
  missingDataKey: string | null
  errorMessage: string
  errorName: string
}) {
  // Always log to server; never include stack in details (UI cannot read server logs).
  // In dev, also emit to stderr so terminal shows it.
  const { ...safeDetails } = details
  if (process.env.NODE_ENV !== 'production') {
    console.error('[league page] load failure', safeDetails)
  } else {
    console.error(JSON.stringify({ level: 'error', ...safeDetails }))
  }
}

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
  const createdFromLeagueCreate = isPostCreateLeagueShellHandoff(sp)
  const defaultShowInvite = isTruthySearchParam(sp.showInvite)
  const defaultOpenChat =
    normalizeOpenChatQueryParam(firstSearchParam(sp.openChat)) === 'league' ? 'league' : null
  const shouldPlayIntro = isTruthySearchParam(sp.playIntro)
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

          // Guard: if this ID belongs to any bracket pool table, redirect to the bracket route.
          // This handles stale bookmarks, old notification links, and canonicalization remnants
          // that incorrectly sent bracket pool UUIDs to /league/[id].
          // NOTE: redirect() throws a NEXT_REDIRECT error — catch blocks MUST re-throw it or
          // the redirect is silently swallowed. Only suppress non-redirect errors (e.g. missing table).
          try {
            const bracketLeagueRow = await (prisma as any).bracketLeague.findUnique({
              where: { id: leagueId },
              select: { id: true },
            })
            if (bracketLeagueRow?.id) {
              redirect(`/brackets/leagues/${leagueId}`)
            }
          } catch (err) {
            if (isAppRouterRedirectError(err)) throw err
            // Table may not exist in all environments — continue to not-found
          }
          try {
            const playoffRow = await (prisma as any).playoffBracketChallenge.findUnique({
              where: { id: leagueId },
              select: { id: true },
            })
            if (playoffRow?.id) {
              redirect(`/brackets/leagues/${leagueId}`)
            }
          } catch (err) {
            if (isAppRouterRedirectError(err)) throw err
            // Table may not exist — continue
          }
          try {
            const worldCupRow = await (prisma as any).worldCupBracketChallenge.findUnique({
              where: { id: leagueId },
              select: { id: true },
            })
            if (worldCupRow?.id) {
              redirect(`/brackets/leagues/${leagueId}`)
            }
          } catch (err) {
            if (isAppRouterRedirectError(err)) throw err
            // Table may not exist — continue
          }

          return (
            <DashboardUnavailableState
              title="League not found"
              message="This league doesn't exist or you may not have access to it. It may have been deleted, or you may need to reconnect your platform."
            />
          )
      }

      // Redirect tournament hub / feeder leagues to tournament home (same rules as My Leagues list links)
      const leagueSettings =
              league.settings && typeof league.settings === 'object'
            ? (league.settings as Record<string, unknown>)
                : {}
            const tournamentHref = resolveTournamentDestinationFromLeagueSettings(leagueSettings)
        if (tournamentHref && !createdFromLeagueCreate) {
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
              // Not a member — show explicit join/request state instead of opaque redirect.
              return (
                <DashboardUnavailableState
                  title="You don't have access to this league"
                  message="You are not a member of this league. Ask the commissioner to invite you, or check if you joined under a different account."
                />
              )
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
        <div className="flex min-h-0 flex-1 flex-col" data-league-id={leagueId}>
          <LeagueShellClient
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
            createdFromLeagueCreate={createdFromLeagueCreate}
            defaultShowInvite={defaultShowInvite}
            defaultOpenChat={defaultOpenChat}
            shouldPlayIntro={shouldPlayIntro}
          />
        </div>
      )
  } catch (error) {
        if (isAppRouterRedirectError(error)) {
                throw error
        }
    
        const issue = getDashboardRuntimeIssue(error)
        console.error('[league-page] failed to load league dashboard', {
          leagueId,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        })
        logLeaguePageFailure({
          marker: 'league_dashboard_render_failed',
          leagueId,
          userId: session?.user?.id ?? null,
          selectedView: firstSearchParam(sp?.view),
          selectedTab: firstSearchParam(sp?.tab),
          step: 'data_load',
          missingDataKey: issue?.missing?.[0] ?? null,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorName: error instanceof Error ? error.name : 'UnknownError',
        })

        if (issue) {
          return (
            <DashboardUnavailableState
              title={issue.title}
              message={issue.message}
              missing={issue.missing}
            />
          )
        }
    
        return (
          <DashboardUnavailableState
            title="League temporarily unavailable"
            message="We couldn't load this league. Please try again in a moment."
          />
        )
  }
}
