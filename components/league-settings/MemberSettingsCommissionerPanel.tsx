'use client'

/**
 * components/league-settings/MemberSettingsCommissionerPanel.tsx
 * Commissioner member settings panel matching Sleeper UI.
 * Shows each team with:
 *  - Avatar, team name, owner name
 *  - Starters list (player names)
 *  - Numbered position (draft order slot)
 *  - "Unassign/Remove" button for assigned teams
 *  - "Add" button for unassigned/orphan teams → user picker
 * Works for ALL sports and ALL league types including specialty leagues.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { UserMinus, UserPlus, X, Search, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { DuplicateManagerWarningsSection } from '@/components/league-settings/DuplicateManagerWarningsSection'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamMember {
  teamId: string
  teamName: string
  ownerName: string
  avatarUrl: string | null
  rosterId: string | null
  platformUserId: string | null
  isOrphan: boolean
  isCommissioner: boolean
  isCoCommissioner: boolean
  teamRole: string
  starters: string[]  // player display names
  allPlayers: string[] // all player display names on roster
  position: number // 1-based order
}

interface AvailableUser {
  id: string
  username: string | null
  displayName: string | null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  leagueId: string
}

export function MemberSettingsCommissionerPanel({ leagueId }: Props) {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  /** True when viewer can load commissioner managers API (head or co-commissioner). */
  const [canManageMembers, setCanManageMembers] = useState(false)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([])
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [addPickerOpen, setAddPickerOpen] = useState<string | null>(null) // teamId of open picker
  const [search, setSearch] = useState('')
  type MemberFilter = 'all' | 'commissioner' | 'coowner' | 'orphan' | 'assigned'
  const [memberFilter, setMemberFilter] = useState<MemberFilter>('all')
  const [inviteLoading, setInviteLoading] = useState(false)

  // Load member data
  const load = useCallback(async () => {
    try {
      setCanManageMembers(false)
      const res = await fetch(
        `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/managers`,
        { cache: 'no-store' }
      )
      if (res.status === 403) {
        // Non-commissioner: load teams from league data instead
        const leagueRes = await fetch(
          `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/division-settings`,
          { cache: 'no-store' }
        )
        if (leagueRes.ok) {
          const leagueData = await leagueRes.json()
          setCanManageMembers(false)
          const teams = (leagueData.teams ?? []) as Array<{
            id: string
            teamName: string | null
            ownerName: string | null
            avatarUrl: string | null
            isOrphan?: boolean
            isCommissioner?: boolean
            isCoCommissioner?: boolean
            role?: string
          }>
          setMembers(teams.map((t, i) => ({
            teamId: t.id,
            teamName: t.teamName ?? `Team ${i + 1}`,
            ownerName: t.ownerName ?? '',
            avatarUrl: t.avatarUrl,
            rosterId: null,
            platformUserId: null,
            isOrphan: Boolean(t.isOrphan) || !t.ownerName || t.ownerName.startsWith('Team '),
            isCommissioner: Boolean(t.isCommissioner),
            isCoCommissioner: Boolean(t.isCoCommissioner),
            teamRole: typeof t.role === 'string' ? t.role : 'member',
            starters: [],
            allPlayers: [],
            position: i + 1,
          })))
        }
        return
      }
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to load'); return }

      setCanManageMembers(true)

      const teamsRaw = data.teams ?? [] as Array<Record<string, unknown>>
      const rostersRaw = data.rosters ?? []
      const managersRaw = data.managers ?? []

      // Build roster map: rosterId -> { platformUserId }
      const rosterMap = new Map<string, { id: string; platformUserId: string | null }>()
      for (const r of rostersRaw) rosterMap.set(r.id, r)

      // Build manager map: rosterId -> manager info
      const managerMap = new Map<string, { rosterId: string; userId: string | null; displayName: string | null }>()
      for (const m of managersRaw) managerMap.set(m.rosterId, m)

      // Also fetch rosters with player data for starters display
      let rosterPlayers: Record<string, { starters: string[]; allPlayers: string[] }> = {}
      try {
        const rpRes = await fetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/roster-players`,
          { cache: 'no-store' }
        )
        if (rpRes.ok) {
          rosterPlayers = await rpRes.json()
        }
      } catch { /* silent - starters just won't show */ }

      const memberList: TeamMember[] = teamsRaw.map((t: Record<string, unknown>, i: number) => {
        const teamId = t.id as string
        const externalId = t.externalId as string
        const roster = rosterMap.get(externalId) ?? null
        const manager = roster ? managerMap.get(roster.id) : null
        const isOrphanFlag = Boolean(t.isOrphan)
        const isOrphan = isOrphanFlag
          || !manager?.userId
          || (manager.userId as string).startsWith('orphan-')
          || (t.ownerName as string ?? '').toLowerCase().includes('unassigned')
        const rp = roster ? (rosterPlayers[roster.id] ?? { starters: [], allPlayers: [] }) : { starters: [], allPlayers: [] }

        return {
          teamId,
          teamName: (t.teamName as string) ?? `Team ${i + 1}`,
          ownerName: isOrphan ? '' : ((t.ownerName as string) ?? ''),
          avatarUrl: (t.avatarUrl as string) ?? null,
          rosterId: roster?.id ?? null,
          platformUserId: manager?.userId ?? null,
          isOrphan,
          isCommissioner: Boolean(t.isCommissioner),
          isCoCommissioner: Boolean(t.isCoCommissioner),
          teamRole: typeof t.role === 'string' ? t.role : 'member',
          starters: rp.starters,
          allPlayers: rp.allPlayers,
          position: i + 1,
        }
      })

      setMembers(memberList)

      // Build available users list from league invite candidates
      const assignedUserIds = new Set(memberList.filter(m => !m.isOrphan).map(m => m.platformUserId).filter(Boolean))
      const unassigned = managersRaw
        .filter((m: Record<string, unknown>) => !assignedUserIds.has(m.userId as string))
        .map((m: Record<string, unknown>) => ({
          id: m.userId as string,
          username: m.username as string | null,
          displayName: m.displayName as string | null,
        }))
      setAvailableUsers(unassigned)
    } catch {
      setError('Failed to load member settings')
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => { load() }, [load])

  const displayedMembers = useMemo(() => {
    let list = members
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (m) =>
          m.teamName.toLowerCase().includes(q) ||
          m.ownerName.toLowerCase().includes(q) ||
          m.teamRole.toLowerCase().includes(q)
      )
    }
    switch (memberFilter) {
      case 'commissioner':
        return list.filter((m) => m.isCommissioner)
      case 'coowner':
        return list.filter((m) => m.isCoCommissioner)
      case 'orphan':
        return list.filter((m) => m.isOrphan)
      case 'assigned':
        return list.filter((m) => !m.isOrphan)
      default:
        return list
    }
  }, [members, search, memberFilter])

  const copyInviteLink = useCallback(async () => {
    setInviteLoading(true)
    try {
      const res = await fetch('/api/league/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leagueId }),
      })
      const data = (await res.json()) as { inviteUrl?: string; error?: string }
      if (!res.ok) {
        toast.error(data.error ?? 'Could not create invite link')
        return
      }
      if (data.inviteUrl) {
        await navigator.clipboard.writeText(data.inviteUrl)
        toast.success('Invite link copied to clipboard')
      }
    } catch {
      toast.error('Failed to create invite')
    } finally {
      setInviteLoading(false)
    }
  }, [leagueId])

  // Unassign/Remove a manager from a team
  const handleUnassign = useCallback(async (rosterId: string) => {
    if (!rosterId) return
    setActionLoading(rosterId)
    setError(null); setSuccess(null)
    try {
      const res = await fetch(
        `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/managers?rosterId=${encodeURIComponent(rosterId)}`,
        { method: 'DELETE' }
      )
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to remove'); return }
      setSuccess(t('member.removed'))
      setTimeout(() => setSuccess(null), 3000)
      await load() // Reload
    } catch { setError('Request failed') }
    finally { setActionLoading(null) }
  }, [leagueId, load])

  // Assign a user to an orphan team
  const handleAssign = useCallback(async (rosterId: string, userId: string) => {
    if (!rosterId || !userId) return
    setActionLoading(rosterId)
    setError(null); setSuccess(null)
    setAddPickerOpen(null)
    try {
      const res = await fetch(
        `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/managers`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rosterId, userId }),
        }
      )
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to assign'); return }
      setSuccess(t('member.assigned'))
      setTimeout(() => setSuccess(null), 3000)
      await load() // Reload
    } catch { setError('Request failed') }
    finally { setActionLoading(null) }
  }, [leagueId, load])

  if (loading) {
    return <div className="py-8 text-center text-sm text-white/50">Loading member settings...</div>
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-white">{t('member.title')}</h3>
        <p className="mt-0.5 text-xs text-white/50">{t('member.subtitle')}</p>
      </div>

      {/* Status messages */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300">{error}</div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">{success}</div>
      )}

      {canManageMembers && <DuplicateManagerWarningsSection leagueId={leagueId} />}

      {canManageMembers ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={inviteLoading}
            onClick={() => void copyInviteLink()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/25 bg-cyan-950/25 px-3 py-1.5 text-[11px] font-semibold text-cyan-200 transition hover:bg-cyan-950/40 disabled:opacity-50"
          >
            <Link2 className="h-3.5 w-3.5" />
            {inviteLoading ? 'Preparing…' : 'Copy invite link'}
          </button>
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">Search members</p>
        <div className="relative">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Team or owner…"
            className="w-full rounded-lg border border-white/15 bg-[#0d1526] py-2.5 pl-4 pr-10 text-[13px] text-white placeholder:text-white/30 focus:border-cyan-500/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
          />
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['all', 'All'],
            ['commissioner', 'Commissioner'],
            ['coowner', 'Co-owner'],
            ['orphan', 'Orphan'],
            ['assigned', 'Assigned'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMemberFilter(id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition ${
              memberFilter === id
                ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
                : 'border-white/10 bg-white/[0.03] text-white/45 hover:border-white/20'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Team list */}
      <div className="space-y-0">
        {displayedMembers.map((member) => (
          <div key={member.teamId} className="border-b border-white/[0.06] py-4 last:border-0">
            {/* Team header: avatar + name + owner */}
            <div className="flex items-start gap-3">
              {/* Avatar */}
              <div className="shrink-0">
                {member.avatarUrl ? (
                  <img
                    src={member.avatarUrl}
                    alt=""
                    className="h-10 w-10 rounded-full border border-white/10 object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-bold text-white/30">
                    {(member.teamName ?? '?')[0]}
                  </div>
                )}
              </div>

              {/* Name + owner */}
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-white">
                  {member.teamName}
                  {member.isOrphan && (
                    <span className="ml-1.5 text-[11px] font-normal text-white/30">{t('member.unassigned')}</span>
                  )}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {member.ownerName && !member.isOrphan && (
                    <p className="text-[12px] text-white/40">{member.ownerName}</p>
                  )}
                  {member.isCommissioner ? (
                    <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-bold uppercase text-amber-200">
                      Commissioner
                    </span>
                  ) : null}
                  {member.isCoCommissioner ? (
                    <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[11px] font-bold uppercase text-cyan-200">
                      Co-comm
                    </span>
                  ) : null}
                  <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium uppercase text-white/35">
                    {member.teamRole}
                  </span>
                </div>
              </div>
            </div>

            {/* Player names - starters + all */}
            {member.allPlayers.length > 0 && (
              <div className="mt-2 pl-[52px]">
                {/* Top row of player names */}
                <p className="text-[12px] text-white/50 leading-relaxed">
                  {member.allPlayers.slice(0, 4).join(', ')}
                  {member.allPlayers.length > 4 && ','}
                </p>

                {/* Starters label + more names */}
                {member.starters.length > 0 && (
                  <div className="mt-1">
                    <p className="text-[11px] font-semibold text-white/30">{t('member.starters')}</p>
                    <p className="text-[12px] text-white/50 leading-relaxed">
                      {member.starters.slice(0, 5).join(', ')}
                      {member.starters.length > 5 && ','}
                    </p>
                  </div>
                )}

                {/* Remaining players */}
                {member.allPlayers.length > 4 && (
                  <p className="mt-1 text-[12px] text-white/40 leading-relaxed">
                    {member.allPlayers.slice(4).join(', ')}
                  </p>
                )}
              </div>
            )}

            {/* Position number + action button */}
            <div className="mt-2 flex items-center justify-between pl-[52px]">
              <span className="text-[13px] font-medium text-white/30">{member.position}.</span>

              {/* Action buttons - commissioner only */}
              {canManageMembers && (
                <div>
                  {member.isOrphan ? (
                    /* ADD button for unassigned teams */
                    <div className="relative">
                      <button
                        type="button"
                        disabled={actionLoading === member.rosterId}
                        onClick={() => setAddPickerOpen(addPickerOpen === member.teamId ? null : member.teamId)}
                        className="flex items-center gap-1 text-[12px] font-medium text-cyan-400 hover:text-cyan-300 disabled:opacity-50 transition"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        {t('member.add')}
                      </button>

                      {/* User picker dropdown */}
                      {addPickerOpen === member.teamId && (
                        <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-white/15 bg-[#0d1526] py-1 shadow-xl">
                          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
                              {t('member.selectManager')}
                            </span>
                            <button type="button" onClick={() => setAddPickerOpen(null)}>
                              <X className="h-3.5 w-3.5 text-white/30 hover:text-white/60" />
                            </button>
                          </div>
                          {availableUsers.length > 0 ? (
                            <div className="max-h-48 overflow-y-auto">
                              {availableUsers.map((user) => (
                                <button
                                  key={user.id}
                                  type="button"
                                  onClick={() => member.rosterId && handleAssign(member.rosterId, user.id)}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-white/70 transition hover:bg-white/[0.06] hover:text-white"
                                >
                                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-white/40">
                                    {(user.displayName ?? user.username ?? '?')[0]?.toUpperCase()}
                                  </div>
                                  <span>{user.displayName ?? user.username ?? user.id}</span>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="px-3 py-3 text-[11px] text-white/30">
                              {t('member.noAvailable')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* UNASSIGN/REMOVE button for assigned teams */
                    <button
                      type="button"
                      disabled={actionLoading === member.rosterId}
                      onClick={() => member.rosterId && handleUnassign(member.rosterId)}
                      className="flex items-center gap-1 text-[12px] font-medium text-white/40 hover:text-red-400 disabled:opacity-50 transition"
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                      {t('member.unassignRemove')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {displayedMembers.length === 0 && (
          <div className="py-8 text-center text-[13px] text-white/30">
            {members.length === 0 ? t('member.noMembers') : 'No teams match this filter.'}
          </div>
        )}
      </div>

      {/* Non-commissioner notice */}
      {!canManageMembers && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-white/40">
          {t('member.readOnlyBanner')}
        </div>
      )}
    </div>
  )
}
