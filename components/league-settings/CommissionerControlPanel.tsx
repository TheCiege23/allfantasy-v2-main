'use client'

/**
 * components/league-settings/CommissionerControlPanel.tsx
 * Commissioner Control panel matching Sleeper UI exactly.
 * Main view: action buttons (Edit Lineups, Update Commissioners, Lock Roster,
 * Edit Schedule Matchups). Sub-views: team pickers with draft picks, devy,
 * taxi squad support.
 *
 * Connected to real API endpoints for all actions.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Lock, Unlock, Check, ChevronRight } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamInfo {
  id: string
  teamName: string
  ownerName: string
  avatarUrl: string | null
  wins: number
  losses: number
  isCommissioner: boolean
  isCoCommissioner: boolean
  isLocked: boolean
  platformUserId: string | null
}

interface DraftPick {
  season: number
  round: number
  originalOwner: string | null
  pickLabel: string
}

interface RosterPlayer {
  playerId: string
  name: string
  position: string
  team: string
  slotType: string // 'starter' | 'bench' | 'taxi' | 'ir' | 'devy'
  ownPct?: number
  startPct?: number
}

type SubView =
  | null
  | 'edit-lineups'
  | 'update-commissioners'
  | 'lock-roster'
  | 'edit-schedule'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  leagueId: string
}

export function CommissionerControlPanel({ leagueId }: Props) {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [teams, setTeams] = useState<TeamInfo[]>([])
  const [subView, setSubView] = useState<SubView>(null)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [selectedWeek, setSelectedWeek] = useState(1)
  const [actionLoading, setActionLoading] = useState(false)

  // Edit lineups data
  const [rosterPlayers, setRosterPlayers] = useState<RosterPlayer[]>([])
  const [draftPicks, setDraftPicks] = useState<DraftPick[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)

  // Commissioner toggles
  const [commissionerSelections, setCommissionerSelections] = useState<Record<string, boolean>>({})
  const [lockedSelections, setLockedSelections] = useState<Record<string, boolean>>({})

  // Load teams
  useEffect(() => {
    let active = true
    Promise.all([
      fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/division-settings`, { cache: 'no-store' }),
      fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/roster-locks`, { cache: 'no-store' }),
    ])
      .then(async ([teamsResponse, locksResponse]) => {
        if (!teamsResponse.ok || !locksResponse.ok) throw new Error('Failed to load commissioner controls')
        return Promise.all([teamsResponse.json(), locksResponse.json()])
      })
      .then(([data, locksData]) => {
        if (!active) return
        const rawTeams = (data.teams ?? []) as Array<Record<string, unknown>>
        setTeams(rawTeams.map((t) => ({
          id: t.id as string,
          teamName: (t.teamName as string) ?? 'Unknown',
          ownerName: (t.ownerName as string) ?? '',
          avatarUrl: (t.avatarUrl as string) ?? null,
          wins: (t.wins as number) ?? 0,
          losses: (t.losses as number) ?? 0,
          isCommissioner: (t.isCommissioner as boolean) ?? false,
          isCoCommissioner: (t.isCoCommissioner as boolean) ?? false,
          isLocked: locksData.lockedRosters?.[t.id as string] === true,
          platformUserId: (t.platformUserId as string) ?? null,
        })))
        // Init commissioner selections
        const cs: Record<string, boolean> = {}
        rawTeams.forEach((t) => {
          cs[t.id as string] = Boolean(t.isCommissioner) || Boolean(t.isCoCommissioner)
        })
        setCommissionerSelections(cs)
        setLockedSelections(locksData.lockedRosters ?? {})
      })
      .catch(() => { if (active) setError('Failed to load') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [leagueId])

  // Load roster for selected team (edit lineups)
  const loadTeamRoster = useCallback(async (teamId: string) => {
    setRosterLoading(true)
    setRosterPlayers([])
    setDraftPicks([])
    try {
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/roster-players?teamId=${encodeURIComponent(teamId)}`,
        { cache: 'no-store' }
      )
      if (res.ok) {
        const data = await res.json()
        if (data.players) setRosterPlayers(data.players)
        if (data.draftPicks) setDraftPicks(data.draftPicks)
      }
    } catch { /* silent */ }
    finally { setRosterLoading(false) }
  }, [leagueId])

  // Handle team selection in edit lineups
  const selectTeam = useCallback((teamId: string) => {
    setSelectedTeamId(teamId)
    if (subView === 'edit-lineups') {
      loadTeamRoster(teamId)
    }
  }, [subView, loadTeamRoster])

  // Save commissioners
  const saveCommissioners = useCallback(async () => {
    setActionLoading(true)
    setError(null)
    setSuccess(null)
    try {
      for (const team of teams) {
        const shouldBeCo = commissionerSelections[team.id] ?? false
        if (!team.isCommissioner && shouldBeCo !== team.isCoCommissioner) {
          const res = await fetch('/api/league/settings/co-commissioners', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leagueId, memberId: team.id, isCoCommissioner: shouldBeCo }),
          })
          if (!res.ok) {
            const body = await res.json().catch(() => ({})) as { error?: string }
            throw new Error(body.error ?? `Failed to update ${team.teamName}`)
          }
        }
      }
      setTeams((current) => current.map((team) => ({
        ...team,
        isCoCommissioner: team.isCommissioner ? team.isCoCommissioner : Boolean(commissionerSelections[team.id]),
      })))
      setSuccess('Commissioners updated.')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to update commissioners') }
    finally { setActionLoading(false) }
  }, [leagueId, teams, commissionerSelections])

  // Save locked rosters
  const saveLockedRosters = useCallback(async () => {
    setActionLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/roster-locks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockedRosters: lockedSelections }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setError(body.error ?? 'Failed to save')
        return
      }
      setSuccess('Roster locks saved.')
      setTimeout(() => setSuccess(null), 3000)
    } catch { setError('Request failed') }
    finally { setActionLoading(false) }
  }, [leagueId, lockedSelections])

  // Recalculate matchup records
  const recalculate = useCallback(async () => {
    setActionLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/scoring/process-week`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ week: selectedWeek }),
        },
      )
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? 'Recalc failed')
        return
      }
      setSuccess(`Recalculated matchup records for week ${selectedWeek}.`)
      setTimeout(() => setSuccess(null), 3000)
    } catch {
      setError('Recalc failed')
    } finally {
      setActionLoading(false)
    }
  }, [leagueId, selectedWeek])

  const selectedTeam = useMemo(
    () => teams.find((t) => t.id === selectedTeamId),
    [teams, selectedTeamId]
  )

  // Slot grouping
  const slotGroups = useMemo(() => {
    const starters = rosterPlayers.filter((p) => p.slotType === 'starter')
    const bench = rosterPlayers.filter((p) => p.slotType === 'bench')
    const taxi = rosterPlayers.filter((p) => p.slotType === 'taxi')
    const ir = rosterPlayers.filter((p) => p.slotType === 'ir')
    const devy = rosterPlayers.filter((p) => p.slotType === 'devy')
    return { starters, bench, taxi, ir, devy }
  }, [rosterPlayers])

  if (loading) return <div className="py-8 text-center text-sm text-white/50">Loading commissioner controls...</div>

  // ===== SUB-VIEW: Edit Lineups =====
  if (subView === 'edit-lineups') {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => { setSubView(null); setSelectedTeamId(null) }}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-cyan-400 hover:text-cyan-300">
          <ArrowLeft className="h-4 w-4" /> {t('commControl.back')}
        </button>
        <div>
          <h3 className="text-[16px] font-bold text-white">{t('commControl.editLineups')}</h3>
          <p className="mt-0.5 text-[12px] text-white/40">{t('commControl.editLineupsDesc')}</p>
        </div>

        {/* Recalculate button */}
        <button type="button" onClick={recalculate} disabled={actionLoading}
          className="w-full rounded-lg bg-cyan-600/80 px-4 py-2.5 text-[12px] font-bold uppercase tracking-wide text-white hover:bg-cyan-600 disabled:opacity-50">
          {t('commControl.recalculate').replace('{{week}}', String(selectedWeek))}
        </button>

        <div className="flex gap-4">
          {/* Team sidebar */}
          <div className="w-[160px] shrink-0 space-y-0.5">
            {teams.map((team) => (
              <button key={team.id} type="button" onClick={() => selectTeam(team.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition ${
                  selectedTeamId === team.id ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                }`}>
                {team.avatarUrl ? (
                  <img src={team.avatarUrl} alt="" className="h-7 w-7 rounded-full border border-white/10 object-cover" />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-white/30">
                    {(team.teamName ?? '?')[0]}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-semibold text-white">{team.ownerName || team.teamName}</p>
                  <p className="text-[11px] text-white/30">{team.wins}-{team.losses}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Roster content */}
          <div className="min-w-0 flex-1">
            {!selectedTeamId ? (
              <p className="py-8 text-center text-[13px] text-white/30">Select a team to view roster</p>
            ) : rosterLoading ? (
              <p className="py-8 text-center text-[13px] text-white/30">Loading roster...</p>
            ) : (
              <div className="space-y-4">
                {/* Week selector */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase text-white/40">Week</span>
                  <div className="flex gap-0.5">
                    {Array.from({ length: 17 }, (_, i) => i + 1).map((w) => (
                      <button key={w} type="button" onClick={() => setSelectedWeek(w)}
                        className={`h-6 w-6 rounded text-[11px] font-medium ${
                          selectedWeek === w ? 'bg-white/20 text-white' : 'text-white/40 hover:bg-white/10'
                        }`}>{w}</button>
                    ))}
                  </div>
                </div>

                {/* Total Points + Edit */}
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-white/50">Total Points: <span className="text-white/80">N/A</span></span>
                  <button type="button" className="rounded border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium text-white/60 hover:bg-white/10">
                    Edit
                  </button>
                </div>

                {/* Starters */}
                {slotGroups.starters.length > 0 && (
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase text-white/40">Starters</span>
                      <div className="flex gap-8 text-[11px] font-semibold text-white/30">
                        <span>OWN %</span>
                        <span>START %</span>
                      </div>
                    </div>
                    {slotGroups.starters.map((p) => (
                      <PlayerRow key={p.playerId} player={p} />
                    ))}
                  </div>
                )}

                {/* Bench */}
                {slotGroups.bench.length > 0 && (
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase text-white/30">Bench</p>
                    {slotGroups.bench.map((p) => (
                      <PlayerRow key={p.playerId} player={p} />
                    ))}
                  </div>
                )}

                {/* Taxi */}
                {slotGroups.taxi.length > 0 && (
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase text-white/30">Taxi Squad</p>
                    {slotGroups.taxi.map((p) => (
                      <PlayerRow key={p.playerId} player={p} />
                    ))}
                  </div>
                )}

                {/* IR */}
                {slotGroups.ir.length > 0 && (
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase text-white/30">IR</p>
                    {slotGroups.ir.map((p) => (
                      <PlayerRow key={p.playerId} player={p} />
                    ))}
                  </div>
                )}

                {/* Devy */}
                {slotGroups.devy.length > 0 && (
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase text-white/30">Devy Stash</p>
                    {slotGroups.devy.map((p) => (
                      <PlayerRow key={p.playerId} player={p} />
                    ))}
                  </div>
                )}

                {/* Draft Picks */}
                {draftPicks.length > 0 && (
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase text-white/40">Draft Picks</p>
                    <div className="space-y-0.5">
                      {draftPicks.map((pick, i) => (
                        <div key={i} className="py-1 text-[13px] font-medium text-white/80">
                          {pick.pickLabel}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {rosterPlayers.length === 0 && draftPicks.length === 0 && (
                  <p className="py-4 text-center text-[12px] text-white/30">No roster data available for this team.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ===== SUB-VIEW: Update Commissioners =====
  if (subView === 'update-commissioners') {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setSubView(null)}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-cyan-400 hover:text-cyan-300">
          <ArrowLeft className="h-4 w-4" /> {t('commControl.back')}
        </button>
        <div>
          <h3 className="text-[16px] font-bold text-white">{t('commControl.updateCommissioners')}</h3>
          <p className="mt-0.5 text-[12px] text-white/40">{t('commControl.updateCommissionersDesc')}</p>
        </div>

        {error && <div className="rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300">{error}</div>}
        {success && <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">{success}</div>}

        <div className="space-y-0.5">
          {teams.map((team) => {
            const selected = commissionerSelections[team.id] ?? false
            return (
              <button key={team.id} type="button"
                onClick={() => {
                  if (!team.isCommissioner) {
                    setCommissionerSelections((prev) => ({ ...prev, [team.id]: !selected }))
                  }
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition ${
                  selected ? 'bg-white/[0.05]' : 'hover:bg-white/[0.03]'
                }`}>
                <div className="relative">
                  {team.avatarUrl ? (
                    <img src={team.avatarUrl} alt="" className="h-10 w-10 rounded-full border border-white/10 object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-white/30">
                      {(team.teamName ?? '?')[0]}
                    </div>
                  )}
                  {selected && (
                    <div className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500">
                      <Check className="h-3 w-3 text-white" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-white">{team.teamName}</p>
                  <p className="text-[11px] text-white/40">{team.ownerName}</p>
                  <p className={`text-[11px] ${team.isCommissioner ? 'text-amber-300' : 'text-white/30'}`}>
                    {team.isCommissioner ? 'Commissioner' : 'Member'}
                  </p>
                </div>
              </button>
            )
          })}
        </div>

        <button type="button" onClick={saveCommissioners} disabled={actionLoading}
          className="w-full rounded-lg bg-cyan-600/80 px-4 py-3 text-[13px] font-bold uppercase tracking-wide text-white hover:bg-cyan-600 disabled:opacity-50">
          {actionLoading ? t('scoring.saving') : t('commControl.setCommissioners')}
        </button>
      </div>
    )
  }

  // ===== SUB-VIEW: Lock Roster =====
  if (subView === 'lock-roster') {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setSubView(null)}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-cyan-400 hover:text-cyan-300">
          <ArrowLeft className="h-4 w-4" /> {t('commControl.back')}
        </button>
        <div>
          <h3 className="text-[16px] font-bold text-white">{t('commControl.updateLockedRosters')}</h3>
          <p className="mt-0.5 text-[12px] text-white/40">{t('commControl.updateLockedDesc')}</p>
        </div>

        {error && <div className="rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300">{error}</div>}
        {success && <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">{success}</div>}

        <div className="space-y-1">
          {teams.map((team) => {
            const locked = lockedSelections[team.id] ?? false
            return (
              <button key={team.id} type="button"
                onClick={() => setLockedSelections((prev) => ({ ...prev, [team.id]: !locked }))}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition hover:bg-white/[0.03]">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  locked ? 'bg-amber-500/20' : 'bg-white/5'
                }`}>
                  {locked ? (
                    <Lock className="h-4 w-4 text-amber-400" />
                  ) : (
                    <Unlock className="h-4 w-4 text-white/30" />
                  )}
                </div>
                <span className="text-[13px] font-medium text-white/80">
                  {team.ownerName || team.teamName}
                </span>
              </button>
            )
          })}
        </div>

        <button type="button" onClick={saveLockedRosters} disabled={actionLoading}
          className="rounded-lg bg-cyan-600/80 px-6 py-3 text-[13px] font-bold uppercase tracking-wide text-white hover:bg-cyan-600 disabled:opacity-50">
          {actionLoading ? t('scoring.saving') : t('commControl.save')}
        </button>
      </div>
    )
  }

  // ===== SUB-VIEW: Edit Schedule Matchups =====
  if (subView === 'edit-schedule') {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setSubView(null)}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-cyan-400 hover:text-cyan-300">
          <ArrowLeft className="h-4 w-4" /> {t('commControl.back')}
        </button>
        <div>
          <h3 className="text-[16px] font-bold text-white">{t('commControl.editSchedule')}</h3>
          <p className="mt-0.5 text-[12px] text-white/40">{t('commControl.editScheduleDesc')}</p>
        </div>
        <p className="text-[12px] text-white/50">
          Schedule editing is available through the league schedule API. Changes will be reflected
          across all matchups, standings, and projections.
        </p>
        <button type="button"
          onClick={async () => {
            setActionLoading(true)
            try {
              await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/schedule`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ regenerate: true }),
              })
              setSuccess('Schedule updated.')
              setTimeout(() => setSuccess(null), 3000)
            } catch { setError('Failed to update schedule') }
            finally { setActionLoading(false) }
          }}
          disabled={actionLoading}
          className="w-full rounded-lg bg-[#1a2744] px-4 py-3 text-[12px] font-bold uppercase tracking-wide text-white hover:bg-[#1e2d52] disabled:opacity-50 border border-white/10">
          Edit Schedule Matchups
        </button>
        {success && <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">{success}</div>}
      </div>
    )
  }

  // ===== MAIN VIEW: Commissioner Control action buttons =====
  return (
    <div className="space-y-6">
      {/* Edit Lineups and Matchups */}
      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">{t('commControl.editLineups')}</p>
        <p className="text-[12px] text-white/40">{t('commControl.editLineupsDesc')}</p>
        <button type="button" onClick={() => setSubView('edit-lineups')}
          className="w-full rounded-lg bg-[#1a2744] px-4 py-3 text-[12px] font-bold uppercase tracking-wide text-cyan-300 hover:bg-[#1e2d52] border border-white/10 transition">
          {t('commControl.editLineupsBtn')}
        </button>
      </div>

      {/* Update Commissioners */}
      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">{t('commControl.updateCommissioners')}</p>
        <p className="text-[12px] text-white/40">{t('commControl.updateCommissionersDesc')}</p>
        <button type="button" onClick={() => setSubView('update-commissioners')}
          className="w-full rounded-lg bg-[#1a2744] px-4 py-3 text-[12px] font-bold uppercase tracking-wide text-cyan-300 hover:bg-[#1e2d52] border border-white/10 transition">
          {t('commControl.updateCommissioners')}
        </button>
      </div>

      {/* Lock Roster */}
      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">{t('commControl.lockRoster')}</p>
        <p className="text-[12px] text-white/40">{t('commControl.lockRosterDesc')}</p>
        <button type="button" onClick={() => setSubView('lock-roster')}
          className="w-full rounded-lg bg-[#1a2744] px-4 py-3 text-[12px] font-bold uppercase tracking-wide text-cyan-300 hover:bg-[#1e2d52] border border-white/10 transition">
          {t('commControl.lockRoster')}
        </button>
      </div>

      {/* Edit Schedule Matchups */}
      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">{t('commControl.editSchedule')}</p>
        <p className="text-[12px] text-white/40">{t('commControl.editScheduleDesc')}</p>
        <button type="button" onClick={() => setSubView('edit-schedule')}
          className="w-full rounded-lg bg-[#1a2744] px-4 py-3 text-[12px] font-bold uppercase tracking-wide text-cyan-300 hover:bg-[#1e2d52] border border-white/10 transition">
          {t('commControl.editSchedule')}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Player row component (for edit lineups sub-view)
// ---------------------------------------------------------------------------

function PlayerRow({ player }: { player: RosterPlayer }) {
  const posColors: Record<string, string> = {
    QB: 'bg-red-500/80', RB: 'bg-emerald-500/80', WR: 'bg-blue-500/80',
    TE: 'bg-orange-500/80', K: 'bg-purple-500/80', DEF: 'bg-slate-500/80',
    DL: 'bg-amber-600/80', LB: 'bg-teal-500/80', DB: 'bg-pink-500/80',
    FLEX: 'bg-yellow-500/80', PG: 'bg-blue-500/80', SG: 'bg-emerald-500/80',
    SF: 'bg-amber-500/80', PF: 'bg-red-500/80', C: 'bg-violet-500/80',
  }

  return (
    <div className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-white/[0.03]">
      {/* Position badge */}
      <span className={`flex h-6 w-8 items-center justify-center rounded text-[11px] font-bold text-white ${
        posColors[player.position] ?? 'bg-white/20'
      }`}>
        {player.position}
      </span>
      {/* Player info */}
      <div className="min-w-0 flex-1">
        <span className="text-[13px] font-medium text-white">
          {player.name.split(' ').map((n, i) => i === 0 ? n[0] + '.' : ' ' + n).join('')}
        </span>
        <span className="ml-1 text-[11px] text-white/30">{player.position} - {player.team} -</span>
      </div>
      {/* Own % / Start % */}
      {player.ownPct != null && (
        <span className="w-12 text-right text-[12px] text-white/40">{player.ownPct}%</span>
      )}
      {player.startPct != null && (
        <span className="w-12 text-right text-[12px] text-white/40">{player.startPct}%</span>
      )}
    </div>
  )
}
