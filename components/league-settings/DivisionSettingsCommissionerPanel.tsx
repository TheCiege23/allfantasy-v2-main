'use client'

/**
 * components/league-settings/DivisionSettingsCommissionerPanel.tsx
 * Commissioner division settings panel matching Sleeper UI.
 * - Dropdown: No Divisions / 2 / 4 / 8
 * - Editable division names (or "Tribes" for Survivor leagues)
 * - AI naming toggle + generate button
 * - Team assignment to divisions
 * - All changes persist to League.settings via API
 * - Works for ALL sports and ALL league types
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Sparkles, Users, Pencil, RotateCcw } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DivisionConfig {
  count: number
  names: string[]
  teamAssignments: Record<string, number>
  aiNamingEnabled: boolean
  lastUpdatedAt: string | null
  lastUpdatedBy: string | null
}

interface TeamSlot {
  id: string
  teamName: string | null
  ownerName: string | null
  avatarUrl: string | null
}

const DIVISION_COUNT_OPTIONS = [
  { value: 0, label: 'No' },
  { value: 2, label: '2' },
  { value: 4, label: '4' },
  { value: 8, label: '8' },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  leagueId: string
}

export function DivisionSettingsCommissionerPanel({ leagueId }: Props) {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isCommissioner, setIsCommissioner] = useState(false)
  const [isSurvivor, setIsSurvivor] = useState(false)

  const [count, setCount] = useState(0)
  const [names, setNames] = useState<string[]>([])
  const [teamAssignments, setTeamAssignments] = useState<Record<string, number>>({})
  const [aiNamingEnabled, setAiNamingEnabled] = useState(false)
  const [teams, setTeams] = useState<TeamSlot[]>([])
  const [aiGenerating, setAiGenerating] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [savedConfig, setSavedConfig] = useState<DivisionConfig | null>(null)

  // Label: "Divisions" or "Tribes"
  const groupLabel = isSurvivor ? 'Tribe' : 'Division'
  const groupLabelPlural = isSurvivor ? 'Tribes' : 'Divisions'

  // Load
  useEffect(() => {
    let active = true
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/division-settings`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        setIsCommissioner(data.isCommissioner ?? false)
        setIsSurvivor(data.isSurvivor ?? false)
        const cfg: DivisionConfig = data.config ?? { count: 0, names: [], teamAssignments: {}, aiNamingEnabled: false, lastUpdatedAt: null, lastUpdatedBy: null }
        setCount(cfg.count)
        setNames(cfg.names)
        setTeamAssignments(cfg.teamAssignments)
        setAiNamingEnabled(cfg.aiNamingEnabled)
        setTeams(data.teams ?? [])
        setSavedConfig(cfg)
      })
      .catch(() => { if (active) setError('Failed to load division settings') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [leagueId])

  // On count change, resize names array
  const handleCountChange = useCallback((newCount: number) => {
    setCount(newCount)
    setDropdownOpen(false)
    if (newCount === 0) {
      setNames([])
      setTeamAssignments({})
    } else {
      setNames((prev) => {
        if (prev.length === newCount) return prev
        const label = isSurvivor ? 'Tribe' : 'Division'
        const newNames = Array.from({ length: newCount }, (_, i) => prev[i] ?? `${label} ${i + 1}`)
        return newNames
      })
    }
  }, [isSurvivor])

  const handleNameChange = useCallback((index: number, value: string) => {
    setNames((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }, [])

  const handleTeamAssign = useCallback((teamId: string, divIndex: number) => {
    setTeamAssignments((prev) => ({ ...prev, [teamId]: divIndex }))
  }, [])

  // AI Generate Names
  const generateAiNames = useCallback(async () => {
    if (!count) return
    setAiGenerating(true)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/division-settings/ai-name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      })
      const data = await res.json()
      if (data.names && Array.isArray(data.names)) {
        setNames(data.names.slice(0, count))
      }
    } catch { /* silent */ }
    finally { setAiGenerating(false) }
  }, [leagueId, count])

  // Save
  const save = useCallback(async () => {
    setSaving(true); setError(null); setSuccess(false)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/division-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count, names, teamAssignments, aiNamingEnabled }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Save failed'); return }
      setSavedConfig(data.config)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch { setError('Request failed') }
    finally { setSaving(false) }
  }, [leagueId, count, names, teamAssignments, aiNamingEnabled])

  const resetToSaved = useCallback(() => {
    if (savedConfig) {
      setCount(savedConfig.count)
      setNames(savedConfig.names)
      setTeamAssignments(savedConfig.teamAssignments)
      setAiNamingEnabled(savedConfig.aiNamingEnabled)
    }
  }, [savedConfig])

  const hasChanges = useMemo(() => {
    if (!savedConfig) return count > 0
    return count !== savedConfig.count
      || JSON.stringify(names) !== JSON.stringify(savedConfig.names)
      || JSON.stringify(teamAssignments) !== JSON.stringify(savedConfig.teamAssignments)
      || aiNamingEnabled !== savedConfig.aiNamingEnabled
  }, [count, names, teamAssignments, aiNamingEnabled, savedConfig])

  // Group teams by division
  const teamsByDivision = useMemo(() => {
    const groups: Record<number, TeamSlot[]> = {}
    for (let i = 0; i < count; i++) groups[i] = []
    const unassigned: TeamSlot[] = []
    for (const team of teams) {
      const divIdx = teamAssignments[team.id]
      if (divIdx != null && divIdx >= 0 && divIdx < count) {
        groups[divIdx].push(team)
      } else {
        unassigned.push(team)
      }
    }
    return { groups, unassigned }
  }, [teams, teamAssignments, count])

  if (loading) return <div className="py-8 text-center text-sm text-white/50">Loading division settings...</div>

  const countLabel = count === 0 ? 'No' : String(count)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-white">{isSurvivor ? t('division.tribeName') : t('division.title')}</h3>
        <p className="mt-0.5 text-xs text-white/50">
          {isSurvivor ? t('division.tribeSubtitle') : t('division.subtitle')}
        </p>
      </div>

      {/* ===== NUM OF DIVISIONS / TRIBES ===== */}
      <div className="space-y-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">
            Num of {groupLabelPlural}
          </p>
          <p className="text-[11px] text-white/30">
            Set number of {isSurvivor ? 'tribes' : 'divisions'} for league
          </p>
        </div>

        {/* Custom dropdown matching Sleeper screenshot */}
        <div className="relative">
          <button
            type="button"
            disabled={!isCommissioner}
            onClick={() => setDropdownOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-[#0d1526] px-4 py-2.5 text-left text-sm font-medium text-white disabled:cursor-default disabled:opacity-50"
          >
            <span>{countLabel}</span>
            <ChevronDown className={`h-4 w-4 text-white/40 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {dropdownOpen && isCommissioner && (
            <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-white/15 bg-[#0d1526] py-1 shadow-xl">
              {DIVISION_COUNT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleCountChange(opt.value)}
                  className={`flex w-full items-center px-4 py-2.5 text-left text-sm transition hover:bg-white/[0.06] ${
                    count === opt.value ? 'text-cyan-300 font-medium' : 'text-white/80'
                  }`}
                >
                  <span>{opt.label === 'No' ? 'No' : opt.label}</span>
                  <span className="ml-1 text-white/40">{groupLabelPlural}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ===== DIVISION / TRIBE NAMES ===== */}
      {count > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">
              {groupLabel} Names
            </p>
            {isCommissioner && (
              <button
                type="button"
                onClick={generateAiNames}
                disabled={aiGenerating}
                className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50 transition"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {aiGenerating ? t('division.generating') : t('division.aiName')}
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            {names.map((name, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-5 text-right text-[11px] font-medium text-white/30">{i + 1}</span>
                <div className="h-3 w-3 rounded-full" style={{
                  backgroundColor: [
                    '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
                    '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
                  ][i % 8]
                }} />
                {isCommissioner ? (
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => handleNameChange(i, e.target.value)}
                    maxLength={80}
                    className="flex-1 rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
                    placeholder={`${groupLabel} ${i + 1}`}
                  />
                ) : (
                  <span className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/80">
                    {name}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== AI AUTO-NAMING TOGGLE ===== */}
      {count > 0 && isCommissioner && (
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">
              {t('division.aiAutoNaming')}
            </p>
            <p className="text-[11px] text-white/30">
              Automatically generate creative {isSurvivor ? 'tribe' : 'division'} names
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={aiNamingEnabled}
            onClick={() => setAiNamingEnabled((v) => !v)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${
              aiNamingEnabled ? 'bg-cyan-500' : 'bg-white/15'
            } cursor-pointer`}
          >
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ${
              aiNamingEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`} />
          </button>
        </div>
      )}

      {/* ===== TEAM ASSIGNMENTS ===== */}
      {count > 0 && teams.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">
            Team Assignments
          </p>

          {/* Division groups */}
          {Array.from({ length: count }, (_, divIdx) => (
            <div key={divIdx} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-2 flex items-center gap-2">
                <div className="h-3 w-3 rounded-full" style={{
                  backgroundColor: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'][divIdx % 8]
                }} />
                <span className="text-[12px] font-semibold text-white/70">{names[divIdx] ?? `${groupLabel} ${divIdx + 1}`}</span>
                <span className="ml-auto text-[11px] text-white/30">
                  {teamsByDivision.groups[divIdx]?.length ?? 0} {t('division.teams')}
                </span>
              </div>

              {(teamsByDivision.groups[divIdx] ?? []).length > 0 ? (
                <div className="space-y-0.5">
                  {(teamsByDivision.groups[divIdx] ?? []).map((team) => (
                    <div key={team.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                      {team.avatarUrl ? (
                        <img src={team.avatarUrl} alt="" className="h-6 w-6 rounded-full border border-white/10 object-cover" />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[11px] font-bold text-white/40">
                          {(team.teamName ?? '?')[0]}
                        </div>
                      )}
                      <span className="flex-1 text-[12px] text-white/80">{team.teamName ?? 'Unknown'}</span>
                      {isCommissioner && (
                        <select
                          value={divIdx}
                          onChange={(e) => handleTeamAssign(team.id, parseInt(e.target.value, 10))}
                          className="rounded border border-white/15 bg-[#0d1526] px-1.5 py-0.5 text-[11px] text-white/60"
                        >
                          {names.map((n, idx) => (
                            <option key={idx} value={idx}>{n || `${groupLabel} ${idx + 1}`}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-white/25 px-2">{t('division.noTeamsAssigned')}</p>
              )}
            </div>
          ))}

          {/* Unassigned teams */}
          {teamsByDivision.unassigned.length > 0 && (
            <div className="rounded-xl border border-amber-500/15 bg-amber-950/10 p-3">
              <p className="mb-2 text-[12px] font-semibold text-amber-200/60">{t('division.unassignedTeams')}</p>
              <div className="space-y-0.5">
                {teamsByDivision.unassigned.map((team) => (
                  <div key={team.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                    {team.avatarUrl ? (
                      <img src={team.avatarUrl} alt="" className="h-6 w-6 rounded-full border border-white/10 object-cover" />
                    ) : (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[11px] font-bold text-white/40">
                        {(team.teamName ?? '?')[0]}
                      </div>
                    )}
                    <span className="flex-1 text-[12px] text-white/80">{team.teamName ?? 'Unknown'}</span>
                    {isCommissioner && count > 0 && (
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value !== '') handleTeamAssign(team.id, parseInt(e.target.value, 10)) }}
                        className="rounded border border-white/15 bg-[#0d1526] px-1.5 py-0.5 text-[11px] text-white/60"
                      >
                        <option value="">Assign...</option>
                        {names.map((n, idx) => (
                          <option key={idx} value={idx}>{n || `${groupLabel} ${idx + 1}`}</option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Auto-assign button */}
          {isCommissioner && teamsByDivision.unassigned.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const unassigned = teamsByDivision.unassigned
                const newAssignments = { ...teamAssignments }
                unassigned.forEach((team, i) => {
                  newAssignments[team.id] = i % count
                })
                setTeamAssignments(newAssignments)
              }}
              className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/60 hover:bg-white/10 transition"
            >
              <Users className="h-3.5 w-3.5" />
              {t('division.autoAssign')}
            </button>
          )}
        </div>
      )}

      {/* ===== NON-COMMISSIONER NOTICE ===== */}
      {!isCommissioner && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-white/40">
          {isSurvivor ? t('division.readOnlyBannerTribes') : t('division.readOnlyBanner')}
        </div>
      )}

      {/* ===== SAVE ===== */}
      {isCommissioner && (
        <div className="space-y-2 border-t border-white/10 pt-3">
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300">{error}</div>
          )}
          {success && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">
              {t('division.saved')}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving || !hasChanges}
              onClick={save}
              className="flex-1 rounded-lg bg-cyan-600/80 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-50 transition"
            >
              {saving ? 'Saving...' : isSurvivor ? t('division.saveTribe') : t('division.saveDivision')}
            </button>
            {hasChanges && (
              <button type="button" onClick={resetToSaved}
                className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/60 hover:bg-white/10 transition">
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
