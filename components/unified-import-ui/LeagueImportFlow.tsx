'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { HelpCircle, ChevronDown } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import CanonicalImportSummaryCard, { type CanonicalPreview } from '@/components/league-import/CanonicalImportSummaryCard'
import { UnifiedImportPanel } from '@/components/UnifiedImportPanel'
import {
  fetchImportPreview,
  submitImportCreation,
  discoverProviderLeagues,
} from '@/lib/league-import/LeagueCreationImportSubmissionService'
import type { ImportProvider } from '@/lib/league-import/types'
import { providerRequiresCommissionerAttestation } from '@/lib/league-import/attestationProviders'
import type { LegacyPlatformTab } from '@/lib/import/importSearchParams'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { LegacyImportResults } from '@/components/unified-import-ui/LegacyImportResults'
import { CommissionerAttestationPanel } from '@/components/unified-import-ui/CommissionerAttestationPanel'

const PREVIEW_PROVIDERS: ImportProvider[] = ['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker']

export type { LegacyPlatformTab }

export type LeagueImportFlowProps = {
  userId: string
  defaultProvider?: LegacyPlatformTab
  returnTo: string
  mode?: 'full' | 'embedded' | 'legacy'
  autoFocus?: boolean
  showBackButton?: boolean
  showSupportButton?: boolean
  onCompleteRedirect?: string
  /** Prefill Sleeper username from query */
  initialSleeperUsername?: string
  /** Prefill league id / source for non-Sleeper tabs */
  initialLeagueSourceId?: string
}

// All five tabs, including Sleeper, route through the same canonical
// preview -> commit pipeline (`/api/leagues/import/preview` + `/commit`) —
// there is no provider-specific special case here. Legacy Sleeper
// profile/career-history import remains a deliberately separate product
// surface (`components/rankings/LegacyRankingsImportPanel.tsx`), not a
// branch of this commissioner-import flow.
function tabToImportProvider(tab: LegacyPlatformTab): ImportProvider | null {
  return tab
}

export function LeagueImportFlow({
  userId,
  defaultProvider = 'sleeper',
  returnTo,
  mode = 'full',
  autoFocus = true,
  showBackButton = true,
  showSupportButton = true,
  onCompleteRedirect,
  initialSleeperUsername = '',
  initialLeagueSourceId = '',
}: LeagueImportFlowProps) {
  const { t } = useLanguage()
  const router = useRouter()
  const [tab, setTab] = useState<LegacyPlatformTab>(defaultProvider)

  const [resultsKind, setResultsKind] = useState<'idle' | 'league_created'>('idle')
  const [leagueSuccess, setLeagueSuccess] = useState<{
    leagueId: string
    leagueName: string
    sport: string
  } | null>(null)

  // Sleeper account discovery: username -> the same canonical discover route
  // used by the (currently unused-elsewhere) generic discovery service. This
  // is the "League discovery" affordance for Sleeper specifically — Sleeper
  // is the only provider with a working discovery endpoint today
  // (`/api/leagues/import/discover`); other providers keep manual ID entry.
  const [sleeperUsername, setSleeperUsername] = useState(initialSleeperUsername)
  const [discoveringLeagues, setDiscoveringLeagues] = useState(false)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [discoveredLeagues, setDiscoveredLeagues] = useState<
    Array<{ sourceId: string; name: string; sport: string; season: string; totalTeams?: number; isDynasty?: boolean }> | null
  >(null)
  const [sleeperSelectedSourceId, setSleeperSelectedSourceId] = useState<string | null>(null)

  const [loadingProvider, setLoadingProvider] = useState<ImportProvider | null>(null)
  const [failedPreview, setFailedPreview] = useState<{ provider: ImportProvider; sourceInput: string } | null>(null)
  const [previewInfo, setPreviewInfo] = useState<{
    provider: ImportProvider
    sourceInput: string
    leagueName: string
    canonical: CanonicalPreview | null
  } | null>(null)
  const [committing, setCommitting] = useState(false)
  const [conflict, setConflict] = useState<{ message: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // Commissioner Import Attestation UI phase — plain component state, never
  // persisted to storage, so a refresh or a league/provider change always
  // starts unchecked (see CommissionerAttestationPanel's own header comment).
  const [attestationAccepted, setAttestationAccepted] = useState(false)
  const [attestationStatement, setAttestationStatement] = useState('')
  const [attestationRequiredByServer, setAttestationRequiredByServer] = useState(false)

  useEffect(() => {
    const pre = initialSleeperUsername.trim()
    if (pre) setSleeperUsername(pre)
  }, [initialSleeperUsername])

  async function discoverSleeperLeagues(e: React.FormEvent) {
    e.preventDefault()
    const username = sleeperUsername.trim()
    if (!username) return
    setDiscoveringLeagues(true)
    setDiscoveryError(null)
    setDiscoveredLeagues(null)
    setSleeperSelectedSourceId(null)
    try {
      const result = await discoverProviderLeagues('sleeper', username)
      if (!result.ok) {
        throw new Error(result.error || 'Could not find leagues for that Sleeper username.')
      }
      const data = result.data as {
        leagues?: Array<{ sourceId: string; name: string; sport: string; season: string; totalTeams?: number; isDynasty?: boolean }>
      }
      setDiscoveredLeagues(data?.leagues ?? [])
    } catch (e: unknown) {
      setDiscoveryError(e instanceof Error ? e.message : 'Could not find leagues for that Sleeper username.')
    } finally {
      setDiscoveringLeagues(false)
    }
  }

  function selectDiscoveredSleeperLeague(sourceId: string) {
    setSleeperSelectedSourceId(sourceId)
    void runPreview('sleeper', sourceId)
  }

  const commissionerSupport = useMemo(
    () =>
      ({
        sleeper: { status: 'verified' as const, detail: t('import.provider.sleeper.detail') },
        espn: { status: 'verified' as const, detail: t('import.provider.espn.detail') },
        yahoo: { status: 'verified' as const, detail: t('import.provider.yahoo.detail') },
        fantrax: { status: 'verified' as const, detail: t('import.provider.fantrax.detail') },
        mfl: { status: 'verified' as const, detail: t('import.provider.mfl.detail') },
        fleaflicker: { status: 'verified' as const, detail: t('import.provider.fleaflicker.detail') },
      }) satisfies Record<ImportProvider, { status: 'verified' | 'blocked'; detail: string }>,
    [t]
  )

  const activeImportProvider = tabToImportProvider(tab)
  const panelProviders: ImportProvider[] = useMemo(() => {
    if (!activeImportProvider) return []
    return PREVIEW_PROVIDERS.includes(activeImportProvider) ? [activeImportProvider] : []
  }, [activeImportProvider])

  const unifiedInitialInputs = useMemo(() => {
    if (activeImportProvider === 'sleeper' && sleeperSelectedSourceId) {
      return { sleeper: sleeperSelectedSourceId } as Partial<Record<ImportProvider, string>>
    }
    if (!initialLeagueSourceId.trim() || !activeImportProvider) return undefined
    return { [activeImportProvider]: initialLeagueSourceId.trim() } as Partial<
      Record<ImportProvider, string>
    >
  }, [initialLeagueSourceId, activeImportProvider, sleeperSelectedSourceId])

  // Part 3 — driven by the same shared classification the server's own
  // `assertImportCommissioner` uses (`MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER`,
  // re-exported client-safe from `attestationProviders.ts`), never a
  // provider list hard-coded in this component.
  const previewNeedsAttestation = previewInfo
    ? providerRequiresCommissionerAttestation(previewInfo.provider)
    : false
  const commitDisabled = committing || (previewNeedsAttestation && !attestationAccepted)

  async function runPreview(provider: ImportProvider, sourceInput: string) {
    setLoadingProvider(provider)
    setFormError(null)
    setPreviewInfo(null)
    setConflict(null)
    setFailedPreview(null)
    // A new preview means a (possibly) new league or provider — any prior
    // attestation confirmation must not silently carry over (Part 2
    // interaction requirement: changing the selected league or provider
    // clears prior confirmation).
    setAttestationAccepted(false)
    setAttestationStatement('')
    setAttestationRequiredByServer(false)
    try {
      const preview = await fetchImportPreview(provider, sourceInput)
      if (!preview.ok) {
        throw new Error(preview.error || t('import.error.previewFailed'))
      }
      const payload = preview.data as {
        league?: { name?: string }
        canonical?: CanonicalPreview | null
      }
      const leagueName = payload?.league?.name?.trim() || t('import.leagueDefaultName')
      const canonical = payload?.canonical ?? null
      setPreviewInfo({ provider, sourceInput, leagueName, canonical })
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : t('import.error.generic'))
      setFailedPreview({ provider, sourceInput })
    } finally {
      setLoadingProvider(null)
    }
  }

  async function handleUnifiedImport(provider: ImportProvider, sourceInput: string) {
    await runPreview(provider, sourceInput)
  }

  async function handleCommit(force = false) {
    if (!previewInfo) return
    const requiresAttestation = providerRequiresCommissionerAttestation(previewInfo.provider)
    // The commit button is already disabled in this state (see the render
    // below), but a defensive check here means this function can never
    // submit a commit that skips a required, unconfirmed attestation
    // regardless of how it's called.
    if (requiresAttestation && !attestationAccepted) {
      setAttestationRequiredByServer(true)
      return
    }
    setCommitting(true)
    setFormError(null)
    setConflict(null)
    try {
      const result = await submitImportCreation(
        previewInfo.provider,
        previewInfo.sourceInput,
        userId,
        requiresAttestation
          ? { accepted: true, statement: attestationStatement.trim() || undefined }
          : undefined,
        { force }
      )
      if (!result.ok) {
        if (result.status === 409) {
          setConflict({ message: result.error ?? t('import.conflict.default') })
          return
        }
        if (result.requiresAttestation) {
          // Defense in depth: the server is the authority. If it still says
          // attestation is required (e.g. this client's provider list ever
          // drifts from the real server contract), surface that plainly
          // rather than a generic error.
          setAttestationRequiredByServer(true)
          setFormError(t('import.error.attestationRequired'))
          return
        }
        throw new Error(result.error || t('import.error.commitFailed'))
      }
      const leagueId = result.data?.league.id
      const leagueName = result.data?.league.name ?? previewInfo.leagueName
      const sport = result.data?.league.sport ?? 'nfl'
      if (leagueId) {
        setLeagueSuccess({ leagueId, leagueName, sport })
        setResultsKind('league_created')
      }
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : t('import.error.commitFailed'))
    } finally {
      setCommitting(false)
    }
  }

  const hideMainChrome = resultsKind === 'league_created'

  const backButtonLabel = returnTo.includes('dashboard') ? 'Back to dashboard' : 'Back'
  const backButtonClass =
    'inline-flex h-9 items-center justify-center rounded-full border border-white/20 bg-white/5 px-3 text-xs font-semibold text-white/90 hover:bg-white/10'

  const topNavLeft = showBackButton
    ? React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => router.push(returnTo),
          className: backButtonClass,
        },
        backButtonLabel
      )
    : null

  const topNavRight = showSupportButton
    ? React.createElement(
        Link,
        {
          href: '/donate',
          className:
            'text-xs font-semibold text-red-300/90 underline-offset-2 hover:underline',
        },
        'Support AllFantasy'
      )
    : null

  const mainContainerClassName =
    'container mx-auto max-w-3xl px-4' + (hideMainChrome ? ' hidden' : '')

  // Phase 4.1 — pin dark tokens on the /import shell so labels/text/borders stay
  // readable in light mode (see `.af-import-shell` in globals.css).
  const rootShellClassName =
    mode === 'embedded'
      ? ''
      : 'af-import-shell min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 py-12 sm:py-20'

  return (
    <div className={rootShellClassName}>
      {resultsKind === 'league_created' && leagueSuccess && (
        <LegacyImportResults
          variant="league_created"
          returnTo={returnTo}
          leagueSuccess={leagueSuccess}
          onImportAnother={() => {
            setResultsKind('idle')
            setLeagueSuccess(null)
            setPreviewInfo(null)
          }}
          onCompleteRedirect={onCompleteRedirect}
        />
      )}

      <div className={mainContainerClassName}>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          {topNavLeft}
          {topNavRight}
        </div>

        {/*
          Phase 4.1 visual upgrade — Dashboard V2 hero language: tightened
          gradient headline (single-color to match the dashboard's premium
          restraint), an eyebrow chip anchoring the "step 1 of 2" mental model,
          and shared motion (`warroom-fade-in-stagger` on both the hero + card).
        */}
        <div className="warroom-fade-in-stagger relative mb-8">
          <div className="mx-auto mb-4 inline-flex w-full items-center justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/25 bg-cyan-500/[0.06] px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-cyan-300/85">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.6)]" aria-hidden />
              Step 1 · Choose Platform
            </span>
          </div>
          <h1 className="relative text-center text-4xl font-black tracking-tight text-transparent sm:text-5xl">
            <span className="bg-gradient-to-r from-cyan-300 via-cyan-200 to-white bg-clip-text">
              {t('import.title')}
            </span>
          </h1>
          <p className="relative mx-auto mt-3 max-w-xl text-center text-white/60">
            Bring your Sleeper, ESPN, Yahoo, Fantrax, or MFL league into AllFantasy as a real, playable league.
          </p>
          <p className="relative mt-2 text-center text-[13px] text-white/40">
            {t('import.settingsLink')}{' '}
            <Link href="/settings" className="text-cyan-400 underline hover:text-cyan-300">
              {t('import.settingsWord')}
            </Link>
            .
          </p>
        </div>

        <div className="warroom-card warroom-fade-in-stagger relative overflow-hidden rounded-3xl border border-white/10 bg-white/5">
          <div className="h-1 bg-gradient-to-r from-cyan-400/70 via-blue-400/50 to-cyan-400/70" />
          <div className="p-6 sm:p-8">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black tracking-tight text-white">Import your league</h2>
                <p className="mt-1 text-sm text-white/60">
                  Choose your platform, then preview and confirm before we create your league.
                </p>
              </div>
              <span className="hidden shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/[0.08] px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300 sm:inline-block">
                Live
              </span>
            </div>

            {/*
              Phase 4.1 — provider tabs upgraded from emoji chips to premium
              tiles with proper icons, a "Recommended" badge on Sleeper (the
              audit-blessed reference provider), shared `warroom-pressable`
              motion for hover+press, and a persistent status dot for the
              selected provider (color-grammar Recommend emerald when live).
              Test IDs preserved for regression safety.
            */}
            <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {(
                [
                  { id: 'sleeper', label: 'Sleeper', accent: 'cyan', recommended: true },
                  { id: 'yahoo', label: 'Yahoo', accent: 'purple', recommended: false },
                  { id: 'mfl', label: 'MFL', accent: 'amber', recommended: false },
                  { id: 'fantrax', label: 'Fantrax', accent: 'emerald', recommended: false },
                  { id: 'espn', label: 'ESPN', accent: 'red', recommended: false },
                ] as const
              ).map(({ id, label, accent, recommended }) => {
                const isActive = tab === id
                const accentRing =
                  accent === 'cyan'
                    ? 'border-cyan-400/50 bg-cyan-500/[0.12] text-white'
                    : accent === 'purple'
                      ? 'border-purple-400/45 bg-purple-500/[0.10] text-white'
                      : accent === 'amber'
                        ? 'border-amber-400/45 bg-amber-500/[0.10] text-white'
                        : accent === 'emerald'
                          ? 'border-emerald-400/45 bg-emerald-500/[0.10] text-white'
                          : 'border-red-400/45 bg-red-500/[0.10] text-white'
                const accentDot =
                  accent === 'cyan'
                    ? 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.6)]'
                    : accent === 'purple'
                      ? 'bg-purple-400 shadow-[0_0_10px_rgba(192,132,252,0.6)]'
                      : accent === 'amber'
                        ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.6)]'
                        : accent === 'emerald'
                          ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]'
                          : 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.6)]'
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setTab(id)
                      setFormError(null)
                      setPreviewInfo(null)
                      setConflict(null)
                      setAttestationAccepted(false)
                      setAttestationStatement('')
                      setAttestationRequiredByServer(false)
                    }}
                    aria-pressed={isActive}
                    className={`warroom-pressable relative flex min-w-[100px] flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-center text-sm font-black ${
                      isActive
                        ? accentRing
                        : 'border-white/10 bg-black/30 text-white/60 hover:border-white/25 hover:bg-black/40 hover:text-white'
                    }`}
                    data-testid={`import-tab-${id}`}
                  >
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        isActive ? accentDot : 'bg-white/25'
                      }`}
                      aria-hidden
                    />
                    <span className="text-[13px]">{label}</span>
                    {recommended ? (
                      <span
                        className="absolute -top-1.5 right-2 rounded-full border border-emerald-500/40 bg-emerald-500/[0.14] px-1.5 py-0 text-[8px] font-black uppercase tracking-wider text-emerald-300"
                        aria-label="Recommended provider"
                      >
                        Recommended
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>

            {tab === 'sleeper' && (
              <form onSubmit={(e) => void discoverSleeperLeagues(e)} className="mt-8 space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label htmlFor="import-sleeper-username" className="text-[11px] font-black uppercase tracking-[0.18em] text-white/60">
                      Sleeper Username
                    </label>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Discover leagues from account</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      id="import-sleeper-username"
                      type="text"
                      value={sleeperUsername}
                      onChange={(e) => setSleeperUsername(e.target.value)}
                      placeholder="your_username"
                      autoFocus={autoFocus && mode !== 'embedded'}
                      autoComplete="username"
                      className="flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-3.5 text-[15px] text-white placeholder:text-white/25 focus:border-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-400/25 disabled:opacity-60"
                      disabled={discoveringLeagues}
                    />
                    <button
                      type="submit"
                      disabled={discoveringLeagues || !sleeperUsername.trim()}
                      className="warroom-pressable shrink-0 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 text-sm font-black text-white shadow-[0_10px_40px_-15px_rgba(34,211,238,0.75)] disabled:opacity-40 disabled:shadow-none"
                      data-testid="import-sleeper-discover-cta"
                    >
                      {discoveringLeagues ? 'Loading preview...' : 'Find my leagues'}
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-white/45">
                    Or paste a Sleeper league ID directly below if you already know it.
                  </p>
                </div>
                {discoveryError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.08] px-3 py-2.5 text-sm text-red-200"
                  >
                    <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden />
                    <span>{discoveryError}</span>
                  </div>
                )}
                {discoveredLeagues && discoveredLeagues.length === 0 && !discoveryError && (
                  <p className="text-[13px] text-white/50">No leagues found for that username this season.</p>
                )}
                {discoveredLeagues && discoveredLeagues.length > 0 && (
                  <div className="space-y-2" data-testid="import-sleeper-discovered-leagues">
                    {discoveredLeagues.map((league) => {
                      const isThisLoading = discoveringLeagues === false && loadingProvider === 'sleeper' && sleeperSelectedSourceId === league.sourceId
                      const thisPreviewed = previewInfo?.provider === 'sleeper' && previewInfo.sourceInput === league.sourceId
                      return (
                        <button
                          key={league.sourceId}
                          type="button"
                          onClick={() => selectDiscoveredSleeperLeague(league.sourceId)}
                          disabled={isThisLoading}
                          className={`warroom-pressable flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left ${
                            sleeperSelectedSourceId === league.sourceId
                              ? 'border-cyan-400/50 bg-cyan-500/[0.10]'
                              : 'border-white/10 bg-black/20 hover:border-white/25'
                          }`}
                        >
                          <span>
                            <span className="block text-sm font-bold text-white">{league.name}</span>
                            <span className="block text-[11px] text-white/50">
                              {league.sport.toUpperCase()} · {league.season}
                              {league.totalTeams ? ` · ${league.totalTeams} teams` : ''}
                            </span>
                          </span>
                          {isThisLoading ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cyan-300" aria-hidden />
                          ) : thisPreviewed ? (
                            <span className="shrink-0 text-[11px] font-bold text-emerald-300">Preview loaded — see below</span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                )}
              </form>
            )}

            {activeImportProvider && (
              <div className="mt-8 space-y-4">
                <p className="text-sm text-white/55">
                  {tab === 'sleeper'
                    ? 'Import one Sleeper league into AllFantasy with a preview and confirmation. '
                    : `Import a league from ${tab} into AllFantasy (preview + confirm). `}
                  Connect accounts in{' '}
                  <Link href="/settings" className="text-cyan-400 underline">
                    Settings
                  </Link>{' '}
                  when required (Yahoo OAuth, ESPN cookies, MFL API key).
                </p>
                <UnifiedImportPanel
                  providers={panelProviders}
                  onImport={handleUnifiedImport}
                  loadingProvider={loadingProvider}
                  initialInputs={unifiedInitialInputs}
                />
                {(loadingProvider || committing) && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.06] p-3 text-[13px] text-cyan-100"
                  >
                    {committing
                      ? 'Creating your league and saving imported settings, members, and rosters…'
                      : `Checking ${loadingProvider} league access and preparing a safe preview…`}
                  </div>
                )}
                {previewInfo && previewInfo.provider === activeImportProvider && (
                  <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-4">
                    <p className="mb-1 text-[15px] font-semibold text-cyan-200">{t('import.previewLoaded')}</p>
                    <p className="mb-3 text-[13px] text-white/75">
                      {previewInfo.leagueName} ({previewInfo.provider})
                    </p>
                    {previewInfo.canonical ? (
                      <div className="mb-3">
                        <CanonicalImportSummaryCard canonical={previewInfo.canonical} />
                      </div>
                    ) : null}
                    {previewNeedsAttestation && (
                      <CommissionerAttestationPanel
                        provider={previewInfo.provider}
                        leagueName={previewInfo.leagueName}
                        externalLeagueId={previewInfo.sourceInput}
                        accepted={attestationAccepted}
                        onAcceptedChange={(next) => {
                          setAttestationAccepted(next)
                          setAttestationRequiredByServer(false)
                        }}
                        statement={attestationStatement}
                        onStatementChange={setAttestationStatement}
                        disabled={committing}
                      />
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={commitDisabled}
                        onClick={() => void handleCommit(false)}
                        className="mt-4 rounded-xl bg-cyan-500 px-4 py-2 text-[13px] font-bold text-black hover:bg-cyan-400 disabled:opacity-40"
                      >
                        {committing ? t('import.importing') : t('import.commitImport')}
                      </button>
                    </div>
                    {attestationRequiredByServer && !attestationAccepted && (
                      <p role="alert" className="mt-2 text-[12px] text-amber-200">
                        {t('import.error.attestationRequired')}
                      </p>
                    )}
                    {conflict && (
                      <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-100">
                        <p>{conflict.message}</p>
                        <button
                          type="button"
                          disabled={committing}
                          onClick={() => void handleCommit(true)}
                          className="mt-2 rounded-full bg-amber-400 px-3 py-1 text-[11px] font-bold text-black hover:bg-amber-300 disabled:opacity-40"
                        >
                          {t('import.reimportOverExisting')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {formError && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-[13px] text-red-300">
                    <p>
                      <HelpCircle className="mr-1 inline h-4 w-4" />
                      {formError}
                    </p>
                    <p className="mt-1 text-[12px] text-red-200/75">
                      Confirm the league ID and required provider connection, then try again. No league is created until
                      you confirm a successful preview.
                    </p>
                    {failedPreview && failedPreview.provider === activeImportProvider ? (
                      <button
                        type="button"
                        disabled={loadingProvider !== null || committing}
                        onClick={() => void runPreview(failedPreview.provider, failedPreview.sourceInput)}
                        className="mt-2 rounded-full border border-red-300/30 px-3 py-1 text-[11px] font-bold text-red-100 hover:bg-red-300/10 disabled:opacity-40"
                      >
                        Retry preview
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <details className="group mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-white/70">
            Provider connection details
            <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <p className="mt-2 text-[12px] text-white/45">{t('import.providerHelp')}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {(['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker'] as ImportProvider[]).map(
              (provider) => {
                const support = commissionerSupport[provider]
                return (
                  <div
                    key={provider}
                    className={`rounded-xl border px-3 py-3 text-left ${
                      support.status === 'verified'
                        ? 'border-emerald-500/20 bg-emerald-500/[0.08]'
                        : 'border-amber-500/20 bg-amber-500/[0.08]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold capitalize text-white">{provider}</span>
                      <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-200">
                        {support.status === 'verified' ? t('import.status.enabled') : t('import.status.blocked')}
                      </span>
                    </div>
                    <p className="mt-2 text-[12px] leading-5 text-white/65">{support.detail}</p>
                  </div>
                )
              }
            )}
          </div>
        </details>

        <div className="mt-10 rounded-xl border border-white/8 bg-white/[0.04] p-4 text-[12px] text-white/45">
          <p className="font-semibold text-white/60">What happens next</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Sleeper: find your leagues by username, or paste a league ID directly.</li>
            <li>Every platform: preview your league, then confirm to create it.</li>
            <li>Only the league&apos;s commissioner can complete the import.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

