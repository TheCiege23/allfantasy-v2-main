'use client'

/**
 * components/league-settings/LeagueDuesTrackerPanel.tsx
 * League Dues Tracker — TRACKING ONLY (lib/dues/duesTracker.ts). AllFantasy never holds league money.
 *
 *   Commissioner  amount, due date, where to pay (Venmo, Cash App, PayPal, LeagueSafe, FanCred, other),
 *                 who has paid — confirming a member's "I paid" is marking them paid.
 *   Member        what they owe, by when, the league's own payment links, and "I paid", which tells the
 *                 commissioner. It never marks them paid.
 *   Dynasty / C2C / devy / keeper: the commissioner can mark seasons paid ahead.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, DollarSign, ExternalLink, ChevronDown } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import {
  MAX_PAYMENT_LINKS,
  PAYMENT_LINK_KINDS,
  PAYMENT_LINK_LABEL,
  formatAmount,
  readDuesConfig,
  teamPaid,
  type DuesConfig,
  type DuesEntry,
  type PaymentLink,
  type PaymentLinkKind,
} from '@/lib/dues/duesTracker'

interface TeamInfo {
  id: string
  teamName: string | null
  ownerName: string | null
  avatarUrl: string | null
}

interface Props {
  leagueId: string
}

type LinkDraft = { kind: PaymentLinkKind; url: string }

export function LeagueDuesTrackerPanel({ leagueId }: Props) {
  const { t } = useLanguage()
  const endpoint = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/dues`
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isCommissioner, setIsCommissioner] = useState(false)
  const [isMultiSeason, setIsMultiSeason] = useState(false)
  const [currentSeason, setCurrentSeason] = useState(2025)
  const [myTeamId, setMyTeamId] = useState<string | null>(null)
  const [config, setConfig] = useState<DuesConfig>(() => readDuesConfig(null))
  const [links, setLinks] = useState<LinkDraft[]>([])
  const [teams, setTeams] = useState<TeamInfo[]>([])
  const [seasonDropdownOpen, setSeasonDropdownOpen] = useState<string | null>(null)
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'sent'>('idle')

  const adopt = useCallback((raw: unknown) => {
    const c = readDuesConfig(raw)
    setConfig(c)
    setLinks(c.paymentLinks.map((l) => ({ ...l })))
  }, [])

  useEffect(() => {
    let active = true
    fetch(endpoint, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        adopt(data.config)
        setIsCommissioner(data.isCommissioner ?? false)
        setTeams(data.teams ?? [])
        setCurrentSeason(data.currentSeason ?? 2025)
        setIsMultiSeason(data.isMultiSeason ?? false)
        setMyTeamId(typeof data.myTeamId === 'string' ? data.myTeamId : null)
      })
      .catch(() => { if (active) setError(t('dues.loadFailed')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [endpoint, adopt]) // eslint-disable-line react-hooks/exhaustive-deps

  const getEntry = useCallback((teamId: string): DuesEntry => {
    return config.entries.find((e) => e.teamId === teamId) ?? { teamId, paid: false, paidSeasons: [], paidAt: null }
  }, [config.entries])

  const setEntry = useCallback((teamId: string, patch: (e: DuesEntry) => DuesEntry) => {
    setConfig((prev) => {
      const existing = prev.entries.find((e) => e.teamId === teamId) ?? { teamId, paid: false, paidSeasons: [], paidAt: null }
      return { ...prev, entries: [...prev.entries.filter((e) => e.teamId !== teamId), patch(existing)] }
    })
  }, [])

  const togglePaid = useCallback((teamId: string) => {
    if (!isCommissioner) return
    setEntry(teamId, (e) => {
      const paid = !e.paid
      return { ...e, paid, paidSeasons: paid ? (e.paidSeasons.length ? e.paidSeasons : [currentSeason]) : [], paidAt: paid ? new Date().toISOString() : null }
    })
  }, [isCommissioner, currentSeason, setEntry])

  const toggleSeasonPaid = useCallback((teamId: string, season: number) => {
    if (!isCommissioner) return
    setEntry(teamId, (e) => {
      const seasons = e.paidSeasons.includes(season) ? e.paidSeasons.filter((s) => s !== season) : [...e.paidSeasons, season].sort()
      return { ...e, paid: seasons.length > 0, paidSeasons: seasons, paidAt: seasons.length > 0 ? e.paidAt ?? new Date().toISOString() : null }
    })
  }, [isCommissioner, setEntry])

  const save = useCallback(async () => {
    setSaving(true); setError(null); setSuccess(null)
    try {
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: config.enabled,
          amount: config.amount,
          dueDate: config.dueDate,
          paymentLinks: links.filter((l) => l.url.trim()).map((l) => ({ kind: l.kind, url: l.url.trim() })),
          entries: config.entries,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? t('leagueSettings.saveFailed')); return }
      adopt(data.config)
      setSuccess(t('dues.saved'))
      setTimeout(() => setSuccess(null), 3000)
    } catch { setError(t('leagueSettings.requestFailed')) }
    finally { setSaving(false) }
  }, [endpoint, config, links, adopt]) // eslint-disable-line react-hooks/exhaustive-deps

  const reportPaid = useCallback(async () => {
    setReportState('sending'); setError(null)
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'i_paid' }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? t('leagueSettings.requestFailed')); setReportState('idle'); return }
      adopt(data.config)
      setReportState('sent')
    } catch { setError(t('leagueSettings.requestFailed')); setReportState('idle') }
  }, [endpoint, adopt]) // eslint-disable-line react-hooks/exhaustive-deps

  const paidCount = useMemo(() => teams.filter((tm) => teamPaid(config, tm.id, currentSeason, isMultiSeason)).length, [teams, config, currentSeason, isMultiSeason])
  const seasonOptions = useMemo(() => {
    const years: number[] = []
    for (let y = currentSeason; y <= currentSeason + 3; y++) years.push(y)
    return years
  }, [currentSeason])

  const kindLabel = (k: PaymentLinkKind) => (k === 'other' ? t('dues.kindOther') : PAYMENT_LINK_LABEL[k])

  if (loading) return <div className="py-8 text-center text-sm text-white/50">{t('dues.loading')}</div>

  const myEntry = myTeamId ? getEntry(myTeamId) : null
  const myPaid = myTeamId ? teamPaid(config, myTeamId, currentSeason, isMultiSeason) : false
  const owes = myTeamId != null && config.amount != null && !myPaid
  const amountText = formatAmount(config)

  return (
    <div className="space-y-5" data-testid="dues-tracker">
      <div>
        <h3 className="text-base font-semibold text-white">{t('dues.title')}</h3>
        <p className="mt-0.5 text-xs text-white/50">{t('dues.subtitle')}</p>
      </div>

      {/* The viewer's own dues: what, by when, where — and "I paid". */}
      {myTeamId && config.amount != null && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3" data-testid="dues-mine">
          {myPaid ? (
            <p className="flex items-center gap-2 text-[13px] font-semibold text-emerald-300">
              <Check className="h-4 w-4" /> {t('dues.youPaid')}
            </p>
          ) : (
            <>
              <p className="text-[13px] text-white/70">
                {t('dues.youOwe')} <span className="text-[16px] font-bold text-white">{amountText}</span>
                {config.dueDate ? <span className="ml-2 text-white/50">· {t('dues.dueOn')} {config.dueDate}</span> : null}
              </p>
              {config.paymentLinks.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {config.paymentLinks.map((l) => (
                    <a
                      key={`${l.kind}-${l.url}`}
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-600/15 px-4 text-[13px] font-bold text-emerald-200 hover:bg-emerald-600/25"
                    >
                      <DollarSign className="h-4 w-4" />
                      {kindLabel(l.kind)}
                      <ExternalLink className="h-3 w-3 opacity-50" />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-[12px] text-white/45">{t('dues.noLinkYet')}</p>
              )}
              {owes && (
                <div className="mt-3">
                  {myEntry?.selfReportedAt || reportState === 'sent' ? (
                    <p className="text-[12px] text-sky-200/70">{t('dues.iPaidSent')}</p>
                  ) : (
                    <button
                      type="button"
                      disabled={reportState === 'sending'}
                      onClick={() => void reportPaid()}
                      className="min-h-[44px] rounded-lg border border-white/20 bg-white/5 px-4 text-[13px] font-semibold text-white hover:bg-white/10 disabled:opacity-50"
                      data-testid="dues-i-paid"
                    >
                      {t('dues.iPaid')}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Commissioner: amount, due date, where to pay. */}
      {isCommissioner && (
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-white/80">{t('dues.track')}</span>
            <input type="checkbox" className="h-5 w-5" checked={config.enabled} onChange={(e) => setConfig((p) => ({ ...p, enabled: e.target.checked }))} />
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
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
                <span className="text-[12px] text-white/30">{t('dues.perTeam')}</span>
              </div>
            </div>
            <label className="space-y-1">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-white/40">{t('dues.dueDate')}</span>
              <input
                type="date"
                value={config.dueDate ?? ''}
                onChange={(e) => setConfig((p) => ({ ...p, dueDate: e.target.value || null }))}
                className="rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2 text-[14px] text-white focus:border-cyan-500/40 focus:outline-none"
              />
            </label>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">{t('dues.whereToPay')}</p>
            {links.map((l, i) => (
              <div key={i} className="flex flex-wrap gap-2">
                <select
                  value={l.kind}
                  onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, kind: e.target.value as PaymentLinkKind } : x)))}
                  className="rounded-lg border border-white/15 bg-[#0d1526] px-2 py-2 text-[13px] text-white"
                >
                  {PAYMENT_LINK_KINDS.map((k) => (
                    <option key={k} value={k}>{kindLabel(k)}</option>
                  ))}
                </select>
                <input
                  type="url"
                  inputMode="url"
                  value={l.url}
                  placeholder={t('dues.linkPlaceholder')}
                  onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                  className="min-w-0 flex-1 rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2 text-[13px] text-white placeholder:text-white/25"
                />
                <button type="button" onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))} className="text-[12px] text-white/50 underline">
                  {t('dues.removeLink')}
                </button>
              </div>
            ))}
            {links.length < MAX_PAYMENT_LINKS && (
              <button type="button" onClick={() => setLinks((ls) => [...ls, { kind: 'venmo', url: '' } as PaymentLink])} className="min-h-[44px] rounded-lg border border-white/15 px-3 text-[12px] text-white/70 hover:bg-white/5">
                + {t('dues.addLink')}
              </button>
            )}
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
        {config.amount != null && (
          <span className="ml-auto text-[12px] font-medium text-emerald-300">
            ${paidCount * config.amount} / ${teams.length * config.amount}
          </span>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300" role="alert">{error}</div>}
      {success && <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">{success}</div>}

      {/* Member payment list */}
      <div className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">{t('dues.paymentStatus')}</p>
        {teams.map((team) => {
          const entry = getEntry(team.id)
          const isPaid = entry.paid
          const claims = !isPaid && Boolean(entry.selfReportedAt)
          return (
            <div key={team.id} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition ${isPaid ? 'bg-emerald-950/15' : 'hover:bg-white/[0.02]'}`}>
              {team.avatarUrl ? (
                <img src={team.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full border border-white/10 object-cover" />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[11px] font-bold text-white/30">
                  {(team.teamName ?? '?')[0]}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <span className="text-[13px] font-medium text-white">{team.ownerName || team.teamName}</span>
                {isPaid && (
                  <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[11px] font-bold uppercase text-emerald-300">{t('dues.paid')}</span>
                )}
                {claims && (
                  <span className="ml-2 rounded bg-sky-500/20 px-1.5 py-0.5 text-[11px] font-bold uppercase text-sky-200" data-testid="dues-says-paid">
                    {t('dues.saysPaid')}
                  </span>
                )}
              </div>

              {isMultiSeason && isCommissioner && isPaid && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setSeasonDropdownOpen(seasonDropdownOpen === team.id ? null : team.id)}
                    className="flex items-center gap-1 rounded border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/50 hover:bg-white/10"
                  >
                    {entry.paidSeasons.length > 0 ? entry.paidSeasons.join(', ') : t('dues.seasons')}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {seasonDropdownOpen === team.id && (
                    <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg border border-white/15 bg-[#0d1526] py-1 shadow-xl">
                      {seasonOptions.map((year) => (
                        <button
                          key={year}
                          type="button"
                          onClick={() => toggleSeasonPaid(team.id, year)}
                          className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] text-white/70 hover:bg-white/[0.06]"
                        >
                          <span>{year}</span>
                          {entry.paidSeasons.includes(year) && <Check className="h-3 w-3 text-emerald-400" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {isCommissioner && (
                <button
                  type="button"
                  onClick={() => togglePaid(team.id)}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[12px] font-bold transition ${
                    isPaid
                      ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                      : 'border border-white/20 bg-white/5 text-white/40 hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300'
                  }`}
                  title={isPaid ? t('dues.markUnpaid') : t('dues.markPaid')}
                >
                  P
                </button>
              )}
            </div>
          )
        })}
      </div>

      {isCommissioner && (
        <div className="border-t border-white/10 pt-3">
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="min-h-[44px] w-full rounded-lg bg-gradient-to-r from-emerald-600/80 to-cyan-600/80 px-4 py-2.5 text-sm font-medium text-white hover:from-emerald-600 hover:to-cyan-600 disabled:opacity-50 transition"
          >
            {saving ? t('scoring.saving') : t('dues.saveDues')}
          </button>
        </div>
      )}

      {!isCommissioner && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-white/40">{t('dues.readOnlyBanner')}</div>
      )}

      <p className="text-[11px] leading-relaxed text-white/25">{t('dues.disclaimer')}</p>
    </div>
  )
}
