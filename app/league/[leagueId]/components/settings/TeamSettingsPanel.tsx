'use client'

/**
 * app/league/[leagueId]/components/settings/TeamSettingsPanel.tsx
 *
 * Commissioner "Team" settings: edit each team's name and logo, and (re)assign
 * the owner. Replaces the former Team Settings placeholder.
 *
 * Data flow reuses proven endpoints:
 *  - GET  /api/commissioner/leagues/[id]/managers  -> teams + rosters + managers
 *  - PATCH/DELETE the same route                    -> owner (re)assignment
 *  - PATCH /api/commissioner/leagues/[id]/teams     -> team name / logo (this feature)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { UserMinus, UserPlus, X, Search } from 'lucide-react'
import { toast } from 'sonner'
import { SettingsPanelHeading, SettingsSectionLabel, controlClassSm } from './settings-ui'

interface TeamRow {
  teamId: string // leagueTeam.id
  externalId: string
  teamName: string
  ownerName: string
  avatarUrl: string | null
  rosterId: string | null
  platformUserId: string | null
  isOrphan: boolean
  isCommissioner: boolean
  isCoCommissioner: boolean
  teamRole: string
  position: number
}

interface AvailableUser {
  id: string
  username: string | null
  displayName: string | null
}

interface RawTeam {
  id: string
  externalId: string
  teamName: string | null
  ownerName: string | null
  avatarUrl: string | null
  isCommissioner?: boolean
  isCoCommissioner?: boolean
  isOrphan?: boolean
  role?: string
  platformUserId?: string | null
}

interface RawRoster {
  id: string
  platformUserId: string | null
}

interface RawManager {
  rosterId: string
  userId: string | null
  username: string | null
  displayName: string | null
}

export function TeamSettingsPanel({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const disabled = !canEdit
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([])
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [addPickerOpen, setAddPickerOpen] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Per-team draft edits for name/logo (keyed by teamId).
  const [nameDraft, setNameDraft] = useState<Record<string, string>>({})
  const [logoDraft, setLogoDraft] = useState<Record<string, string>>({})
  const [savingField, setSavingField] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    // Drop stale per-team drafts so a fresh server state isn't masked by them.
    setNameDraft({})
    setLogoDraft({})
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/managers`, {
        cache: 'no-store',
      })
      if (res.status === 403) {
        setLoadError('You need commissioner access to manage teams.')
        setTeams([])
        return
      }
      const data = (await res.json().catch(() => ({}))) as {
        teams?: RawTeam[]
        rosters?: RawRoster[]
        managers?: RawManager[]
        error?: string
      }
      if (!res.ok) {
        setLoadError(data.error ?? 'Failed to load teams')
        return
      }

      const teamsRaw = data.teams ?? []
      const rostersRaw = data.rosters ?? []
      const managersRaw = data.managers ?? []

      // team.externalId maps to roster.id (mirrors MemberSettingsCommissionerPanel).
      const rosterById = new Map<string, RawRoster>()
      for (const r of rostersRaw) rosterById.set(r.id, r)

      const rows: TeamRow[] = teamsRaw.map((t, i) => {
        const roster = rosterById.get(t.externalId) ?? null
        const isOrphan =
          Boolean(t.isOrphan) ||
          !t.ownerName ||
          (t.ownerName ?? '').toLowerCase().includes('unassigned')
        return {
          teamId: t.id,
          externalId: t.externalId,
          teamName: t.teamName ?? `Team ${i + 1}`,
          ownerName: isOrphan ? '' : (t.ownerName ?? ''),
          avatarUrl: t.avatarUrl ?? null,
          rosterId: roster?.id ?? null,
          platformUserId: t.platformUserId ?? null,
          isOrphan,
          isCommissioner: Boolean(t.isCommissioner),
          isCoCommissioner: Boolean(t.isCoCommissioner),
          teamRole: typeof t.role === 'string' ? t.role : 'member',
          position: i + 1,
        }
      })
      setTeams(rows)

      const assignedUserIds = new Set(
        rows.filter((r) => !r.isOrphan).map((r) => r.platformUserId).filter(Boolean),
      )
      // De-duplicate unassigned candidates by user id.
      const byId = new Map<string, AvailableUser>()
      for (const m of managersRaw) {
        if (!m.userId || assignedUserIds.has(m.userId) || byId.has(m.userId)) continue
        byId.set(m.userId, { id: m.userId, username: m.username, displayName: m.displayName })
      }
      setAvailableUsers(Array.from(byId.values()))
    } catch {
      setLoadError('Failed to load team settings')
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return teams
    return teams.filter(
      (t) => t.teamName.toLowerCase().includes(q) || t.ownerName.toLowerCase().includes(q),
    )
  }, [teams, search])

  const saveTeamField = useCallback(
    async (teamId: string, patch: { teamName?: string; avatarUrl?: string | null }, fieldKey: string) => {
      setSavingField(fieldKey)
      try {
        const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/teams`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ leagueTeamId: teamId, ...patch }),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          toast.error(data.error ?? 'Could not save team')
          return false
        }
        setTeams((prev) => prev.map((t) => (t.teamId === teamId ? { ...t, ...patch } : t)))
        toast.success('Team updated')
        return true
      } catch {
        toast.error('Request failed')
        return false
      } finally {
        setSavingField(null)
      }
    },
    [leagueId],
  )

  const commitName = useCallback(
    (team: TeamRow) => {
      const next = (nameDraft[team.teamId] ?? team.teamName).trim()
      if (!next || next === team.teamName) return
      void saveTeamField(team.teamId, { teamName: next }, `${team.teamId}:name`)
    },
    [nameDraft, saveTeamField],
  )

  const commitLogo = useCallback(
    (team: TeamRow) => {
      const raw = logoDraft[team.teamId]
      if (raw === undefined) return
      const next = raw.trim()
      if (next === (team.avatarUrl ?? '')) return
      void saveTeamField(team.teamId, { avatarUrl: next || null }, `${team.teamId}:logo`)
    },
    [logoDraft, saveTeamField],
  )

  const handleAssign = useCallback(
    async (rosterId: string | null, userId: string) => {
      if (!rosterId || !userId) return
      setActionLoading(rosterId)
      setAddPickerOpen(null)
      try {
        const res = await fetch(
          `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/managers`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ rosterId, userId }),
          },
        )
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          toast.error(data.error ?? 'Failed to assign owner')
          return
        }
        toast.success('Owner assigned')
        await load()
      } catch {
        toast.error('Request failed')
      } finally {
        setActionLoading(null)
      }
    },
    [leagueId, load],
  )

  const handleUnassign = useCallback(
    async (rosterId: string | null) => {
      if (!rosterId) return
      setActionLoading(rosterId)
      try {
        const res = await fetch(
          `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/managers?rosterId=${encodeURIComponent(rosterId)}`,
          { method: 'DELETE', credentials: 'include' },
        )
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          toast.error(data.error ?? 'Failed to remove owner')
          return
        }
        toast.success('Owner removed')
        await load()
      } catch {
        toast.error('Request failed')
      } finally {
        setActionLoading(null)
      }
    },
    [leagueId, load],
  )

  return (
    <div
      className="min-h-0 flex-1 space-y-6 px-6 py-6 text-[13px] text-white/85"
      data-testid="settings-team-panel"
    >
      <SettingsPanelHeading
        title="Team Settings"
        subtitle="Rename teams, set logos, and assign owners."
      />

      {loadError ? (
        <div className="rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-[12px] text-red-300">
          {loadError}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <div className="h-16 animate-pulse rounded-xl bg-white/[0.05]" />
          <div className="h-16 animate-pulse rounded-xl bg-white/[0.05]" />
          <div className="h-16 animate-pulse rounded-xl bg-white/[0.05]" />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <SettingsSectionLabel>Search teams</SettingsSectionLabel>
            <div className="relative max-w-md">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Team or owner…"
                className="w-full rounded-lg border border-white/15 bg-[#0d1526] py-2.5 pl-4 pr-10 text-[13px] text-white placeholder:text-white/30 focus:border-teal-400/40 focus:outline-none"
              />
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            </div>
          </div>

          <div className="space-y-3">
            {displayed.map((team) => {
              const nameVal = nameDraft[team.teamId] ?? team.teamName
              const logoVal = logoDraft[team.teamId] ?? team.avatarUrl ?? ''
              const previewUrl = logoVal.trim()
              return (
                <div
                  key={team.teamId}
                  className="rounded-2xl border border-white/[0.07] bg-black/20 p-4"
                >
                  <div className="flex items-start gap-4">
                    {/* Avatar preview */}
                    <div className="shrink-0">
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt=""
                          className="h-12 w-12 rounded-full border border-white/10 object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-base font-bold text-white/30">
                          {(team.teamName || '?')[0]?.toUpperCase()}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-3">
                      {/* Name + owner meta */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12px] font-medium text-white/35">{team.position}.</span>
                        {team.isCommissioner ? (
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-200">
                            Commissioner
                          </span>
                        ) : null}
                        {team.isCoCommissioner ? (
                          <span className="rounded bg-[#ff3d81]/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#ffb8d1]">
                            Co-comm
                          </span>
                        ) : null}
                        <span className="text-[12px] text-white/45">
                          {team.isOrphan ? 'Unassigned' : team.ownerName || '—'}
                        </span>
                      </div>

                      {/* Name field */}
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40">
                          Team name
                        </span>
                        <input
                          type="text"
                          value={nameVal}
                          disabled={disabled}
                          maxLength={64}
                          onChange={(e) =>
                            setNameDraft((d) => ({ ...d, [team.teamId]: e.target.value }))
                          }
                          onBlur={() => commitName(team)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          }}
                          className={`${controlClassSm} w-full max-w-sm`}
                        />
                      </label>

                      {/* Logo field */}
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40">
                          Logo URL
                        </span>
                        <input
                          type="url"
                          value={logoVal}
                          disabled={disabled}
                          placeholder="https://…"
                          onChange={(e) =>
                            setLogoDraft((d) => ({ ...d, [team.teamId]: e.target.value }))
                          }
                          onBlur={() => commitLogo(team)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          }}
                          className={`${controlClassSm} w-full max-w-sm`}
                        />
                        <span className="mt-1 block text-[11px] text-white/35">
                          Paste an image link. Leave blank to use the team initial.
                        </span>
                      </label>

                      {/* Owner assignment */}
                      {canEdit ? (
                        <div className="pt-1">
                          {team.isOrphan ? (
                            <div className="relative inline-block">
                              <button
                                type="button"
                                disabled={actionLoading === team.rosterId || !team.rosterId}
                                onClick={() =>
                                  setAddPickerOpen(addPickerOpen === team.teamId ? null : team.teamId)
                                }
                                className="inline-flex items-center gap-1.5 rounded-lg border border-teal-500/25 bg-teal-950/20 px-3 py-1.5 text-[11px] font-semibold text-teal-200 transition hover:bg-teal-950/40 disabled:opacity-40"
                              >
                                <UserPlus className="h-3.5 w-3.5" />
                                Assign owner
                              </button>
                              {addPickerOpen === team.teamId ? (
                                <div className="absolute left-0 top-full z-30 mt-1 w-60 rounded-lg border border-white/15 bg-[#0d1526] py-1 shadow-xl">
                                  <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                                      Select owner
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
                                          onClick={() => handleAssign(team.rosterId, user.id)}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-white/70 transition hover:bg-white/[0.06] hover:text-white"
                                        >
                                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[9px] font-bold text-white/40">
                                            {(user.displayName ?? user.username ?? '?')[0]?.toUpperCase()}
                                          </div>
                                          <span>{user.displayName ?? user.username ?? user.id}</span>
                                        </button>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="px-3 py-3 text-[11px] text-white/30">
                                      No unassigned members available.
                                    </p>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={actionLoading === team.rosterId || !team.rosterId}
                              onClick={() => handleUnassign(team.rosterId)}
                              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/45 transition hover:text-red-400 disabled:opacity-40"
                            >
                              <UserMinus className="h-3.5 w-3.5" />
                              Remove owner
                            </button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}

            {displayed.length === 0 && !loadError ? (
              <div className="py-8 text-center text-[13px] text-white/30">
                {teams.length === 0 ? 'No teams in this league yet.' : 'No teams match this search.'}
              </div>
            ) : null}
          </div>

          {savingField ? (
            <p className="text-[11px] text-white/40">Saving…</p>
          ) : null}

          {disabled ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-white/40">
              You have read-only access to team settings.
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
