'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, HelpCircle, Loader2, Search } from 'lucide-react'
import CanonicalImportSummaryCard, {
  type CanonicalPreview,
} from '@/components/league-import/CanonicalImportSummaryCard'
import { UnifiedImportPanel } from '@/components/UnifiedImportPanel'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { LegacyImportResults } from '@/components/unified-import-ui/LegacyImportResults'
import type { LegacyPlatformTab } from '@/lib/import/importSearchParams'
import {
  discoverProviderLeagues,
  fetchImportPreview,
  submitImportCreation,
} from '@/lib/league-import/LeagueCreationImportSubmissionService'
import {
  getImportProviderLabel,
  isImportProviderAvailable,
  supportsImportProviderDiscovery,
} from '@/lib/league-import/provider-ui-config'
import type { ImportProvider } from '@/lib/league-import/types'

const IMPORT_TABS: ReadonlyArray<{
  id: LegacyPlatformTab
  label: string
}> = [
  { id: 'sleeper', label: 'Sleeper' },
  { id: 'espn', label: 'ESPN' },
  { id: 'yahoo', label: 'Yahoo' },
  { id: 'fantrax', label: 'Fantrax' },
  { id: 'mfl', label: 'MFL' },
  { id: 'fleaflicker', label: 'Fleaflicker' },
]

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
  /** Legacy query param support; not used for league import. */
  initialSleeperUsername?: string
  /** Prefill league id / source for the active provider tab. */
  initialLeagueSourceId?: string
}

type ProviderLeagueDiscoveryItem = {
  sourceId: string
  name: string
  sport?: string
  season?: string
  status?: string
  totalTeams?: number
  isDynasty?: boolean
  avatarUrl?: string | null
}

function tabToImportProvider(tab: LegacyPlatformTab): ImportProvider {
  return tab
}

/**
 * Provider availability is the single authoritative product/UX-readiness signal
 * from `provider-ui-config` — never hardcoded. Disabled providers (fantrax/mfl/
 * fleaflicker today) must render their honest "blocked" state so the panel can't
 * claim "verified" for a provider whose import isn't usable end-to-end.
 */
function providerStatus(provider: ImportProvider): 'verified' | 'blocked' {
  return isImportProviderAvailable(provider) ? 'verified' : 'blocked'
}

export function LeagueImportFlow({
  userId,
  defaultProvider = 'sleeper',
  returnTo,
  mode = 'full',
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
  const [loadingProvider, setLoadingProvider] = useState<ImportProvider | null>(null)
  const [previewInfo, setPreviewInfo] = useState<{
    provider: ImportProvider
    sourceInput: string
    leagueName: string
    canonical: CanonicalPreview | null
  } | null>(null)
  const [committing, setCommitting] = useState(false)
  const [conflict, setConflict] = useState<{ message: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [providerAccountInput, setProviderAccountInput] =
    useState(initialSleeperUsername)
  const [discoveringProvider, setDiscoveringProvider] =
    useState<ImportProvider | null>(null)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [discoveredLeagues, setDiscoveredLeagues] = useState<
    ProviderLeagueDiscoveryItem[]
  >([])
  const [discoveredAccountLabel, setDiscoveredAccountLabel] =
    useState<string>('')
  const [previewingSourceId, setPreviewingSourceId] = useState<string | null>(null)
  const [leaguePreviewError, setLeaguePreviewError] = useState<{
    sourceId: string
    message: string
  } | null>(null)

  const previewSectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (previewInfo && previewSectionRef.current) {
      previewSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [previewInfo])

  const commissionerSupport = useMemo(
    () =>
      ({
        sleeper: {
          status: providerStatus('sleeper'),
          detail: t('import.provider.sleeper.detail'),
        },
        espn: {
          status: providerStatus('espn'),
          detail: t('import.provider.espn.detail'),
        },
        yahoo: {
          status: providerStatus('yahoo'),
          detail: t('import.provider.yahoo.detail'),
        },
        fantrax: {
          status: providerStatus('fantrax'),
          detail: t('import.provider.fantrax.detail'),
        },
        mfl: {
          status: providerStatus('mfl'),
          detail: t('import.provider.mfl.detail'),
        },
        fleaflicker: {
          status: providerStatus('fleaflicker'),
          detail: t('import.provider.fleaflicker.detail'),
        },
      }) satisfies Record<
        ImportProvider,
        { status: 'verified' | 'blocked'; detail: string }
      >,
    [t],
  )

  const activeImportProvider = tabToImportProvider(tab)
  const supportsAccountDiscovery =
    supportsImportProviderDiscovery(activeImportProvider)
  const panelProviders = useMemo<ImportProvider[]>(
    () => [activeImportProvider],
    [activeImportProvider],
  )

  const unifiedInitialInputs = useMemo(() => {
    const trimmed = initialLeagueSourceId.trim()
    if (!trimmed) return undefined
    return {
      [activeImportProvider]: trimmed,
    } as Partial<Record<ImportProvider, string>>
  }, [activeImportProvider, initialLeagueSourceId])

  async function runPreview(provider: ImportProvider, sourceInput: string, discoverySourceId?: string) {
    setLoadingProvider(provider)
    setPreviewingSourceId(discoverySourceId ?? null)
    setFormError(null)
    setLeaguePreviewError(null)
    setPreviewInfo(null)
    setConflict(null)

    try {
      const preview = await fetchImportPreview(provider, sourceInput)
      if (!preview.ok) {
        throw new Error(preview.error || t('import.error.previewFailed'))
      }

      const payload = preview.data as {
        league?: { name?: string }
        canonical?: CanonicalPreview | null
      }
      const leagueName =
        payload?.league?.name?.trim() || t('import.leagueDefaultName')
      const canonical = payload?.canonical ?? null
      setPreviewInfo({ provider, sourceInput, leagueName, canonical })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('import.error.generic')
      if (discoverySourceId) {
        setLeaguePreviewError({ sourceId: discoverySourceId, message })
      } else {
        setFormError(message)
      }
    } finally {
      setLoadingProvider(null)
      setPreviewingSourceId(null)
    }
  }

  async function runProviderDiscovery(
    provider: ImportProvider,
    accountIdentifier: string,
  ) {
    setDiscoveringProvider(provider)
    setDiscoveryError(null)
    setDiscoveredLeagues([])

    try {
      const result = await discoverProviderLeagues(provider, accountIdentifier, {
        sport: 'nfl',
      })
      if (!result.ok) {
        throw new Error(result.error || 'Failed to discover provider leagues.')
      }

      const payload = result.data as {
        account?: { displayName?: string; accountIdentifier?: string }
        leagues?: ProviderLeagueDiscoveryItem[]
      }
      setDiscoveredAccountLabel(
        payload.account?.displayName?.trim() ||
          payload.account?.accountIdentifier?.trim() ||
          accountIdentifier.trim(),
      )
      setDiscoveredLeagues(payload.leagues ?? [])
    } catch (error: unknown) {
      setDiscoveryError(
        error instanceof Error ? error.message : 'Failed to discover leagues.',
      )
    } finally {
      setDiscoveringProvider(null)
    }
  }

  async function handleCommit(force = false) {
    if (!previewInfo) return

    setCommitting(true)
    setFormError(null)
    setConflict(null)

    try {
      const result = await submitImportCreation(
        previewInfo.provider,
        previewInfo.sourceInput,
        userId,
        undefined,
        { force },
      )

      if (!result.ok) {
        if (result.status === 409) {
          setConflict({ message: result.error ?? t('import.conflict.default') })
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
    } catch (error: unknown) {
      setFormError(
        error instanceof Error ? error.message : t('import.error.commitFailed'),
      )
    } finally {
      setCommitting(false)
    }
  }

  const hideMainChrome = resultsKind === 'league_created'
  const backButtonLabel = returnTo.includes('dashboard')
    ? 'Back to dashboard'
    : 'Back'
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
        backButtonLabel,
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
        'Support AllFantasy',
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
          // Primary completion sends the user to the FREE unified dashboard.
          // No selected-league preselect contract exists on /dashboard yet, so we
          // route there plainly; auto-selecting the imported league is deferred to
          // the dashboard selected-league-context batch.
          onCompleteRedirect={onCompleteRedirect ?? '/dashboard'}
        />
      )}

      <div className={mainContainerClassName}>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          {topNavLeft}
          {topNavRight}
        </div>

        <div className="warroom-fade-in-stagger relative mb-10">
          <div className="mx-auto mb-4 inline-flex w-full items-center justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/25 bg-cyan-500/[0.06] px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-cyan-300/85">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.6)]" aria-hidden />
              Step 1 · Choose Platform
            </span>
          </div>
          <h1 className="relative text-center text-4xl font-bold text-transparent sm:text-5xl">
            <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text">
              Connect your league
            </span>
          </h1>
          <p className="relative mt-3 text-center text-white/55">
            Connect your Sleeper, ESPN, Yahoo, Fantrax, or MFL league to
            AllFantasy — a read-only view we analyze but never change on the
            source platform.
          </p>
          <p className="relative mt-2 text-center text-[13px] text-white/40">
            Connect provider credentials in{' '}
            <Link
              href="/settings"
              className="text-cyan-400 underline hover:text-cyan-300"
            >
              Settings
            </Link>{' '}
            for private league access when required.
          </p>
        </div>

        <div className="warroom-card warroom-fade-in-stagger relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
          <div className="h-1 bg-gradient-to-r from-cyan-400/60 via-purple-400/60 to-cyan-400/60" />
          <div className="p-6 sm:p-8">
            <h2 className="text-2xl font-bold text-white">
              Choose your platform
            </h2>
            <p className="mt-1 text-sm text-white/60">
              Preview league settings, rosters, draft structure, and scoring
              before you connect it — AllFantasy never changes your source league.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {IMPORT_TABS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setTab(id)
                    setFormError(null)
                    setPreviewInfo(null)
                    setConflict(null)
                    setDiscoveryError(null)
                    setDiscoveredLeagues([])
                  }}
                  className={`warroom-pressable relative min-w-[100px] flex-1 rounded-xl px-2 py-2.5 text-sm font-semibold transition ${
                    tab === id
                      ? 'border border-cyan-400/50 bg-gradient-to-r from-cyan-500/30 to-purple-500/30 text-white'
                      : 'border border-white/10 bg-black/30 text-white/60 hover:border-white/25 hover:text-white'
                  }`}
                  data-testid={`import-tab-${id}`}
                >
                  {label}
                  {id === 'sleeper' ? (
                    <span
                      className="absolute -top-1.5 right-2 rounded-full border border-emerald-500/40 bg-emerald-500/[0.14] px-1.5 py-0 text-[8px] font-black uppercase tracking-wider text-emerald-300"
                      aria-label="Recommended provider"
                    >
                      Recommended
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            <div className="mt-8 space-y-4">
              <p className="text-sm text-white/55">
                Import a league from {tab.toUpperCase()} into AllFantasy. We
                will preview the league first, then let you confirm the creation
                step.
              </p>
              {supportsAccountDiscovery ? (
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.05] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-cyan-100">
                        Discover leagues from account
                      </p>
                      <p className="mt-1 text-[12px] text-cyan-50/70">
                        Use a provider account identifier to find an NFL league,
                        then preview the canonical import before you commit it.
                      </p>
                    </div>
                    <span className="rounded-full border border-cyan-400/25 bg-black/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200/85">
                      {getImportProviderLabel(activeImportProvider)}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={providerAccountInput}
                      onChange={(event) =>
                        setProviderAccountInput(event.target.value)
                      }
                      placeholder="Provider username or account identifier"
                      data-testid="import-discovery-account"
                      className="h-11 flex-1 rounded-xl border border-cyan-400/35 bg-[#030a20] px-3 text-sm text-white outline-none placeholder:text-white/30"
                    />
                    <button
                      type="button"
                      disabled={
                        discoveringProvider === activeImportProvider ||
                        !providerAccountInput.trim()
                      }
                      onClick={() =>
                        void runProviderDiscovery(
                          activeImportProvider,
                          providerAccountInput,
                        )
                      }
                      data-testid="import-discovery-find"
                      className="warroom-pressable inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-cyan-300/40 px-4 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-40"
                    >
                      <Search className="h-4 w-4" />
                      {discoveringProvider === activeImportProvider
                        ? 'Finding leagues...'
                        : 'Find leagues'}
                    </button>
                  </div>

                  {discoveryError ? (
                    <p className="mt-3 text-[12px] text-red-300">
                      {discoveryError}
                    </p>
                  ) : null}

                  {discoveringProvider === null &&
                  discoveredAccountLabel &&
                  discoveredLeagues.length === 0 &&
                  !discoveryError ? (
                    <p className="mt-3 text-[12px] text-white/55">
                      No importable leagues were found for this provider account
                      and sport filter.
                    </p>
                  ) : null}

                  {discoveredLeagues.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-cyan-200/70">
                        {discoveredAccountLabel
                          ? `${discoveredAccountLabel} leagues`
                          : 'Discovered leagues'}
                      </p>
                      <div className="space-y-2">
                        {discoveredLeagues.map((league) => {
                          const isThisLoading = previewingSourceId === league.sourceId
                          const isAnyLoading = previewingSourceId !== null || loadingProvider !== null
                          const thisError = leaguePreviewError?.sourceId === league.sourceId ? leaguePreviewError.message : null
                          const thisPreviewed = previewInfo?.sourceInput === league.sourceId

                          return (
                            <div
                              key={league.sourceId}
                              className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/20 p-3 sm:flex-row sm:items-start sm:justify-between"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-white">
                                  {league.name}
                                </p>
                                <p className="mt-1 text-[12px] text-white/55">
                                  {league.season ?? 'Current season'} |{' '}
                                  {(league.sport ?? 'NFL').toUpperCase()} |{' '}
                                  {league.totalTeams ?? '--'} teams
                                  {league.isDynasty ? ' | Dynasty' : ' | Redraft'}
                                </p>
                                {thisError ? (
                                  <p className="mt-2 text-[12px] text-red-300">
                                    <HelpCircle className="mr-1 inline h-3.5 w-3.5" />
                                    {thisError}
                                  </p>
                                ) : null}
                                {thisPreviewed && !thisError ? (
                                  <p className="mt-2 text-[12px] font-semibold text-cyan-300">
                                    Preview loaded — see below
                                  </p>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                disabled={isAnyLoading}
                                data-testid={`import-league-select-${league.sourceId}`}
                                onClick={() =>
                                  void runPreview(
                                    activeImportProvider,
                                    league.sourceId,
                                    league.sourceId,
                                  )
                                }
                                className={`warroom-pressable inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-black ${
                                  isThisLoading
                                    ? 'bg-cyan-500/60'
                                    : 'bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50'
                                }`}
                              >
                                {isThisLoading ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading preview...
                                  </>
                                ) : (
                                  'Select and preview'
                                )}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!isImportProviderAvailable(activeImportProvider) ? (
                <p
                  className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[13px] text-amber-100"
                  data-testid="import-provider-coming-soon"
                >
                  {getImportProviderLabel(activeImportProvider)} import is coming
                  soon — it isn&apos;t available to connect yet.
                </p>
              ) : null}
              <UnifiedImportPanel
                providers={panelProviders}
                onImport={runPreview}
                loadingProvider={loadingProvider}
                initialInputs={unifiedInitialInputs}
              />
              {previewInfo && previewInfo.provider === activeImportProvider && (
                <div ref={previewSectionRef} className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-4">
                  <p className="mb-1 text-[15px] font-semibold text-cyan-200">
                    {t('import.previewLoaded')}
                  </p>
                  <p className="mb-3 text-[13px] text-white/75">
                    {previewInfo.leagueName} ({previewInfo.provider})
                  </p>
                  {previewInfo.canonical ? (
                    <div className="mb-3">
                      <CanonicalImportSummaryCard
                        canonical={previewInfo.canonical}
                      />
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={committing}
                      data-testid="import-commit"
                      onClick={() => void handleCommit(false)}
                      className="rounded-xl bg-cyan-500 px-4 py-2 text-[13px] font-bold text-black hover:bg-cyan-400 disabled:opacity-40"
                    >
                      {committing ? t('import.importing') : t('import.commitImport')}
                    </button>
                  </div>
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
                  <HelpCircle className="mr-1 inline h-4 w-4" />
                  {formError}
                </div>
              )}
            </div>
          </div>
        </div>

        <details className="group mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-white/70">
            Provider connection details
            <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <p className="mt-2 text-[12px] text-white/45">
            {t('import.providerHelp')}
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {(
              ['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker'] as ImportProvider[]
            ).map((provider) => {
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
                    <span className="text-sm font-semibold capitalize text-white">
                      {provider}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                        support.status === 'verified'
                          ? 'bg-emerald-400/20 text-emerald-200'
                          : 'bg-amber-400/20 text-amber-200'
                      }`}
                    >
                      {support.status === 'verified'
                        ? t('import.status.enabled')
                        : t('import.status.blocked')}
                    </span>
                  </div>
                  <p className="mt-2 text-[12px] leading-5 text-white/65">
                    {support.detail}
                  </p>
                </div>
              )
            })}
          </div>
        </details>

        <div className="mt-10 rounded-xl border border-white/8 bg-white/[0.04] p-4 text-[12px] text-white/45">
          <p className="font-semibold text-white/60">What happens next</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Discover a league from your provider account or paste a league ID manually.</li>
            <li>Preview settings, scoring, teams, and draft structure before you commit.</li>
            <li>Finish the import and land on the created league inside AllFantasy.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
