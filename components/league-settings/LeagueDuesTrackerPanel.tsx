'use client'

/**
 * components/league-settings/LeagueDuesTrackerPanel.tsx
 * League Dues Tracker — commissioner can track payments, mark paid per member.
 * Links to FanCred.app (primary) and LeagueSafe.com (alternative).
 * Dynasty/C2C/Devy leagues: dropdown to mark paid for current or future seasons.
 * Commissioner-only editing. All members can view paid status.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, DollarSign, ExternalLink, ChevronDown } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DuesEntry {
  teamId: string
  paid: boolean
  paidSeasons: number[]
  paidAt: string | null
}

interface DuesConfig {
  enabled: boolean
  amount: number | null
  currency: string
  paymentLink: string | null
  paymentProvider: 'fancred' | 'leaguesafe' | 'other' | null
  entries: DuesEntry[]
  lastUpdatedAt: string | null
  lastUpdatedBy: string | null
}

interface TeamInfo {
  id: string
  teamName: string | null
  ownerName: string | null
  avatarUrl: string | null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  leagueId: string
}

export function LeagueDuesTrackerPanel({ leagueId }: Props) {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isCommissioner, setIsCommissioner] = useState(false)
  const [isMultiSeason, setIsMultiSeason] = useState(false)
  const [currentSeason, setCurrentSeason] = useState(2025)

  const [config, setConfig] = useState<DuesConfig>({
    enabled: false, amount: null, currency: 'USD',
    paymentLink: null, paymentProvider: null, entries: [],
    lastUpdatedAt: null, lastUpdatedBy: null,
  })
  const [teams, setTeams] = useState<TeamInfo[]>([])
  const [seasonDropdownOpen, setSeasonDropdownOpen] = useState<string | null>(null)

  // Load
  useEffect(() => {
    let active = true
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/dues`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        setConfig(data.config ?? { enabled: false, amount: null, currency: 'USD', paymentLink: null, paymentProvider: null, entries: [], lastUpdatedAt: null, lastUpdatedBy: null })
        setIsCommissioner(data.isCommissioner ?? false)
        setTeams(data.teams ?? [])
        setCurrentSeason(data.currentSeason ?? 2025)
        setIsMultiSeason(data.isMultiSeason ?? false)
      })
      .catch(() => { if (active) setError('Failed to load dues settings') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [leagueId])

  // Get paid status for a team
  const getEntry = useCallback((teamId: string): DuesEntry => {
    return config.entries.find((e) => e.teamId === teamId) ?? { teamId, paid: false, paidSeasons: [], paidAt: null }
  }, [config.entries])

  // Toggle paid status
  const togglePaid = useCallback((teamId: string) => {
    if (!isCommissioner) return
    setConfig((prev) => {
      const existing = prev.entries.find((e) => e.teamId === teamId)
      const newPaid = !existing?.paid
      const newEntries = prev.entries.filter((e) => e.teamId !== teamId)
      newEntries.push({
        teamId,
        paid: newPaid,
        paidSeasons: newPaid ? [currentSeason] : [],
        paidAt: newPaid ? new Date().toISOString() : null,
      })
      return { ...prev, entries: newEntries }
    })
  }, [isCommissioner, currentSeason])

  // Toggle paid for specific season (dynasty/C2C/devy)
  const toggleSeasonPaid = useCallback((teamId: string, season: number) => {
    if (!isCommissioner) return
    setConfig((prev) => {
      const existing = prev.entries.find((e) => e.teamId === teamId)
      const currentSeasons = existing?.paidSeasons ?? []
      const hasSeason = currentSeasons.includes(season)
      const newSeasons = hasSeason
        ? currentSeasons.filter((s) => s !== season)
        : [...currentSeasons, season].sort()
      const newPaid = newSeasons.length > 0
      const newEntries = prev.entries.filter((e) => e.teamId !== teamId)
      newEntries.push({
        teamId,
        paid: newPaid,
        paidSeasons: newSeasons,
        paidAt: newPaid ? new Date().toISOString() : null,
      })
      return { ...prev, entries: newEntries }
    })
  }, [isCommissioner])

  // Save
  const save = useCallback(async () => {
    setSaving(true); setError(null); setSuccess(null)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/dues`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Save failed'); return }
      setConfig(data.config)
      setSuccess('Dues tracker saved!')
      setTimeout(() => setSuccess(null), 3000)
    } catch { setError('Request failed') }
    finally { setSaving(false) }
  }, [leagueId, config])

  const paidCount = useMemo(() => config.entries.filter((e) => e.paid).length, [config.entries])
  const seasonOptions = useMemo(() => {
    const years: number[] = []
    for (let y = currentSeason; y <= currentSeason + 3; y++) years.push(y)
    return years
  }, [currentSeason])

  if (loading) return <div className="py-8 text-center text-sm text-white/50">Loading dues tracker...</div>

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-white">{t('dues.title')}</h3>
        <p className="mt-0.5 text-xs text-white/50">{t('dues.subtitle')}</p>
      </div>

      {/* Payment links — FanCred + LeagueSafe */}
      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">{t('dues.paymentPlatforms')}</p>
        <div className="flex gap-2">
          <a
            href="https://fancred.app"
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-gradient-to-r from-emerald-600/20 to-cyan-600/20 px-4 py-3 text-[13px] font-bold text-emerald-200 transition hover:from-emerald-600/30 hover:to-cyan-600/30"
          >
            <DollarSign className="h-4 w-4" />
            FanCred.app
            <ExternalLink className="h-3 w-3 opacity-50" />
          </a>
          <a
            href="https://leaguesafe.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-blue-500/30 bg-gradient-to-r from-blue-600/20 to-indigo-600/20 px-4 py-3 text-[13px] font-bold text-blue-200 transition hover:from-blue-600/30 hover:to-indigo-600/30"
          >
            <DollarSign className="h-4 w-4" />
            LeagueSafe
            <ExternalLink className="h-3 w-3 opacity-50" />
          </a>
        </div>
      </div>

      {/* Dues amount (commissioner only) */}
      {isCommissioner && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">{t('dues.duesAmount')}</p>
          <div className="flex items-center gap-2">
            <span className="text-[14px] text-white/50">$</span>
            <input
              type="number"
              min={0}
              step={1}
              value={config.amount ?? ''}
              onChange={(e) => setConfig((prev) => ({ ...prev, amount: e.target.value ? parseFloat(e.target.value) : null }))}
              placeholder="0"
              className="w-24 rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2 text-[14px] font-medium text-white placeholder:text-white/20 focus:border-cyan-500/40 focus:outline-none"
            />
            <span className="text-[12px] text-white/30">per team</span>
          </div>
        </div>
      )}

      {/* Payment summary */}
      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-gradient-to-r from-emerald-950/20 to-transparent px-3 py-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20">
          <Check className="h-4 w-4 text-emerald-400" />
        </div>
        <div>
          <span className="text-[13px] font-semibold text-white">{paidCount} / {teams.length}</span>
          <span className="ml-1.5 text-[12px] text-white/40">{t('dues.membersPaid')}</span>
        </div>
        {config.amount && (
          <span className="ml-auto text-[12px] font-medium text-emerald-300">
            ${paidCount * config.amount} / ${teams.length * config.amount}
          </span>
        )}
      </div>

      {/* Status messages */}
      {error && <div className="rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300">{error}</div>}
      {success && <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">{success}</div>}

      {/* Member payment list */}
      <div className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">Member Payment Status</p>
        {teams.map((team) => {
          const entry = getEntry(team.id)
          const isPaid = entry.paid

          return (
            <div
              key={team.id}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition ${
                isPaid ? 'bg-emerald-950/15' : 'hover:bg-white/[0.02]'
              }`}
            >
              {/* Avatar */}
              {team.avatarUrl ? (
                <img src={team.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full border border-white/10 object-cover" />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[11px] font-bold text-white/30">
                  {(team.teamName ?? '?')[0]}
                </div>
              )}

              {/* Name */}
              <div className="min-w-0 flex-1">
                <span className="text-[13px] font-medium text-white">
                  {team.ownerName || team.teamName}
                </span>
                {isPaid && (
                  <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[11px] font-bold uppercase text-emerald-300">
                    Paid
                  </span>
                )}
              </div>

              {/* Dynasty/C2C/Devy: season dropdown */}
              {isMultiSeason && isCommissioner && isPaid && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setSeasonDropdownOpen(seasonDropdownOpen === team.id ? null : team.id)}
                    className="flex items-center gap-1 rounded border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/50 hover:bg-white/10"
                  >
                    {entry.paidSeasons.length > 0 ? entry.paidSeasons.join(', ') : 'Seasons'}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {seasonDropdownOpen === team.id && (
                    <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg border border-white/15 bg-[#0d1526] py-1 shadow-xl">
                      {seasonOptions.map((year) => {
                        const isChecked = entry.paidSeasons.includes(year)
                        return (
                          <button
                            key={year}
                            type="button"
                            onClick={() => toggleSeasonPaid(team.id, year)}
                            className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] text-white/70 hover:bg-white/[0.06]"
                          >
                            <span>{year}</span>
                            {isChecked && <Check className="h-3 w-3 text-emerald-400" />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Paid button — commissioner only */}
              {isCommissioner && (
                <button
                  type="button"
                  onClick={() => togglePaid(team.id)}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold transition ${
                    isPaid
                      ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                      : 'border border-white/20 bg-white/5 text-white/40 hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300'
                  }`}
                  title={isPaid ? 'Mark unpaid' : 'Mark paid'}
                >
                  P
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Save (commissioner only) */}
      {isCommissioner && (
        <div className="border-t border-white/10 pt-3">
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="w-full rounded-lg bg-gradient-to-r from-emerald-600/80 to-cyan-600/80 px-4 py-2.5 text-sm font-medium text-white hover:from-emerald-600 hover:to-cyan-600 disabled:opacity-50 transition"
          >
            {saving ? t('scoring.saving') : t('dues.saveDues')}
          </button>
        </div>
      )}

      {!isCommissioner && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-white/40">
          {t('dues.readOnlyBanner')}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-white/25">
        {t('dues.disclaimer')}
      </p>
    </div>
  )
}
