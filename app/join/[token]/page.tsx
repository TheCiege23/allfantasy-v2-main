'use client'

/**
 * Legacy league join by opaque token (`/join/[token]`).
 * Prefer unified `/invite/accept?code=...` for new invite links; this page remains for existing URLs.
 */

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'

import { ManagerRoleBadge } from '@/components/ManagerRoleBadge'
import { ENGAGEMENT } from '@/lib/analytics/eventNames'
import { sendProductAnalyticsBeacon } from '@/lib/analytics/client'

type TeamOption = {
  id: string
  externalId: string
  teamName: string
  ownerName: string
  avatarUrl: string | null
  role: string
  isOrphan: boolean
  isClaimed: boolean
  claimEligibility?: 'claimed' | 'matched' | 'open' | 'locked'
}

type InvitePayload = {
  leagueId: string
  leagueName: string | null
  sport: string
  teamCount: number | null
  teams: TeamOption[]
}

function buildSleeperAvatarUrl(value: string | null) {
  if (!value) return null
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  return `https://sleepercdn.com/avatars/${value}`
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'AF'
}

function Spinner() {
  return <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-300" />
}

export default function JoinLeagueInvitePage() {
  const params = useParams<{ token: string }>() ?? ({} as { token: string })
  const router = useRouter()
  const { status } = useSession()
  const token = typeof params?.token === 'string' ? params.token : ''

  const [invite, setInvite] = useState<InvitePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)

  const fetchInvite = useCallback(async () => {
    if (!token) {
      setLoadError('Invite not found or expired.')
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError(null)

    try {
      const response = await fetch(`/api/league/invite?token=${encodeURIComponent(token)}`, {
        cache: 'no-store',
      })
      const payload = (await response.json().catch(() => null)) as InvitePayload | { error?: string } | null

      if (!response.ok) {
        const message = payload && 'error' in payload && typeof payload.error === 'string'
          ? payload.error
          : 'Invite not found or expired.'
        setInvite(null)
        setLoadError(message)
        return
      }

      setInvite(payload as InvitePayload)
    } catch {
      setInvite(null)
      setLoadError('Unable to load invite details right now.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void fetchInvite()
  }, [fetchInvite])

  const availableTeams = useMemo(
    () => {
      const unclaimed = (invite?.teams ?? []).filter((team) => !team.isClaimed)
      const matched = unclaimed.filter((team) => team.claimEligibility === 'matched')
      if (matched.length > 0) return matched
      return unclaimed.filter((team) => (team.claimEligibility ?? 'open') !== 'locked')
    },
    [invite]
  )

  const hasLockedTeams = useMemo(
    () => (invite?.teams ?? []).some((team) => !team.isClaimed && team.claimEligibility === 'locked'),
    [invite]
  )

  const selectedTeam = useMemo(
    () => availableTeams.find((team) => team.id === selectedTeamId) ?? null,
    [availableTeams, selectedTeamId]
  )

  useEffect(() => {
    if (!selectedTeamId && availableTeams.length > 0) {
      setSelectedTeamId(availableTeams[0].id)
    }
  }, [availableTeams, selectedTeamId])

  const handleClaim = useCallback(async () => {
    if (!selectedTeam || !token) return

    setClaiming(true)
    setClaimError(null)

    try {
      const response = await fetch('/api/league/invite/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          teamExternalId: selectedTeam.externalId,
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string; leagueId?: string } | null

      if (!response.ok) {
        setClaimError(payload?.error ?? 'Unable to claim this team right now.')
        if (response.status === 409) {
          void fetchInvite()
        }
        return
      }

      const claimedLeagueId = typeof payload?.leagueId === 'string' ? payload.leagueId : invite?.leagueId
      sendProductAnalyticsBeacon(ENGAGEMENT.JOIN_INVITE_TEAM_CLAIM, {
        leagueId: claimedLeagueId ?? null,
        teamExternalId: selectedTeam.externalId,
      })

      router.push(
        claimedLeagueId ? `/league/${claimedLeagueId}` : '/dashboard'
      )
      router.refresh()
    } catch {
      setClaimError('Unable to claim this team right now.')
    } finally {
      setClaiming(false)
    }
  }, [fetchInvite, invite?.leagueId, router, selectedTeam, token])

  const callbackUrl = `/join/${token}`

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.14),_transparent_30%),linear-gradient(180deg,#040915_0%,#07101f_55%,#02060f_100%)] px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center justify-center">
        <div className="w-full rounded-[28px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8">
          {loading || status === 'loading' ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center gap-4 text-center">
              <Spinner />
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-300/80">League Invite</p>
                <h1 className="mt-3 text-2xl font-black text-white sm:text-3xl">Loading your join link</h1>
                <p className="mt-2 text-sm text-slate-300">Pulling league details and available teams now.</p>
              </div>
            </div>
          ) : loadError || !invite ? (
            <div className="mx-auto flex min-h-[360px] max-w-xl flex-col items-center justify-center text-center">
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-red-200">
                Invite unavailable
              </div>
              <h1 className="mt-5 text-3xl font-black text-white">This invite is no longer valid</h1>
              <p className="mt-3 max-w-md text-sm text-slate-300">{loadError ?? 'Invite not found or expired.'}</p>
              <Link
                href="/core"
                className="mt-6 inline-flex items-center justify-center rounded-full border border-white/10 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/15"
              >
                Return to dashboard
              </Link>
            </div>
          ) : status === 'unauthenticated' ? (
            <div className="mx-auto max-w-xl text-center">
              <div className="inline-flex rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200">
                League Invite
              </div>
              <h1 className="mt-5 text-3xl font-black text-white sm:text-4xl">{invite.leagueName ?? 'Join this league'}</h1>
              <p className="mt-3 text-sm text-slate-300">
                {invite.sport} league with {invite.teamCount ?? invite.teams.length} teams. Sign in or create your account to claim your team.
              </p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                <Link
                  href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                  className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/10"
                >
                  Sign In to Join
                </Link>
                <Link
                  href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                  className="inline-flex items-center justify-center rounded-2xl border border-cyan-400/40 bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/60 hover:bg-cyan-400/20"
                >
                  Create Account &amp; Join
                </Link>
              </div>
            </div>
          ) : availableTeams.length === 0 ? (
            <div className="mx-auto flex min-h-[360px] max-w-xl flex-col items-center justify-center text-center">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-slate-200">
                {hasLockedTeams ? 'Account match required' : 'League full'}
              </div>
              <h1 className="mt-5 text-3xl font-black text-white">
                {hasLockedTeams ? 'Link the right platform account to claim your imported team' : 'All teams have already been claimed'}
              </h1>
              <p className="mt-3 max-w-md text-sm text-slate-300">
                {hasLockedTeams
                  ? `This invite found imported placeholders for ${invite.leagueName ?? 'this league'}, but none match your linked account yet.`
                  : `${invite.leagueName ?? 'This league'} is already fully assigned. Head back to your dashboard to explore your leagues.`}
              </p>
              <Link
                href="/core"
                className="mt-6 inline-flex items-center justify-center rounded-full border border-white/10 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/15"
              >
                Go to dashboard
              </Link>
            </div>
          ) : (
            <div>
              <div className="max-w-2xl">
                <div className="inline-flex rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200">
                  Claim your team
                </div>
                <h1 className="mt-5 text-3xl font-black text-white sm:text-4xl">{invite.leagueName ?? 'Join this league'}</h1>
                <p className="mt-3 text-sm text-slate-300">
                  Pick the team that belongs to you in this {invite.sport} league. Imported placeholders are matched against your linked platform identity first.
                </p>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {availableTeams.map((team) => {
                  const isSelected = selectedTeamId === team.id
                  const avatarUrl = buildSleeperAvatarUrl(team.avatarUrl)
                  return (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => {
                        setSelectedTeamId(team.id)
                        setClaimError(null)
                      }}
                      className={`rounded-3xl border p-4 text-left transition ${
                        isSelected
                          ? 'border-teal-500 bg-teal-500/10 shadow-[0_20px_60px_rgba(13,148,136,0.18)]'
                          : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          {avatarUrl ? (
                            <img
                              src={avatarUrl}
                              alt={team.teamName}
                              className="h-12 w-12 rounded-2xl border border-white/10 object-cover"
                            />
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-sm font-black text-cyan-100">
                              {getInitials(team.teamName || team.ownerName || 'AF')}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-bold text-white">{team.teamName}</p>
                              <ManagerRoleBadge role={team.isOrphan ? 'orphan' : team.role} />
                            </div>
                            <p className="truncate text-xs text-slate-400">{team.ownerName || 'Unassigned manager'}</p>
                          </div>
                        </div>
                        {isSelected ? (
                          <div className="rounded-full border border-teal-400/40 bg-teal-400/15 px-2 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-teal-100">
                            Selected
                          </div>
                        ) : null}
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="mt-8 rounded-3xl border border-white/10 bg-black/20 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Selected team</p>
                    <p className="mt-1 text-lg font-bold text-white">{selectedTeam?.teamName ?? 'Choose a team to continue'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleClaim()}
                    disabled={!selectedTeam || claiming}
                    className="inline-flex min-w-[240px] items-center justify-center rounded-2xl border border-cyan-400/40 bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-50 transition hover:border-cyan-300/60 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                  >
                    {claiming ? 'Claiming your team...' : `That's me - Join as ${selectedTeam?.teamName ?? 'this team'} ->`}
                  </button>
                </div>
                {claimError ? <p className="mt-3 text-sm text-red-300">{claimError}</p> : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
