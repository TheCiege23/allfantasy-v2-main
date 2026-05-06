'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import CanonicalImportSummaryCard, { type CanonicalPreview } from '@/components/league-import/CanonicalImportSummaryCard'
import { UnifiedImportPanel } from '@/components/UnifiedImportPanel'
import {
  fetchImportPreview,
  submitImportCreation,
} from '@/lib/league-import/LeagueCreationImportSubmissionService'
import type { ImportProvider } from '@/lib/league-import/types'
import type { LegacyPlatformTab } from '@/lib/import/importSearchParams'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useLegacySleeperImport } from '@/hooks/useLegacySleeperImport'
import { LegacyImportLoadingScreen } from '@/components/unified-import-ui/LegacyImportLoadingScreen'
import { LegacyImportResults } from '@/components/unified-import-ui/LegacyImportResults'

const PREVIEW_PROVIDERS: ImportProvider[] = ['espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker']

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

function tabToImportProvider(tab: LegacyPlatformTab): ImportProvider | null {
  if (tab === 'sleeper') return null
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

  const sleeperHook = useLegacySleeperImport()
  const {
    username: sleeperUsername,
    setUsername: setSleeperUsername,
    phase: sleeperPhase,
    progress: sleeperProgress,
    error: sleeperError,
    bootLoading: sleeperBootLoading,
    statusMessage: sleeperStatusMessage,
    startImport: startSleeperImport,
    reset: resetSleeper,
  } = sleeperHook

  const [resultsKind, setResultsKind] = useState<'idle' | 'legacy_sleeper' | 'league_created'>('idle')
  const [legacyResultUsername, setLegacyResultUsername] = useState<string | null>(null)
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

  useEffect(() => {
    const pre = initialSleeperUsername.trim()
    if (pre) setSleeperUsername(pre)
  }, [initialSleeperUsername, setSleeperUsername])

  useEffect(() => {
    if (sleeperPhase === 'complete' && sleeperUsername.trim()) {
      setLegacyResultUsername(sleeperUsername.trim())
      setResultsKind('legacy_sleeper')
    }
  }, [sleeperPhase, sleeperUsername])

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
    if (!initialLeagueSourceId.trim() || !activeImportProvider) return undefined
    return { [activeImportProvider]: initialLeagueSourceId.trim() } as Partial<
      Record<ImportProvider, string>
    >
  }, [initialLeagueSourceId, activeImportProvider])

  async function runPreview(provider: ImportProvider, sourceInput: string) {
    setLoadingProvider(provider)
    setFormError(null)
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
      const leagueName = payload?.league?.name?.trim() || t('import.leagueDefaultName')
      const canonical = payload?.canonical ?? null
      setPreviewInfo({ provider, sourceInput, leagueName, canonical })
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : t('import.error.generic'))
    } finally {
      setLoadingProvider(null)
    }
  }

  async function handleUnifiedImport(provider: ImportProvider, sourceInput: string) {
    await runPreview(provider, sourceInput)
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
        { force }
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
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : t('import.error.commitFailed'))
    } finally {
      setCommitting(false)
    }
  }

  async function onSleeperSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!sleeperUsername.trim()) return
    await startSleeperImport(sleeperUsername)
  }

  const showSleeperLoading =
    tab === 'sleeper' && (sleeperPhase === 'importing' || sleeperBootLoading)

  const hideMainChrome = resultsKind === 'legacy_sleeper' || resultsKind === 'league_created'

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

  const rootShellClassName =
    mode === 'embedded'
      ? ''
      : 'min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 py-12 sm:py-20'

  return (
    <div className={rootShellClassName}>
      {showSleeperLoading && (
        <LegacyImportLoadingScreen
          progress={sleeperBootLoading ? 8 : sleeperProgress}
          platformLabel="Sleeper"
          statusMessage={sleeperStatusMessage}
          seasonSpan={null}
        />
      )}

      {resultsKind === 'legacy_sleeper' && legacyResultUsername && (
        <LegacyImportResults
          variant="legacy_sleeper"
          returnTo={returnTo}
          sleeperUsername={legacyResultUsername}
          onImportAnother={() => {
            resetSleeper()
            setLegacyResultUsername(null)
            setResultsKind('idle')
          }}
          onCompleteRedirect={onCompleteRedirect}
        />
      )}

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

        <div className="relative mb-10">
          <h1 className="relative text-center text-4xl font-bold text-transparent sm:text-5xl">
            <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text">
              {t('import.title')}
            </span>
          </h1>
          <p className="relative mt-3 text-center text-gray-400">
            Build your legacy profile or import a league using the same engines as AF Legacy and rankings.
          </p>
          <p className="relative mt-2 text-center text-[13px] text-gray-500">
            {t('import.settingsLink')}{' '}
            <Link href="/settings" className="text-cyan-400 underline hover:text-cyan-300">
              {t('import.settingsWord')}
            </Link>
            .
          </p>
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
          <div className="h-1 bg-gradient-to-r from-cyan-400/60 via-purple-400/60 to-cyan-400/60" />
          <div className="p-6 sm:p-8">
            <h2 className="text-2xl font-bold text-white">Build Your Legacy Profile</h2>
            <p className="mt-1 text-sm text-white/60">
              Choose your platform — Sleeper powers full career rank import and legacy score.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {(
                [
                  ['sleeper', '🌙', 'Sleeper'],
                  ['yahoo', '🏈', 'Yahoo'],
                  ['mfl', '🏆', 'MFL'],
                  ['fantrax', '📊', 'Fantrax'],
                  ['espn', '🔴', 'ESPN'],
                ] as const
              ).map(([id, icon, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setTab(id)
                    setFormError(null)
                    setPreviewInfo(null)
                    setConflict(null)
                  }}
                  className={`min-w-[100px] flex-1 rounded-xl px-2 py-2.5 text-sm font-semibold transition ${
                    tab === id
                      ? 'border border-cyan-400/50 bg-gradient-to-r from-cyan-500/30 to-purple-500/30 text-white'
                      : 'border border-white/10 bg-black/30 text-white/60 hover:border-white/25 hover:text-white'
                  }`}
                  data-testid={`import-tab-${id}`}
                >
                  <span className="mr-1">{icon}</span>
                  {label}
                </button>
              ))}
            </div>

            {tab === 'sleeper' && (
              <form onSubmit={(e) => void onSleeperSubmit(e)} className="mt-8 space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-[11px] uppercase tracking-wide text-white/50">
                      Sleeper username
                    </label>
                  </div>
                  <input
                    type="text"
                    value={sleeperUsername}
                    onChange={(e) => setSleeperUsername(e.target.value)}
                    placeholder="your_username"
                    autoFocus={autoFocus && mode !== 'embedded'}
                    autoComplete="username"
                    className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white placeholder:text-white/25 focus:border-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
                    disabled={sleeperBootLoading || sleeperPhase === 'importing'}
                  />
                  <p className="mt-2 text-[11px] text-white/45">
                    Public league history only — same pipeline as{' '}
                    <Link href="/af-legacy" className="text-cyan-400/90 underline">
                      AF Legacy
                    </Link>
                    .
                  </p>
                </div>
                {(sleeperPhase === 'failed' || formError) && (
                  <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {sleeperError || formError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={sleeperBootLoading || !sleeperUsername.trim()}
                  className="w-full rounded-2xl bg-gradient-to-r from-cyan-500/90 to-purple-600/90 py-3.5 text-base font-bold text-white shadow-lg disabled:opacity-40"
                  data-testid="import-build-legacy-cta"
                >
                  {sleeperBootLoading ? 'Starting…' : '🔥 Build My Legacy Profile'}
                </button>
              </form>
            )}

            {tab !== 'sleeper' && activeImportProvider && (
              <div className="mt-8 space-y-4">
                <p className="text-sm text-white/55">
                  Import a league from {tab} into AllFantasy (preview + confirm). Connect accounts in{' '}
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
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={committing}
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
            )}
          </div>
        </div>

        <details className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-white/70">
            Provider connection details
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

        <div className="mt-10 rounded-xl border border-white/8 bg-white/[0.02] p-4 text-[12px] text-white/45">
          <p className="font-semibold text-white/60">What happens next</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Sleeper: import runs as a tracked job — loading steps follow real progress.</li>
            <li>Other platforms: preview your league, then commit to create or link it.</li>
            <li>Use “Go to dashboard” so rankings widgets pull fresh `/api/user/rank` data.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

