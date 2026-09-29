'use client'

/**
 * components/league-settings/RenewLeagueModal.tsx
 * Renew League modal — full post-season renewal workflow.
 * - Change league type (Redraft/Keeper/Dynasty)
 * - Remove members (unchecked = removed), commissioner protected
 * - Auto-removes orphan/departed managers, labels them with blue "O"
 * - Free ↔ Paid toggle
 * - League finder listing prompt
 * - Dispersal draft highlight when 2+ orphans
 * - Player rankings attached to history
 * - Previous season → AF League History
 * - All settings preserved (roster, scoring, draft, etc.)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { X, Check, AlertTriangle, Search as SearchIcon, Globe } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RenewMember {
  id: string
  teamName: string
  ownerName: string
  avatarUrl: string | null
  platformUserId: string | null
  isCommissioner: boolean
  wins: number
  losses: number
  pointsFor: number
  rank: number
}

interface OrphanMember {
  id: string
  teamName: string
  ownerName: string | null
}

const LEAGUE_TYPES = [
  {
    value: 'redraft',
    label: 'Redraft',
    tag: '(most popular)',
    description: 'All rosters from this season are reset. Owners must participate in a draft where all players are available.',
  },
  {
    value: 'keeper',
    label: 'Keeper',
    tag: '',
    description: 'Each owner can designate players to keep on their roster for next season. The number of keepers is customizable via league settings.',
  },
  {
    value: 'dynasty',
    label: 'Dynasty',
    tag: '',
    description: 'All rosters stay with owners. Owners will need to conduct a draft from the new rookies and free agent pool.',
  },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  leagueId: string
  isOpen: boolean
  onClose: () => void
  onRenewed?: () => void
}

export function RenewLeagueModal({ leagueId, isOpen, onClose, onRenewed }: Props) {
  const { t } = useLanguage()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [nextSeason, setNextSeason] = useState(2026)
  const [currentSeason, setCurrentSeason] = useState(2025)
  const [currentLeagueType, setCurrentLeagueType] = useState('redraft')
  const [selectedType, setSelectedType] = useState('redraft')
  const [members, setMembers] = useState<RenewMember[]>([])
  const [orphans, setOrphans] = useState<OrphanMember[]>([])
  const [checkedMembers, setCheckedMembers] = useState<Set<string>>(new Set())
  const [isDuesEnabled, setIsDuesEnabled] = useState(false)
  const [duesAmount, setDuesAmount] = useState<number | null>(null)
  const [renewalCompleted, setRenewalCompleted] = useState(false)
  const [listInFinder, setListInFinder] = useState(false)
  const [isListedInFinder, setIsListedInFinder] = useState(false)
  const [dispersalDraftEligible, setDispersalDraftEligible] = useState(false)
  const [step, setStep] = useState(1)
  const [tournamentHubPath, setTournamentHubPath] = useState<string | null>(null)

  // Post-renewal state
  const [result, setResult] = useState<{
    nextSeason: number
    orphanCount: number
    dispersalDraftEligible: boolean
    listedInFinder: boolean
  } | null>(null)

  useEffect(() => {
    if (isOpen) setStep(1)
  }, [isOpen])

  // Load
  useEffect(() => {
    if (!isOpen) return
    let active = true
    setLoading(true)
    setResult(null)
    setTournamentHubPath(null)
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/renew`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        setNextSeason(data.nextSeason ?? 2026)
        setCurrentSeason(data.currentSeason ?? 2025)
        const rawLt = String(data.leagueType ?? 'redraft').toLowerCase()
        const normalizedLt =
          rawLt.includes('c2c') ||
          rawLt === 'devy' ||
          rawLt === 'dynasty' ||
          rawLt === 'merged_devy_c2c' ||
          rawLt === 'dynasty_idp'
            ? 'dynasty'
            : rawLt === 'keeper'
              ? 'keeper'
              : 'redraft'
        setCurrentLeagueType(normalizedLt)
        setSelectedType(normalizedLt)
        setMembers(data.members ?? [])
        setOrphans(data.orphanMembers ?? [])
        setCheckedMembers(new Set((data.members ?? []).map((m: RenewMember) => m.id)))
        setIsDuesEnabled(data.isDuesEnabled ?? false)
        setDuesAmount(data.duesAmount ?? null)
        setRenewalCompleted(data.renewalCompleted ?? false)
        setIsListedInFinder(data.isListedInFinder ?? false)
        setDispersalDraftEligible(data.dispersalDraftEligible ?? false)
        const hub = data.tournamentFeeder?.renewFromHubPath
        setTournamentHubPath(typeof hub === 'string' && hub.startsWith('/') ? hub : null)
      })
      .catch(() => { if (active) setError('Failed to load') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [leagueId, isOpen])

  const toggleMember = useCallback((id: string) => {
    setCheckedMembers((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const removedCount = useMemo(
    () => members.filter((m) => !checkedMembers.has(m.id)).length,
    [members, checkedMembers]
  )

  const totalOrphansAfterRenewal = useMemo(
    () => orphans.length + removedCount,
    [orphans, removedCount]
  )

  const handleRenew = useCallback(async () => {
    setSubmitting(true)
    setError(null)
    try {
      const removeMemberIds = members
        .filter((m) => !checkedMembers.has(m.id) && !m.isCommissioner)
        .map((m) => m.id)

      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueType: selectedType !== currentLeagueType ? selectedType : undefined,
          removeMemberIds,
          duesEnabled: isDuesEnabled,
          duesAmount,
          listInFinder,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 409 && data.renewFromHubPath) {
          setError(
            `${data.message ?? 'Renew from the tournament hub.'} ${typeof data.renewFromHubPath === 'string' ? `(${data.renewFromHubPath})` : ''}`,
          )
          return
        }
        setError(typeof data.message === 'string' ? data.message : data.error ?? 'Renewal failed')
        return
      }
      setResult(data)
      setRenewalCompleted(true)
      router.refresh()
      onRenewed?.()
    } catch { setError('Request failed') }
    finally { setSubmitting(false) }
  }, [leagueId, selectedType, currentLeagueType, members, checkedMembers, isDuesEnabled, duesAmount, listInFinder, onRenewed, router])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#0d1526] shadow-2xl">
        <button type="button" onClick={onClose}
          className="absolute right-4 top-4 z-10 text-white/30 hover:text-white/60 transition">
          <X className="h-5 w-5" />
        </button>

        <div className="p-6">
          <h2 className="text-[18px] font-bold text-white">{t('renew.title')}</h2>

          {loading ? (
            <p className="mt-6 text-center text-[13px] text-white/40">Loading...</p>
          ) : result ? (
            /* ═══════ POST-RENEWAL SUCCESS ═══════ */
            <div className="mt-6 space-y-5">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-6 text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20">
                  <Check className="h-7 w-7 text-emerald-400" />
                </div>
                <p className="text-[16px] font-bold text-white">{t('renew.successTitle').replace('{{year}}', String(result.nextSeason))}</p>
                <p className="mt-1 text-[12px] text-white/40">
                  {currentSeason} season saved to AF League History. All settings preserved.
                </p>
              </div>

              {/* Orphan summary */}
              {result.orphanCount > 0 && (
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/15 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-400/20 text-[11px] font-bold text-cyan-300">O</div>
                    <span className="text-[13px] font-semibold text-white">
                      {result.orphanCount} Orphan Team{result.orphanCount > 1 ? 's' : ''}
                    </span>
                  </div>
                  <p className="text-[12px] text-white/40">
                    Teams without managers are labeled as orphans and available for adoption.
                  </p>
                </div>
              )}

              {/* Dispersal draft highlight */}
              {result.dispersalDraftEligible && (
                <div className="rounded-xl border border-amber-500/20 bg-gradient-to-r from-amber-950/20 to-orange-950/20 p-4">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-400" />
                    <span className="text-[13px] font-bold text-amber-200">Dispersal Draft Available</span>
                  </div>
                  <p className="mt-1 text-[12px] text-white/40">
                    With {result.orphanCount} orphan teams, you can run a dispersal draft. Go to Draft Settings to set it up.
                  </p>
                </div>
              )}

              {/* League finder confirmation */}
              {result.listedInFinder && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-950/15 px-3 py-2">
                  <Globe className="h-4 w-4 text-emerald-400" />
                  <span className="text-[12px] text-emerald-200/80">League listed in League Finder</span>
                </div>
              )}

              <button type="button" onClick={onClose}
                className="w-full rounded-lg bg-cyan-600/80 px-6 py-2.5 text-sm font-medium text-white hover:bg-cyan-600">
                Close
              </button>
            </div>
          ) : renewalCompleted ? (
            <div className="mt-6 text-center space-y-4">
              <Check className="mx-auto h-10 w-10 text-emerald-400" />
              <p className="text-[14px] text-white/60">League already renewed for {nextSeason}.</p>
              <button type="button" onClick={onClose}
                className="rounded-lg bg-cyan-600/80 px-6 py-2.5 text-sm font-medium text-white hover:bg-cyan-600">Close</button>
            </div>
          ) : tournamentHubPath ? (
            <div className="mt-6 space-y-4">
              <p className="text-[13px] leading-relaxed text-white/55">{t('renew.tournamentHubHint')}</p>
              <Link
                href={tournamentHubPath}
                className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-6 py-3 text-[14px] font-bold uppercase tracking-wide text-white shadow-lg shadow-cyan-500/20"
              >
                {t('renew.tournamentHubCta').replace('{{year}}', String(nextSeason))}
              </Link>
            </div>
          ) : (
            /* ═══════ 3-STEP RENEWAL ═══════ */
            <div className="mt-5 space-y-6">
              <div className="flex gap-1.5">
                {[1, 2, 3].map((s) => (
                  <div
                    key={s}
                    className={`h-1 flex-1 rounded-full ${step >= s ? 'bg-cyan-500' : 'bg-white/10'}`}
                  />
                ))}
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300">{error}</div>
              )}

              {step === 1 && (
                <div className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-400/90">{t('renew.step1Title')}</p>
                  <p className="text-[13px] leading-relaxed text-white/60">{t('renew.step1Body')}</p>
                  <ul className="list-disc space-y-1.5 pl-4 text-[12px] text-white/45">
                    <li>
                      <strong className="text-white/70">Dynasty / C2C / Devy:</strong> managers, rosters, and history stay
                      on the league — same idea as Sleeper dynasty continuity (rookies/FA draft next).
                    </li>
                    <li>
                      <strong className="text-white/70">Redraft:</strong> league history and scoring carry over; player
                      rosters reset for a new draft (Sleeper redraft reset).
                    </li>
                    <li>
                      <strong className="text-white/70">Keeper:</strong> full rosters remain with teams until you run
                      keeper lock / draft (Sleeper-style keeper carry).
                    </li>
                  </ul>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-400/90">{t('renew.step2Title')}</p>

                  <div className="space-y-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">League Type</p>
                    {LEAGUE_TYPES.map((type) => (
                      <label key={type.value}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg p-3 transition ${
                          selectedType === type.value ? 'bg-white/[0.05]' : 'hover:bg-white/[0.02]'
                        }`}>
                        <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                          selectedType === type.value ? 'border-cyan-400 bg-cyan-400' : 'border-white/30'
                        }`}>
                          {selectedType === type.value && <div className="h-2 w-2 rounded-full bg-[#0d1526]" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <input type="radio" name="leagueType" value={type.value}
                            checked={selectedType === type.value} onChange={() => setSelectedType(type.value)} className="sr-only" />
                          <span className="text-[14px] font-medium text-white/80">
                            {type.label}
                            {type.tag && <span className="ml-1.5 text-[11px] text-white/30">{type.tag}</span>}
                          </span>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-white/40">{type.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>

                  {orphans.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">Auto-Removed (Orphans)</p>
                      <div className="rounded-lg border border-cyan-500/15 bg-cyan-950/10 p-2 space-y-1">
                        {orphans.map((o) => (
                          <div key={o.id} className="flex items-center gap-2 px-2 py-1.5">
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-400/20 text-[11px] font-bold text-cyan-300">O</div>
                            <span className="text-[13px] text-white/50 line-through">{o.teamName || o.ownerName || 'Unknown'}</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[11px] text-white/25">These teams had no manager and will be marked as orphans.</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">Invite Members</p>
                    {removedCount > 0 && (
                      <p className="text-[11px] text-amber-300/70">
                        {removedCount} member{removedCount !== 1 ? 's' : ''} will be removed.
                      </p>
                    )}
                    <div className="space-y-0.5">
                      {members.map((member) => {
                        const checked = checkedMembers.has(member.id)
                        return (
                          <label key={member.id}
                            className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 transition hover:bg-white/[0.03]">
                            <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                              checked ? 'border-cyan-400 bg-cyan-400/20' : 'border-white/20'
                            }`}>
                              {checked && <Check className="h-3 w-3 text-cyan-300" />}
                            </div>
                            <input type="checkbox" checked={checked}
                              onChange={() => { if (!member.isCommissioner) toggleMember(member.id) }}
                              disabled={member.isCommissioner} className="sr-only" />
                            <span className="flex-1 text-[14px] text-white/80">{member.ownerName || member.teamName}</span>
                            {member.isCommissioner && <span className="text-[11px] text-amber-300/50">Commissioner</span>}
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  {totalOrphansAfterRenewal >= 2 && (
                    <div className="rounded-xl border border-amber-500/20 bg-gradient-to-r from-amber-950/15 to-orange-950/15 p-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-400" />
                        <span className="text-[12px] font-bold text-amber-200">Dispersal Draft Recommended</span>
                      </div>
                      <p className="mt-1 text-[11px] text-white/40">
                        With {totalOrphansAfterRenewal} open team{totalOrphansAfterRenewal > 1 ? 's' : ''}, a dispersal draft
                        will be available in Draft Settings after renewal.
                      </p>
                    </div>
                  )}

                  {totalOrphansAfterRenewal > 0 && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3">
                      <div className="flex items-center gap-2">
                        <SearchIcon className="h-4 w-4 text-cyan-400" />
                        <div>
                          <p className="text-[12px] font-medium text-white/80">List in League Finder?</p>
                          <p className="text-[11px] text-white/30">
                            Help new managers find your league
                          </p>
                        </div>
                      </div>
                      <button type="button" role="switch" aria-checked={listInFinder}
                        onClick={() => setListInFinder((v) => !v)}
                        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                          listInFinder ? 'bg-cyan-500' : 'bg-white/15'
                        }`}>
                        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                          listInFinder ? 'translate-x-[22px]' : 'translate-x-0.5'
                        }`} />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-400/90">{t('renew.step3Title')}</p>
                  <p className="text-[13px] text-white/55">
                    Moving <strong className="text-white/85">{currentSeason}</strong> →{' '}
                    <strong className="text-white/85">{nextSeason}</strong> as{' '}
                    <strong className="text-white/85">
                      {LEAGUE_TYPES.find((x) => x.value === selectedType)?.label ?? selectedType}
                    </strong>
                    . {dispersalDraftEligible ? ' Dispersal draft may apply.' : ''}
                  </p>
                  <p className="text-[12px] text-white/35">
                    {selectedType === 'redraft'
                      ? 'Player rosters will clear for the new draft; league settings and history are kept.'
                      : selectedType === 'keeper'
                        ? 'Rosters remain with teams for keeper processing (aligned with Sleeper keeper carry).'
                        : 'Rosters and managers stay with the league (Sleeper-style dynasty continuity).'}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {step > 1 ? (
                  <button type="button"
                    onClick={() => setStep((s) => Math.max(1, s - 1))}
                    className="rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white/80 hover:bg-white/[0.07]">
                    {t('renew.back')}
                  </button>
                ) : null}
                {step < 3 ? (
                  <button type="button"
                    onClick={() => setStep((s) => Math.min(3, s + 1))}
                    className="ml-auto rounded-lg bg-cyan-600/80 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-600">
                    {t('renew.next')}
                  </button>
                ) : (
                  <button type="button" disabled={submitting} onClick={handleRenew}
                    className="ml-auto rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-6 py-2.5 text-sm font-bold uppercase tracking-wide text-white shadow-lg shadow-cyan-500/20 disabled:opacity-50">
                    {submitting ? t('renew.renewing') : t('renew.confirmRenew')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
